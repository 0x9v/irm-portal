"""Directory contract on SQLite and PostgreSQL in a uniquely owned test schema.

SQLite uses local metadata. PostgreSQL requires the guarded runner-owned migrated
schema; reset is qualified and verified before synthetic fixture writes.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from acceptance.isolation import TABLES
from app.core.config import settings
from app.core.sessions import create_session
from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models.community import Community
from app.models.management_event import ManagementEvent
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.membership_permission import MembershipPermission, PermissionType
from app.models.user import User
from app.services.membership import list_community_memberships

ROOT = "/api/v1/communities/irm/memberships"
FIELDS = {"id", "username", "status", "role", "created_at", "updated_at"}


@pytest.fixture(params=["sqlite", "postgresql"])
def directory(request):
    owned = None
    if request.param == "postgresql":
        owned = request.getfixturevalue("isolated_pg")
        engine = owned.engine
        with owned.factory() as session:
            owned.truncate(session, sorted(TABLES))
            session.commit()
    else:
        engine = create_engine("sqlite:///:memory:", poolclass=StaticPool,
                               connect_args={"check_same_thread": False})
    previous_overrides = app.dependency_overrides.copy()
    db = None
    try:
        if owned is None:
            Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine, autoflush=False)
        db = factory()

        def override_db():
            with factory() as session:
                yield session

        app.dependency_overrides[get_db] = override_db
        communities = {}
        for slug in ["irm", "foreign"]:
            communities[slug] = Community(id=uuid4(), slug=slug, name=slug, document_vote_threshold=10)
            db.add(communities[slug])
        db.flush()
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        members, users, tokens, sessions = {}, {}, {}, {}
        definitions = [
            ("delegate", "irm", "ACTIVE", "DELEGATE"),
            ("foreign_delegate", "foreign", "ACTIVE", "DELEGATE"),
            ("member", "irm", "ACTIVE", "MEMBER"),
            ("moderator", "irm", "ACTIVE", "MODERATOR"),
            ("pending", "irm", "PENDING", "MEMBER"),
            ("rejected", "irm", "REJECTED", "MEMBER"),
            ("removed", "irm", "REMOVED", "MEMBER"),
            ("banned", "irm", "BANNED", "MEMBER"),
            ("outsider", None, None, None),
        ]
        for i, (name, slug, state, role) in enumerate(definitions, start=1):
            user = User(id=uuid4(), username=f"actual_{name}", email=f"{name}@private.invalid",
                        password_hash="private-password-hash", first_name="PrivateFirst", family_name="PrivateFamily")
            db.add(user)
            db.flush()
            users[name] = user
            if slug:
                members[name] = Membership(id=UUID(int=i), user_id=user.id, community_id=communities[slug].id,
                                           cne=f"PRIVATE_CNE_{name}", status=MembershipStatus(state),
                                           role=MembershipRole(role), created_at=now, updated_at=now)
                db.add(members[name])
                db.flush()
            tokens[name], sessions[name] = create_session(db, user.id, timedelta(hours=1))
        for permission in PermissionType:
            db.add(MembershipPermission(membership_id=members["moderator"].id, permission=permission))
        db.commit()

        def client(name="delegate"):
            result = TestClient(app)
            if name:
                result.cookies.set(settings.session_cookie_name, tokens[name])
            return result

        yield SimpleNamespace(db=db, engine=engine, members=members, users=users,
                              tokens=tokens, sessions=sessions, communities=communities, client=client)
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous_overrides)
        if db is not None:
            db.close()
        if owned is None:
            engine.dispose()


def assert_private(response, code):
    assert response.status_code == code, response.text
    assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.parametrize("name", [None, "outsider", "foreign_delegate", "member", "moderator",
                                  "pending", "rejected", "removed", "banned"])
def test_authorization(directory, name):
    response = directory.client(name).get(ROOT)
    assert_private(response, 401 if name is None else 403)
    assert "items" not in response.json()


@pytest.mark.parametrize("state", ["PENDING", "REJECTED", "REMOVED", "BANNED"])
def test_inactive_delegate_denied(directory, state):
    directory.members["delegate"].status = MembershipStatus(state)
    directory.db.commit()
    assert_private(directory.client().get(ROOT), 403)


@pytest.mark.parametrize("state", ["invalid", "expired", "revoked"])
def test_invalid_sessions(directory, state):
    client = directory.client()
    session = directory.sessions["delegate"]
    if state == "invalid":
        client.cookies.set(settings.session_cookie_name, "unknown-token")
    elif state == "expired":
        session.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
    else:
        session.is_revoked = True
    directory.db.commit()
    assert_private(client.get(ROOT), 401)


def test_scoping_unknown_community_and_authority_loss(directory):
    client = directory.client()
    assert_private(client.get("/api/v1/communities/foreign/memberships"), 403)
    assert_private(client.get("/api/v1/communities/missing/memberships"), 404)
    assert_private(client.get(ROOT), 200)
    directory.members["delegate"].role = MembershipRole.MEMBER
    directory.db.commit()
    assert_private(client.get(ROOT), 403)
    foreign = directory.client("foreign_delegate").get("/api/v1/communities/foreign/memberships")
    assert_private(foreign, 200)
    assert [x["username"] for x in foreign.json()["items"]] == ["actual_foreign_delegate"]


@pytest.mark.parametrize("state", list(MembershipStatus))
def test_each_status_filter_including_banned(directory, state):
    response = directory.client().get(ROOT, params={"status": state.value})
    assert_private(response, 200)
    expected = {str(m.id) for name, m in directory.members.items()
                if name != "foreign_delegate" and m.status == state}
    assert {x["id"] for x in response.json()["items"]} == expected
    assert all(x["status"] == state.value for x in response.json()["items"])
    assert response.json()["next_cursor"] is None


def test_minimal_real_usernames_and_no_private_fields(directory):
    response = directory.client().get(ROOT)
    assert_private(response, 200)
    assert set(response.json()) == {"items", "next_cursor"}
    rows = response.json()["items"]
    assert len(rows) == 7
    for row in rows:
        assert set(row) == FIELDS
        member = next(m for m in directory.members.values() if str(m.id) == row["id"])
        assert row["username"] == directory.db.get(User, member.user_id).username
        assert row["created_at"] and row["updated_at"]
    secrets = ["PRIVATE_CNE", "private.invalid", "private-password-hash", "PrivateFirst", "PrivateFamily",
               *directory.tokens.values(), *(str(u.id) for u in directory.users.values()),
               *(s.token_hash for s in directory.sessions.values())]
    for secret in secrets:
        assert secret not in response.text
    assert directory.db.query(ManagementEvent).count() == 0


def test_keyset_order_ties_lookahead_and_terminal_page(directory):
    client = directory.client()
    expected = sorted([str(m.id) for name, m in directory.members.items() if name != "foreign_delegate"], reverse=True)
    seen, after = [], None
    for _ in range(4):
        params = {"limit": 2}
        if after:
            params["after"] = after
        response = client.get(ROOT, params=params)
        assert_private(response, 200)
        page = response.json()
        assert len(page["items"]) <= 2
        seen.extend(x["id"] for x in page["items"])
        after = page["next_cursor"]
        if after:
            assert after == page["items"][-1]["id"]
    assert seen == expected
    assert after is None
    assert client.get(ROOT, params={"after": seen[-1]}).json() == {"items": [], "next_cursor": None}


def test_created_at_order_and_insertion_between_pages(directory):
    directory.members["member"].created_at += timedelta(days=1)
    directory.db.commit()
    client = directory.client()
    page = client.get(ROOT, params={"limit": 1}).json()
    assert page["items"][0]["id"] == str(directory.members["member"].id)
    user = User(id=uuid4(), username="newer", email="newer@test.invalid", password_hash="h", first_name="N", family_name="U")
    directory.db.add(user)
    directory.db.flush()
    directory.db.add(Membership(user_id=user.id, community_id=directory.communities["irm"].id, cne="newer",
                                status=MembershipStatus.BANNED, created_at=datetime(2026, 1, 3, tzinfo=timezone.utc)))
    directory.db.commit()
    rest = client.get(ROOT, params={"after": page["next_cursor"]}).json()
    assert len(rest["items"]) == 6
    assert "newer" not in {x["username"] for x in rest["items"]}
    assert page["items"][0]["id"] not in {x["id"] for x in rest["items"]}


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": -1}, {"limit": 101}, {"limit": "x"},
                                   {"status": "ALL"}, {"status": "banned"}, {"after": "not-a-uuid"}])
def test_query_validation(directory, params):
    assert_private(directory.client().get(ROOT, params=params), 422)


def test_cursor_validation(directory):
    client = directory.client()
    for params in [{"after": str(uuid4())}, {"after": str(directory.members["foreign_delegate"].id)},
                   {"status": "BANNED", "after": str(directory.members["member"].id)}]:
        assert_private(client.get(ROOT, params=params), 400)
    assert_private(directory.client("member").get(ROOT, params={"after": str(uuid4())}), 403)


@pytest.mark.parametrize("limit", [0, 101])
def test_service_limit_defense(directory, limit):
    with pytest.raises(HTTPException) as error:
        list_community_memberships(directory.db, "irm", limit=limit)
    assert error.value.status_code == 422


def test_default_and_maximum_page_bounds(directory):
    for i in range(110):
        user = User(id=uuid4(), username=f"extra_{i}", email=f"extra_{i}@test.invalid",
                    password_hash="hash", first_name="First", family_name="Family")
        directory.db.add(user)
        directory.db.flush()
        directory.db.add(Membership(id=uuid4(), user_id=user.id, community_id=directory.communities["irm"].id,
                                    cne=f"extra_{i}", status=MembershipStatus.BANNED))
    directory.db.commit()
    client = directory.client()
    for params, size in [({}, 20), ({"limit": 100}, 100)]:
        response = client.get(ROOT, params=params)
        assert_private(response, 200)
        assert len(response.json()["items"]) == size
        assert response.json()["next_cursor"]


def test_filtered_pages_and_status_change_requires_refresh(directory):
    client = directory.client()
    first = client.get(ROOT, params={"status": "ACTIVE", "limit": 1}).json()
    after = first["next_cursor"]
    second = client.get(ROOT, params={"status": "ACTIVE", "limit": 1, "after": after}).json()
    assert first["items"][0]["id"] != second["items"][0]["id"]
    assert second["next_cursor"]
    third = client.get(ROOT, params={"status": "ACTIVE", "limit": 1, "after": second["next_cursor"]}).json()
    assert third["next_cursor"] is None
    anchor = directory.db.get(Membership, UUID(after))
    anchor.status = MembershipStatus.BANNED
    directory.db.commit()
    assert_private(client.get(ROOT, params={"status": "ACTIVE", "after": after}), 400)
    assert_private(client.get(ROOT, params={"after": after}), 200)


def test_remove_ban_unban_contracts_and_directory_refresh(directory):
    client = directory.client()
    member_id = str(directory.members["member"].id)
    for method, suffix, expected in [("delete", "", "REMOVED"), ("put", "/ban", "BANNED"),
                                      ("delete", "/ban", "REMOVED")]:
        response = getattr(client, method)(f"{ROOT}/{member_id}{suffix}")
        assert_private(response, 204)
        assert response.content == b""
        listing = client.get(ROOT, params={"status": expected}).json()
        assert member_id in {x["id"] for x in listing["items"]}
    for state in ["ACTIVE", "BANNED"]:
        assert member_id not in {x["id"] for x in client.get(ROOT, params={"status": state}).json()["items"]}


def test_service_query_is_bounded_and_projects_only_public_fields(directory):
    statements = []
    bound_parameters = []

    def record(_conn, _cursor, statement, parameters, _context, _many):
        statements.append(statement.lower())
        bound_parameters.append(_context.compiled_parameters)

    event.listen(directory.engine, "before_cursor_execute", record)
    try:
        page = list_community_memberships(directory.db, "irm", limit=2)
    finally:
        event.remove(directory.engine, "before_cursor_execute", record)
    assert len(page.items) == 2
    assert len(statements) == 2  # Community resolution and one joined directory read; no N+1.
    query = statements[-1]
    assert "join users" in query and "limit" in query
    assert bound_parameters[-1][0]["param_1"] == 3  # Requested 2 plus one lookahead.
    for private_column in ["cne", "email", "password_hash", "first_name", "family_name", "token_hash"]:
        assert private_column not in query


def test_directory_reads_preserve_membership_timestamps_and_management_events(directory):
    def snapshot():
        directory.db.expire_all()
        return {
            str(row.id): (row.created_at, row.updated_at, row.status, row.role)
            for row in directory.db.query(Membership).all()
        }

    before = snapshot()
    events_before = directory.db.query(ManagementEvent).count()
    client = directory.client()
    for state in [None, "ACTIVE", "PENDING", "REJECTED", "REMOVED", "BANNED"]:
        params = {"limit": 2}
        if state:
            params["status"] = state
        assert_private(client.get(ROOT, params=params), 200)
    assert snapshot() == before
    assert directory.db.query(ManagementEvent).count() == events_before


def test_empty_status_filter(directory):
    directory.members["banned"].status = MembershipStatus.REMOVED
    directory.db.commit()
    response = directory.client().get(ROOT, params={"status": "BANNED"})
    assert_private(response, 200)
    assert response.json() == {"items": [], "next_cursor": None}
