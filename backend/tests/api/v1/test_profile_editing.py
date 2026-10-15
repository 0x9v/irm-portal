from datetime import timedelta
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import account_mutation_route
from app.api.deps import get_current_user
from app.api.v1.endpoints import auth as auth_endpoint
from app.core.config import settings
from app.core.sessions import create_session
from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models.announcement import Announcement
from app.models.announcement_reply import AnnouncementReply
from app.models.community import Community
from app.models.community_post import CommunityPost
from app.models.community_post_reply import CommunityPostReply
from app.models.discussion_message import DiscussionMessage
from app.models.document import Document, DocumentSource, DocumentStatus, DocumentType
from app.models.membership import (
    Membership,
    MembershipApplicantType,
    MembershipIdentifierType,
    MembershipRole,
    MembershipStatus,
)
from app.models.membership_permission import MembershipPermission, PermissionType
from app.models.module import Module
from app.models.session import Session as SessionModel
from app.models.user import User


engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def isolated_api(monkeypatch):
    old_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(account_mutation_route, "SessionLocal", TestingSessionLocal)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.clear()
    app.dependency_overrides.update(old_overrides)


@pytest.fixture
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client():
    test_client = TestClient(app)
    try:
        yield test_client
    finally:
        test_client.close()


def make_user(db, username="profile_user", email=None):
    user = User(
        username=username,
        email=email or f"{uuid4().hex}@example.test",
        password_hash="stored-hash",
        first_name="Original",
        family_name="Account",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_token(db, user):
    return create_session(db, user.id, timedelta(days=1))[0]


def patch(client, body, token=None, *, headers=None, raw=False):
    request_headers = {"Origin": settings.frontend_url}
    request_headers.update(headers or {})
    cookies = {settings.session_cookie_name: token} if token else None
    if raw:
        return client.patch("/api/v1/auth/me", content=body, headers=request_headers, cookies=cookies)
    return client.patch("/api/v1/auth/me", json=body, headers=request_headers, cookies=cookies)


def assert_private(response):
    assert response.headers["cache-control"] == "private, no-store"


def test_guest_invalid_session_and_self_edit_without_membership(client, db):
    guest = patch(client, {"first_name": "Changed"})
    assert guest.status_code == 401
    assert guest.json() == {"detail": "Not authenticated"}
    assert_private(guest)

    invalid = patch(client, {"first_name": "Changed"}, "not-a-session")
    assert invalid.status_code == 401
    assert_private(invalid)

    user = make_user(db)
    token = make_token(db, user)
    response = patch(client, {"first_name": " Sara "}, token)
    assert response.status_code == 200
    assert_private(response)
    payload = response.json()
    assert set(payload) == {
        "id", "username", "email", "first_name", "family_name", "created_at", "updated_at", "avatar_url"
    }
    assert payload["avatar_url"] is None
    assert payload["id"] == str(user.id)
    assert payload["username"] == "profile_user"
    assert payload["email"] == user.email
    assert payload["first_name"] == "Sara"
    assert payload["family_name"] == "Account"
    assert payload["updated_at"]


def test_banned_membership_does_not_block_own_profile_edit(client, db):
    user = make_user(db)
    community = Community(name="Synthetic community", slug=f"synthetic-{uuid4().hex[:8]}")
    db.add(community)
    db.flush()
    db.add(Membership(
        user_id=user.id,
        community_id=community.id,
        cne="MASSAR1234",
        applicant_type=MembershipApplicantType.STUDENT,
        applicant_first_name="Submitted",
        applicant_family_name="Applicant",
        identifier_type=MembershipIdentifierType.MASSAR,
        promotion=None,
        status=MembershipStatus.BANNED,
        role=MembershipRole.MEMBER,
    ))
    db.commit()

    response = patch(client, {"family_name": "El Mansouri"}, make_token(db, user))
    assert response.status_code == 200
    assert response.json()["family_name"] == "El Mansouri"


def test_partial_empty_and_identical_updates_preserve_unmentioned_fields(client, db):
    user = make_user(db)
    token = make_token(db, user)
    original_updated = user.updated_at
    original_session = db.query(SessionModel).filter_by(user_id=user.id).one()
    original_session_id = original_session.id
    original_session_revoked = original_session.is_revoked
    session_before = tuple(getattr(original_session, field) for field in (
        "id", "user_id", "token_hash", "is_revoked", "created_at", "expires_at",
    ))
    created_at_before = user.created_at

    no_body_changes = patch(client, {}, token)
    identical = patch(client, {"username": "profile_user", "first_name": "Original"}, token)
    assert no_body_changes.status_code == identical.status_code == 200
    assert no_body_changes.json()["updated_at"] == identical.json()["updated_at"]
    db.refresh(user)
    assert user.updated_at == original_updated

    partial = patch(client, {"username": "NewName"}, token)
    assert partial.status_code == 200
    assert partial.json()["username"] == "NewName"
    assert partial.json()["first_name"] == "Original"
    assert partial.json()["family_name"] == "Account"
    assert partial.json()["email"] == user.email
    assert partial.json()["id"] == str(user.id)

    db.refresh(user)
    db.refresh(original_session)
    assert user.password_hash == "stored-hash"
    assert original_session.id == original_session_id
    assert original_session.is_revoked is original_session_revoked is False
    assert tuple(getattr(original_session, field) for field in (
        "id", "user_id", "token_hash", "is_revoked", "created_at", "expires_at",
    )) == session_before
    assert db.query(SessionModel).filter_by(user_id=user.id).count() == 1
    assert user.created_at == created_at_before
    refreshed = client.get("/api/v1/auth/me", cookies={settings.session_cookie_name: token})
    assert refreshed.status_code == 200
    assert refreshed.json()["username"] == "NewName"


@pytest.mark.parametrize(
    "body",
    [
        {"username": None},
        {"first_name": ""},
        {"first_name": "  \t "},
        {"family_name": "\n"},
        {"username": "ab"},
        {"username": "x" * 51},
        {"first_name": "x" * 101},
        {"family_name": "bad\x00name"},
        {"family_name": "bad\u202ename"},
        {"first_name": "bad\u2066name"},
        {"username": 123},
        {"first_name": ["not", "text"]},
        {"username": True},
    ],
)
def test_invalid_profile_values_are_sanitized_and_private(client, db, body):
    user = make_user(db)
    before = (user.username, user.first_name, user.family_name, user.updated_at)
    response = patch(client, body, make_token(db, user))
    assert response.status_code == 422
    assert_private(response)
    for error in response.json()["detail"]:
        assert set(error) == {"loc", "type", "msg"}
        assert "input" not in error
        assert "ctx" not in error
    db.refresh(user)
    assert (user.username, user.first_name, user.family_name, user.updated_at) == before


@pytest.mark.parametrize("body", [[], "hello", 4, None])
def test_non_object_json_is_rejected(client, db, body):
    user = make_user(db)
    # HTTPX json=None sends an empty body without JSON Content-Type, not null.
    response = patch(
        client, json.dumps(body).encode(), make_token(db, user),
        headers={"Content-Type": "application/json"}, raw=True,
    )
    assert response.status_code == 422
    assert_private(response)
    assert "input" not in str(response.json())


def test_lone_surrogate_is_rejected_without_echo(client, db):
    user = make_user(db)
    response = client.patch(
        "/api/v1/auth/me",
        content=b'{"family_name":"bad\\ud800name"}',
        headers={"Origin": settings.frontend_url, "Content-Type": "application/json"},
        cookies={settings.session_cookie_name: make_token(db, user)},
    )
    assert response.status_code == 422
    assert_private(response)
    assert "bad" not in response.text


def test_unicode_and_exact_length_boundaries_are_preserved(client, db):
    user = make_user(db)
    response = patch(
        client,
        {"username": "x" * 50, "first_name": "عائشة", "family_name": "É" * 100},
        make_token(db, user),
    )
    assert response.status_code == 200
    assert response.json()["username"] == "x" * 50
    assert response.json()["first_name"] == "عائشة"
    assert response.json()["family_name"] == "É" * 100

    response = patch(client, {"username": "x" * 3, "first_name": "A", "family_name": "é"}, make_token(db, user))
    assert response.status_code == 200


@pytest.mark.parametrize(
    "extra",
    [
        {"email": "private@example.test"},
        {"password": "secret-value"},
        {"avatar": "x"},
        {"avatar_url": "/api/v1/users/other/avatar/version"},
        {"avatar_storage_key": "avatars/forbidden"},
        {"role": "DELEGATE"},
        {"permissions": ["anything"]},
        {"is_admin": True},
        {"account_status": "ACTIVE"},
        {"user_id": str(uuid4())},
        {"cne": "private-cne"},
        {"applicant_first_name": "Private"},
    ],
)
def test_extra_and_forbidden_fields_are_rejected_without_echo(client, db, extra):
    user = make_user(db)
    response = patch(client, {"first_name": "Would change", **extra}, make_token(db, user))
    assert response.status_code == 422
    assert_private(response)
    assert "secret-value" not in response.text
    assert "private@example.test" not in response.text
    assert "private-cne" not in response.text
    db.refresh(user)
    assert user.first_name == "Original"


@pytest.mark.parametrize("origin", [None, "null", "https://evil.invalid", "http://localhost:3000.attacker.invalid"])
def test_origin_denial_precedes_body_and_auth_validation(client, origin):
    headers = {"Content-Type": "application/json"}
    if origin is not None:
        headers["Origin"] = origin
    response = client.patch("/api/v1/auth/me", content=b"{ malformed", headers=headers)
    assert response.status_code == 403
    assert response.json() == {"detail": "Untrusted request origin"}
    assert_private(response)


def test_authenticated_origin_then_authentication_precedes_json_validation(client, db):
    headers = {"Origin": settings.frontend_url, "Content-Type": "application/json"}
    guest = client.patch("/api/v1/auth/me", content=b"{ malformed", headers=headers)
    assert guest.status_code == 401
    assert_private(guest)

    user = make_user(db)
    response = client.patch(
        "/api/v1/auth/me",
        content=b"{ malformed",
        headers=headers,
        cookies={settings.session_cookie_name: make_token(db, user)},
    )
    assert response.status_code == 422
    assert_private(response)
    assert "malformed" not in response.text
    assert "input" not in response.text


def test_media_type_and_bounded_body_fail_with_private_errors(client, db):
    user = make_user(db)
    token = make_token(db, user)
    wrong_media = patch(
        client,
        b'{"first_name":"X"}',
        token,
        headers={"Content-Type": "text/plain"},
        raw=True,
    )
    assert wrong_media.status_code == 415
    assert_private(wrong_media)

    too_large = client.patch(
        "/api/v1/auth/me",
        content=b" " * (account_mutation_route.MAX_ACCOUNT_JSON_BYTES + 1),
        headers={"Origin": settings.frontend_url, "Content-Type": "application/json"},
        cookies={settings.session_cookie_name: token},
    )
    assert too_large.status_code == 413
    assert_private(too_large)


def test_username_collision_rolls_back_other_changed_fields(client, db):
    owner = make_user(db, "taken_name")
    user = make_user(db, "caller_name")
    token = make_token(db, user)
    before = (user.username, user.first_name, user.family_name, user.updated_at)

    response = patch(client, {"username": owner.username, "first_name": "Must roll back"}, token)
    assert response.status_code == 409
    assert response.json() == {"detail": "Username is already taken."}
    assert_private(response)
    db.refresh(user)
    assert (user.username, user.first_name, user.family_name, user.updated_at) == before


def test_injected_commit_failure_rolls_back_profile_state(client, db, monkeypatch):
    user = make_user(db)
    token = make_token(db, user)
    original_update = auth_endpoint.update_user_profile

    commit_attempts = []

    def failing_update(db, user_id, profile_in):
        def fail_commit(_session):
            commit_attempts.append(True)
            raise RuntimeError("injected commit failure")

        event.listen(db, "before_commit", fail_commit, once=True)
        return original_update(db, user_id, profile_in)

    monkeypatch.setattr(auth_endpoint, "update_user_profile", failing_update)
    response = patch(client, {"username": "changed_name", "first_name": "Changed"}, token)
    assert response.status_code == 500
    assert response.json() == {"detail": "Account operation failed"}
    assert_private(response)
    assert "injected commit failure" not in response.text
    assert commit_attempts == [True]

    db.expire_all()
    persisted = db.query(User).filter_by(id=user.id).one()
    assert (persisted.username, persisted.first_name, persisted.family_name) == (
        "profile_user", "Original", "Account"
    )


def test_membership_application_values_permissions_and_timestamps_remain_unchanged(client, db):
    user = make_user(db)
    communities = [
        Community(name="Synthetic A", slug=f"synthetic-a-{uuid4().hex[:8]}"),
        Community(name="Synthetic B", slug=f"synthetic-b-{uuid4().hex[:8]}"),
    ]
    db.add_all(communities)
    db.flush()
    memberships = [
        Membership(
            user_id=user.id,
            community_id=communities[0].id,
            cne="M123456789",
            applicant_type=MembershipApplicantType.STUDENT,
            applicant_first_name="Submitted One",
            applicant_family_name="Applicant One",
            identifier_type=MembershipIdentifierType.MASSAR,
            promotion=None,
            status=MembershipStatus.BANNED,
            role=MembershipRole.MEMBER,
        ),
        Membership(
            user_id=user.id,
            community_id=communities[1].id,
            cne=None,
            applicant_type=MembershipApplicantType.LAUREATE,
            applicant_first_name="Submitted Two",
            applicant_family_name="Applicant Two",
            identifier_type=None,
            promotion="2025/2026",
            status=MembershipStatus.ACTIVE,
            role=MembershipRole.MODERATOR,
        ),
    ]
    db.add_all(memberships)
    db.flush()
    permission = MembershipPermission(
        membership_id=memberships[1].id,
        permission=PermissionType.CREATE_ANNOUNCEMENTS,
    )
    db.add(permission)
    db.commit()
    before = {
        membership.id: (
            membership.user_id,
            membership.community_id,
            membership.applicant_first_name,
            membership.applicant_family_name,
            membership.cne,
            membership.identifier_type,
            membership.applicant_type,
            membership.promotion,
            membership.status,
            membership.role,
            membership.created_at,
            membership.updated_at,
        )
        for membership in memberships
    }
    permission_id = permission.id
    permission_before = (permission.id, permission.membership_id, permission.permission)

    response = patch(
        client,
        {"username": "renamed_user", "first_name": "Account First", "family_name": "Account Family"},
        make_token(db, user),
    )
    assert response.status_code == 200
    db.expire_all()
    assert {membership.id: (
        membership.user_id,
        membership.community_id,
        membership.applicant_first_name,
        membership.applicant_family_name,
        membership.cne,
        membership.identifier_type,
        membership.applicant_type,
        membership.promotion,
        membership.status,
        membership.role,
        membership.created_at,
        membership.updated_at,
    ) for membership in db.query(Membership).filter_by(user_id=user.id).all()} == before
    assert db.query(MembershipPermission.id).filter_by(id=permission_id).scalar() == permission_id
    unchanged_permission = db.get(MembershipPermission, permission_id)
    assert (unchanged_permission.id, unchanged_permission.membership_id,
            unchanged_permission.permission) == permission_before


def test_authored_and_uploaded_content_keeps_user_uuid_and_projects_new_username(client, db):
    user = make_user(db)
    community = Community(name="Content test", slug=f"content-{uuid4().hex[:8]}")
    db.add(community)
    db.flush()
    db.add(Membership(user_id=user.id, community_id=community.id,
                      status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER))
    module = Module(community_id=community.id, name="Test module", slug="test-module")
    db.add(module)
    db.flush()
    announcement = Announcement(community_id=community.id, author_id=user.id, title="Notice", content="Body")
    post = CommunityPost(community_id=community.id, author_id=user.id, title="Question", content="Keep literal author text")
    db.add_all([announcement, post])
    db.flush()
    announcement_reply = AnnouncementReply(announcement_id=announcement.id, author_id=user.id, content="Reply")
    post_reply = CommunityPostReply(post_id=post.id, author_id=user.id, content="Post reply")
    message = DiscussionMessage(
        community_id=community.id,
        author_id=user.id,
        kind="TEXT",
        content="Message body stays literal",
        sticker_id=None,
        client_message_id=uuid4(),
    )
    document = Document(
        module_id=module.id,
        uploader_id=user.id,
        title="Upload",
        type=DocumentType.OTHER,
        source=DocumentSource.OFFICIAL,
        status=DocumentStatus.APPROVED,
        storage_path="test-only/object.pdf",
    )
    db.add_all([announcement_reply, post_reply, message, document])
    db.commit()
    ids = (announcement.id, announcement_reply.id, post.id, post_reply.id, message.id, document.id)

    token = make_token(db, user)
    response = patch(client, {"username": "current_public_name"}, token)
    assert response.status_code == 200
    db.expire_all()
    refreshed_announcement = db.get(Announcement, ids[0])
    refreshed_announcement_reply = db.get(AnnouncementReply, ids[1])
    refreshed_post = db.get(CommunityPost, ids[2])
    refreshed_post_reply = db.get(CommunityPostReply, ids[3])
    refreshed_message = db.get(DiscussionMessage, ids[4])
    refreshed_document = db.get(Document, ids[5])
    assert refreshed_announcement.author_username == "current_public_name"
    assert refreshed_announcement_reply.author_username == "current_public_name"
    assert refreshed_post.author_username == "current_public_name"
    assert refreshed_post_reply.author_username == "current_public_name"
    assert refreshed_message.author_username == "current_public_name"
    assert refreshed_announcement.author_id == refreshed_announcement_reply.author_id == user.id
    assert refreshed_post.author_id == refreshed_post_reply.author_id == user.id
    assert refreshed_message.author_id == refreshed_document.uploader_id == user.id
    assert refreshed_post.content == "Keep literal author text"
    assert refreshed_message.content == "Message body stays literal"
    base = f"/api/v1/communities/{community.slug}"
    for path, collection in (
        (f"{base}/announcements/{ids[0]}", False),
        (f"{base}/announcements/{ids[0]}/replies", True),
        (f"{base}/posts/{ids[2]}", False),
        (f"{base}/posts/{ids[2]}/replies", True),
        (f"{base}/discussion/messages", True),
    ):
        fresh = client.get(path, cookies={settings.session_cookie_name: token})
        assert fresh.status_code == 200
        values = fresh.json()["items"] if collection else [fresh.json()]
        assert values
        assert all(value["author_username"] == "current_public_name" for value in values)


@pytest.mark.parametrize("origin", [
    " http://localhost:3000", "http://local\thost:3000",
    "http://localhost:3000?", "http://localhost:3000#",
])
def test_malformed_origin_is_rejected_before_authentication(client, origin):
    response = client.patch(
        "/api/v1/auth/me", content=b"{}",
        headers={"Origin": origin, "Content-Type": "application/json"},
    )
    assert response.status_code == 403
    assert_private(response)


def test_duplicate_origin_is_rejected(client):
    response = client.patch(
        "/api/v1/auth/me", content=b"{}",
        headers=[("Origin", settings.frontend_url), ("Origin", "https://evil.invalid"),
                 ("Content-Type", "application/json")],
    )
    assert response.status_code == 403
    assert_private(response)


def test_surrogate_extra_field_produces_private_sanitized_validation_error(client, db):
    user = make_user(db)
    response = client.patch(
        "/api/v1/auth/me", content=b'{"\\ud800":"secret-extra-value"}',
        headers={"Origin": settings.frontend_url, "Content-Type": "application/json"},
        cookies={settings.session_cookie_name: make_token(db, user)},
    )
    assert response.status_code == 422
    assert_private(response)
    assert "secret-extra-value" not in response.text
    assert all(set(error) == {"loc", "type", "msg"} for error in response.json()["detail"])


@pytest.mark.parametrize("state", ["expired", "revoked", "missing-user"])
def test_invalid_session_states_deny_profile_changes(client, db, state):
    user = make_user(db)
    token = make_token(db, user)
    stored_session = db.query(SessionModel).filter_by(user_id=user.id).one()
    if state == "expired":
        stored_session.expires_at -= timedelta(days=2)
    elif state == "revoked":
        stored_session.is_revoked = True
    else:
        stored_session.user_id = uuid4()
    db.commit()
    response = patch(client, {"first_name": "Must not change"}, token)
    assert response.status_code == 401
    assert_private(response)
    db.refresh(user)
    assert user.first_name == "Original"


def test_dependency_revalidates_session_after_preflight(client, db, monkeypatch):
    user = make_user(db)
    token = make_token(db, user)
    validate = account_mutation_route.validate_session

    def revoke_after_preflight(db, raw_token):
        session = validate(db, raw_token)
        session.is_revoked = True
        db.commit()
        return session

    monkeypatch.setattr(account_mutation_route, "validate_session", revoke_after_preflight)
    response = patch(client, {"first_name": "Must not change"}, token)
    assert response.status_code == 401
    assert_private(response)
    db.refresh(user)
    assert user.first_name == "Original"


@pytest.mark.parametrize("failure", [False, True])
def test_preflight_and_dependency_database_sessions_are_closed(client, db, monkeypatch, failure):
    user = make_user(db)
    token = make_token(db, user)
    closes = []

    def tracked_factory():
        session = TestingSessionLocal()
        index = len(closes)
        closes.append(0)
        close = session.close

        def tracked_close():
            closes[index] += 1
            close()

        session.close = tracked_close
        return session

    def tracked_dependency():
        session = tracked_factory()
        try:
            yield session
        finally:
            session.close()

    monkeypatch.setattr(account_mutation_route, "SessionLocal", tracked_factory)
    app.dependency_overrides[get_db] = tracked_dependency
    if failure:
        def fail_validation(*_):
            raise RuntimeError("private database failure detail")
        monkeypatch.setattr(account_mutation_route, "validate_session", fail_validation)

    response = patch(client, {"first_name": "Changed"}, token)
    assert response.status_code == (500 if failure else 200)
    assert_private(response)
    assert closes == ([1] if failure else [1, 1])
    assert "private database failure detail" not in response.text


def test_partial_patch_preserves_omitted_legacy_values_and_other_account(client, db):
    caller = make_user(db, " legacy\tusername ")
    caller.first_name = " legacy\nname "
    other = make_user(db, "other_account")
    db.commit()
    response = patch(client, {"family_name": " Changed "}, make_token(db, caller))
    assert response.status_code == 200
    db.refresh(caller)
    db.refresh(other)
    assert caller.username == " legacy\tusername "
    assert caller.first_name == " legacy\nname "
    assert caller.family_name == "Changed"
    assert (other.username, other.first_name, other.family_name) == (
        "other_account", "Original", "Account",
    )


def test_body_limit_exact_boundary_and_stream_without_content_length(client, db):
    user = make_user(db)
    token = make_token(db, user)
    body = b'{"first_name":"AtLimit"}'
    limit = account_mutation_route.MAX_ACCOUNT_JSON_BYTES
    response = patch(client, body + b" " * (limit - len(body)), token,
                     headers={"Content-Type": "application/json; charset=utf-8"}, raw=True)
    assert response.status_code == 200
    assert_private(response)
    response = patch(client, (chunk for chunk in [b" " * limit, b" "]), token,
                     headers={"Content-Type": "application/json"}, raw=True)
    assert "content-length" not in response.request.headers
    assert response.status_code == 413
    assert_private(response)
    db.refresh(user)
    assert user.first_name == "AtLimit"


def test_invalid_encoding_and_content_length_have_private_sanitized_errors(client, db):
    user = make_user(db)
    token = make_token(db, user)
    response = patch(client, b'\xffsecret-body', token,
                     headers={"Content-Type": "application/json"}, raw=True)
    assert response.status_code == 400
    assert_private(response)
    assert "secret-body" not in response.text
    response = patch(client, {}, token, headers={"Content-Length": "invalid"})
    assert response.status_code == 400
    assert_private(response)


def test_negative_content_length_is_rejected_before_authentication(client):
    response = client.patch(
        "/api/v1/auth/me", content=b"{}",
        headers={"Origin": settings.frontend_url, "Content-Type": "application/json",
                 "Content-Length": "-1"},
    )
    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid Content-Length"}
    assert_private(response)


def test_production_trusts_only_configured_origin(client, db, monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "frontend_url", "https://etudsup.example")
    user = make_user(db)
    token = make_token(db, user)
    trusted = patch(client, {}, token)
    assert trusted.status_code == 200
    denied = patch(client, {}, token, headers={"Origin": "http://127.0.0.1:3000"})
    assert denied.status_code == 403
    assert_private(denied)


@pytest.mark.parametrize("existing,proposed", [("Sara", "sara"), ("Café", "Cafe\u0301")])
def test_case_and_unicode_normalization_forms_remain_distinct(client, db, existing, proposed):
    owner = make_user(db, existing)
    caller = make_user(db, "caller")
    response = patch(client, {"username": proposed}, make_token(db, caller))
    assert response.status_code == 200
    assert response.json()["username"] == proposed
    db.refresh(owner)
    assert owner.username == existing


def test_unrelated_integrity_failure_rolls_back_without_username_conflict_or_sql_leak(client, db, monkeypatch):
    user = make_user(db)
    token = make_token(db, user)
    original_update = auth_endpoint.update_user_profile
    attempts = []

    def failing_update(db, user_id, profile_in):
        def fail_commit(_session):
            attempts.append(True)
            raise IntegrityError("private SQL", {"private": "private parameter"},
                                 Exception("UNIQUE constraint failed: users.email"))
        event.listen(db, "before_commit", fail_commit, once=True)
        return original_update(db, user_id, profile_in)

    monkeypatch.setattr(auth_endpoint, "update_user_profile", failing_update)
    response = patch(client, {"first_name": "Must roll back"}, token)
    assert response.status_code == 500
    assert response.json() == {"detail": "Account operation failed"}
    assert_private(response)
    assert attempts == [True]
    db.refresh(user)
    assert user.first_name == "Original"
