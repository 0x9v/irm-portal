"""Actual ASGI password mutation and isolated SQLite transaction coverage."""
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import account_mutation_route
from app.api.v1.endpoints import auth as auth_endpoint
from app.api.v1.endpoints import discussion as discussion_endpoint
from app.core.config import settings
from app.core.security import hash_password, verify_password
from app.core.sessions import create_session, validate_session
from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models.session import Session as AccountSession
from app.models.community import Community
from app.models.membership import (Membership, MembershipApplicantType,
                                   MembershipIdentifierType, MembershipRole, MembershipStatus)
from app.models.user import User


OLD = "  Old Password 1  "
NEW = "  New Password 2  "
engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Factory = sessionmaker(bind=engine, autoflush=False)


def override_get_db():
    with Factory() as db:
        yield db


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(account_mutation_route, "SessionLocal", Factory)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)


@pytest.fixture
def client():
    with TestClient(app) as instance:
        yield instance


def make_user(password=OLD):
    with Factory() as db:
        user = User(username=uuid4().hex, email=f"{uuid4().hex}@example.com",
                    password_hash=hash_password(password), first_name="First", family_name="Family")
        db.add(user)
        db.commit()
        db.refresh(user)
        return user.id, user.email


def token_for(user_id):
    with Factory() as db:
        return create_session(db, user_id, timedelta(days=1))[0]


def post(client, token=None, body=None, *, headers=None, raw=False):
    request_headers = {"Origin": settings.frontend_url}
    request_headers.update(headers or {})
    cookies = {settings.session_cookie_name: token} if token else None
    body = {"current_password": OLD, "new_password": NEW} if body is None else body
    if raw:
        return client.post("/api/v1/auth/me/password", content=body, headers=request_headers, cookies=cookies)
    return client.post("/api/v1/auth/me/password", json=body, headers=request_headers, cookies=cookies)


def assert_private(response):
    assert response.headers["cache-control"] == "private, no-store"


def test_success_revokes_only_own_sessions_clears_cookie_and_requires_new_login(client):
    user_id, email = make_user()
    first, second = token_for(user_id), token_for(user_id)
    other_id, _ = make_user()
    other = token_for(other_id)
    response = post(client, first)
    assert response.status_code == 204 and response.content == b""
    assert_private(response)
    cookie = response.headers["set-cookie"]
    assert "session=" in cookie and "Max-Age=0" in cookie
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie and "Path=/" in cookie
    assert ("Secure" in cookie) == settings.secure_cookies
    with Factory() as db:
        user = db.get(User, user_id)
        assert verify_password(NEW, user.password_hash)
        assert not verify_password(OLD, user.password_hash)
        assert all(s.is_revoked for s in db.query(AccountSession).filter_by(user_id=user_id))
        assert validate_session(db, first) is None and validate_session(db, second) is None
        assert validate_session(db, other) is not None
        assert (user.email, user.first_name, user.family_name) == (email, "First", "Family")
    assert client.get("/api/v1/auth/me", cookies={"session": second}).status_code == 401
    assert client.get("/api/v1/auth/me", cookies={"session": other}).status_code == 200
    assert client.post("/api/v1/auth/login", json={"email": email, "password": OLD}).status_code == 401
    login = client.post("/api/v1/auth/login", json={"email": email, "password": NEW})
    assert login.status_code == 200 and "session" in login.cookies


@pytest.mark.parametrize("body,code,detail", [
    ({"current_password": "wrong", "new_password": NEW}, 400, "Current password is incorrect."),
    ({"current_password": OLD, "new_password": OLD}, 422, None),
])
def test_wrong_or_unchanged_password_rolls_back(client, body, code, detail):
    user_id, _ = make_user()
    token = token_for(user_id)
    with Factory() as db:
        original = db.get(User, user_id).password_hash
    response = post(client, token, body)
    assert response.status_code == code
    assert_private(response)
    assert "set-cookie" not in response.headers
    if detail:
        assert response.json() == {"detail": detail}
    else:
        assert response.json()["detail"] == [{"loc": ["body", "new_password"],
            "type": "password_unchanged", "msg": "New password must differ from the current password"}]
    with Factory() as db:
        assert db.get(User, user_id).password_hash == original
        assert validate_session(db, token) is not None


@pytest.mark.parametrize("body", [
    {}, {"current_password": OLD}, {"new_password": NEW},
    {"current_password": None, "new_password": NEW},
    {"current_password": 12, "new_password": NEW},
    {"current_password": OLD, "new_password": None},
    {"current_password": OLD, "new_password": []},
    {"current_password": OLD, "new_password": "short"},
    {"current_password": OLD, "new_password": NEW, "email": "secret-extra@example.test"},
    [OLD, NEW], "secret-scalar", 3,
])
def test_strict_sanitized_validation(client, body):
    user_id, _ = make_user()
    token = token_for(user_id)
    response = post(client, token, body)
    assert response.status_code == 422
    assert_private(response)
    assert all(set(error) == {"loc", "type", "msg"} for error in response.json()["detail"])
    assert OLD not in response.text and NEW not in response.text and "secret-extra" not in response.text
    with Factory() as db:
        assert validate_session(db, token) is not None


def test_passwords_preserve_whitespace_and_unicode_exactly(client):
    old = "  mot de passe é  "
    new = "  كلمة المرور ٢  "
    user_id, email = make_user(old)
    token = token_for(user_id)
    response = post(client, token, {"current_password": old, "new_password": new})
    assert response.status_code == 204
    with Factory() as db:
        assert verify_password(new, db.get(User, user_id).password_hash)
        assert not verify_password(new.strip(), db.get(User, user_id).password_hash)
    assert client.post("/api/v1/auth/login", json={"email": email, "password": new.strip()}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": email, "password": new}).status_code == 200


def test_profile_and_two_community_applications_are_unchanged(client):
    user_id, email = make_user()
    token = token_for(user_id)
    with Factory() as db:
        communities = [Community(slug=f"community-{index}", name=f"Community {index}") for index in range(2)]
        db.add_all(communities)
        db.flush()
        memberships = [
            Membership(user_id=user_id, community_id=communities[0].id,
                       status=MembershipStatus.BANNED, role=MembershipRole.MEMBER,
                       applicant_type=MembershipApplicantType.STUDENT,
                       identifier_type=MembershipIdentifierType.MASSAR,
                       applicant_first_name="Application A", applicant_family_name="Family A",
                       cne="A123", promotion="2025"),
            Membership(user_id=user_id, community_id=communities[1].id,
                       status=MembershipStatus.ACTIVE, role=MembershipRole.MODERATOR,
                       applicant_type=MembershipApplicantType.LAUREATE,
                       identifier_type=MembershipIdentifierType.FOREIGN,
                       applicant_first_name="Application B", applicant_family_name="Family B",
                       cne="B456", promotion="2024"),
        ]
        db.add_all(memberships)
        db.commit()
        user = db.get(User, user_id)
        profile = (user.id, user.username, user.email, user.first_name,
                   user.family_name, user.created_at)
        before = [(m.id, m.community_id, m.status, m.role, m.applicant_type,
                   m.identifier_type, m.applicant_first_name, m.applicant_family_name,
                   m.cne, m.promotion, m.created_at, m.updated_at) for m in memberships]
    assert post(client, token).status_code == 204
    with Factory() as db:
        user = db.get(User, user_id)
        assert (user.id, user.username, user.email, user.first_name,
                user.family_name, user.created_at) == profile
        assert user.email == email
        stored = db.query(Membership).filter_by(user_id=user_id).order_by(Membership.community_id).all()
        after = [(m.id, m.community_id, m.status, m.role, m.applicant_type,
                  m.identifier_type, m.applicant_first_name, m.applicant_family_name,
                  m.cne, m.promotion, m.created_at, m.updated_at) for m in stored]
        assert sorted(after, key=str) == sorted(before, key=str)


@pytest.mark.parametrize("state", ["guest", "bad", "expired", "revoked"])
def test_session_denial_precedes_body_validation(client, state):
    user_id, _ = make_user()
    token = token_for(user_id)
    if state in {"expired", "revoked"}:
        with Factory() as db:
            session = db.query(AccountSession).filter_by(user_id=user_id).one()
            if state == "expired":
                session.expires_at -= timedelta(days=2)
            else:
                session.is_revoked = True
            db.commit()
    response = post(client, None if state == "guest" else "invalid" if state == "bad" else token,
                    b'{bad-json-secret', raw=True, headers={"Content-Type": "application/json"})
    assert response.status_code == 401 and response.json() == {"detail": "Not authenticated"}
    assert_private(response)


def test_origin_media_body_bounds_and_malformed_json(client):
    user_id, _ = make_user()
    token = token_for(user_id)
    for headers, body, code in [
        ({"Origin": "null"}, {}, 403),
        ({"Origin": "https://lookalike.invalid"}, {}, 403),
        ({"Origin": ""}, {}, 403),
        ({"Content-Type": "text/plain"}, b"secret-body", 415),
        ({"Content-Type": "application/json"}, b" " * (account_mutation_route.MAX_ACCOUNT_JSON_BYTES + 1), 413),
        ({"Content-Type": "application/json"}, b'{"current_password": "secret",', 422),
    ]:
        response = post(client, token, body, headers=headers, raw=isinstance(body, bytes))
        assert response.status_code == code
        assert_private(response)
        assert "secret-body" not in response.text and "secret\"" not in response.text
    with Factory() as db:
        assert validate_session(db, token) is not None


def test_commit_failure_rolls_back_hash_and_sessions_and_keeps_cookie(client, monkeypatch):
    user_id, _ = make_user()
    token = token_for(user_id)
    with Factory() as db:
        original = db.get(User, user_id).password_hash
    actual = auth_endpoint.change_password

    def fail_after_writes(db, user_id, raw_token, password_in):
        def fail_commit(_):
            raise RuntimeError("private driver detail")
        event.listen(db, "before_commit", fail_commit, once=True)
        return actual(db, user_id, raw_token, password_in)

    monkeypatch.setattr(auth_endpoint, "change_password", fail_after_writes)
    response = post(client, token)
    assert response.status_code == 500
    assert response.json() == {"detail": "Account operation failed"}
    assert_private(response)
    assert "set-cookie" not in response.headers and "private driver detail" not in response.text
    with Factory() as db:
        assert db.get(User, user_id).password_hash == original
        assert validate_session(db, token) is not None


def test_service_rechecks_session_after_dependency_observed_it(client, monkeypatch):
    user_id, _ = make_user()
    token = token_for(user_id)
    actual = auth_endpoint.change_password

    def revoke_before_service(db, user_id, raw_token, password_in):
        with Factory() as other:
            session = other.query(AccountSession).filter_by(user_id=user_id).one()
            session.is_revoked = True
            other.commit()
        return actual(db, user_id, raw_token, password_in)

    monkeypatch.setattr(auth_endpoint, "change_password", revoke_before_service)
    response = post(client, token)
    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}
    assert_private(response)
    assert "set-cookie" not in response.headers
    with Factory() as db:
        assert verify_password(OLD, db.get(User, user_id).password_hash)


def test_websocket_authorization_boundary_observes_password_revocation(client, monkeypatch):
    user_id, _ = make_user()
    token = token_for(user_id)
    with Factory() as db:
        community = Community(slug="password-ws", name="Password WS")
        db.add(community)
        db.flush()
        db.add(Membership(user_id=user_id, community_id=community.id,
                          status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER))
        db.commit()
    monkeypatch.setattr(discussion_endpoint, "SessionLocal", Factory)
    assert discussion_endpoint.check_ws_auth(token, "password-ws") == (True, user_id, None)
    response = post(client, token)
    assert response.status_code == 204
    assert discussion_endpoint.check_ws_auth(token, "password-ws") == (
        False, None, "Invalid or expired session"
    )
