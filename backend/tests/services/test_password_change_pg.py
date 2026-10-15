"""Guarded, disposable-schema PostgreSQL password/session race acceptance."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier, Event
from uuid import uuid4
import asyncio

from fastapi import HTTPException
from sqlalchemy import event, text
import httpx
import websockets

from acceptance.server import test_server as owned_test_server
from app.api import account_mutation_route
from app.api.v1.endpoints.discussion import check_ws_auth
from app.core.config import settings
from app.core.discussion import WS_REVALIDATION_INTERVAL_SECONDS
from app.core.security import hash_password, verify_password
from app.core.sessions import create_session, revoke_session, validate_session
from app.models.community import Community
from app.models.membership import (Membership, MembershipApplicantType,
                                   MembershipIdentifierType, MembershipRole, MembershipStatus)
from app.models.session import Session as AccountSession
from app.models.user import User
from app.schemas.user import UserLogin, UserPasswordChange, UserProfileUpdate
from app.services.auth import authenticate_user
from app.services import password as password_service
from app.services.password import change_password
from app.services.user import update_user_profile


OLD = "Old Password 1"
NEW = "New Password 2"


def account(factory):
    with factory() as db:
        user = User(username=uuid4().hex, email=f"{uuid4().hex}@example.com",
                    password_hash=hash_password(OLD), first_name="First", family_name="Family")
        db.add(user)
        db.commit()
        db.refresh(user)
        uid, email = user.id, user.email
        token1, _ = create_session(db, uid, timedelta(days=1))
        token2, _ = create_session(db, uid, timedelta(days=1))
        return uid, email, token1, token2


def change(factory, uid, token, *, current=OLD, new=NEW):
    with factory() as db:
        db.execute(text("SET LOCAL lock_timeout = '5s'"))
        db.execute(text("SET LOCAL statement_timeout = '12s'"))
        return change_password(db, uid, token, UserPasswordChange(current_password=current, new_password=new))


def test_concurrent_changes_serialize_and_revoke_both_sessions(isolated_pg):
    factory = isolated_pg.factory
    uid, _, token1, token2 = account(factory)
    other_uid, _, other_token, _ = account(factory)
    barrier = Barrier(2)

    def contender(token):
        barrier.wait(timeout=10)
        try:
            change(factory, uid, token)
            return "success"
        except HTTPException as exc:
            return exc.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(contender, (token1, token2)))
    assert set(results) == {401, "success"}
    with factory() as db:
        user = db.get(User, uid)
        assert verify_password(NEW, user.password_hash)
        assert not verify_password(OLD, user.password_hash)
        assert validate_session(db, token1) is None and validate_session(db, token2) is None
        assert all(s.is_revoked for s in db.query(AccountSession).filter_by(user_id=uid))
        assert validate_session(db, other_token).user_id == other_uid


def test_old_password_login_racing_change_cannot_leave_usable_session(isolated_pg):
    factory = isolated_pg.factory
    uid, email, token, _ = account(factory)
    verified = Event()
    allow_issue = Event()
    change_started = Event()

    def login():
        with factory() as db:
            db.execute(text("SET LOCAL lock_timeout = '5s'"))
            user = authenticate_user(db, UserLogin(email=email, password=OLD))
            verified.set()
            assert allow_issue.wait(timeout=10)
            issued, _ = create_session(db, user.id, timedelta(days=1))
            return issued

    def changing():
        change_started.set()
        change(factory, uid, token)

    with ThreadPoolExecutor(max_workers=2) as pool:
        login_future = pool.submit(login)
        assert verified.wait(timeout=10)
        change_future = pool.submit(changing)
        assert change_started.wait(timeout=3)
        # Login retains its User lock until session insertion commits.
        allow_issue.set()
        issued = login_future.result(timeout=15)
        change_future.result(timeout=15)
    with factory() as db:
        assert validate_session(db, issued) is None
        assert validate_session(db, token) is None
        assert verify_password(NEW, db.get(User, uid).password_hash)
    with factory() as db:
        try:
            authenticate_user(db, UserLogin(email=email, password=OLD))
        except HTTPException as exc:
            assert exc.status_code == 401
        else:
            raise AssertionError("old password authenticated after change")


def test_login_waiting_on_change_lock_rejects_old_password(isolated_pg, monkeypatch):
    factory = isolated_pg.factory
    uid, email, token, _ = account(factory)
    hashing = Event()
    release = Event()
    login_query_started = Event()
    actual_hash = password_service.hash_password

    def pause_while_user_locked(value):
        hashing.set()
        assert release.wait(timeout=10)
        return actual_hash(value)

    monkeypatch.setattr(password_service, "hash_password", pause_while_user_locked)

    def observe_login_query(_conn, _cursor, statement, *_):
        if "FROM users" in statement and "FOR UPDATE" in statement.upper():
            login_query_started.set()

    def old_login():
        with factory() as db:
            db.execute(text("SET LOCAL lock_timeout = '5s'"))
            try:
                user = authenticate_user(db, UserLogin(email=email, password=OLD))
                issued, _ = create_session(db, user.id, timedelta(days=1))
                return issued
            except HTTPException as exc:
                return exc.status_code

    pool = ThreadPoolExecutor(max_workers=2)
    try:
        change_future = pool.submit(change, factory, uid, token)
        assert hashing.wait(timeout=10)
        event.listen(isolated_pg.engine, "before_cursor_execute", observe_login_query)
        login_future = pool.submit(old_login)
        assert login_query_started.wait(timeout=10), "login did not reach its User lock"
        release.set()
        change_future.result(timeout=15)
        assert login_future.result(timeout=15) == 401
    finally:
        release.set()
        event.remove(isolated_pg.engine, "before_cursor_execute", observe_login_query)
        pool.shutdown(wait=True)
    with factory() as db:
        assert verify_password(NEW, db.get(User, uid).password_hash)


def test_failed_commit_preserves_hash_and_all_sessions(isolated_pg):
    factory = isolated_pg.factory
    uid, _, token1, token2 = account(factory)
    with factory() as db:
        original = db.get(User, uid).password_hash
    with factory() as db:
        def fail(_):
            raise RuntimeError("injected commit failure")
        event.listen(db, "before_commit", fail, once=True)
        try:
            change_password(db, uid, token1,
                            UserPasswordChange(current_password=OLD, new_password=NEW))
        except RuntimeError:
            pass
        else:
            raise AssertionError("commit failure was not exercised")
    with factory() as db:
        assert db.get(User, uid).password_hash == original
        assert validate_session(db, token1) is not None
        assert validate_session(db, token2) is not None


def test_new_password_login_issues_usable_session_after_revocation(isolated_pg):
    factory = isolated_pg.factory
    uid, email, old1, old2 = account(factory)
    change(factory, uid, old1)
    with factory() as db:
        user = authenticate_user(db, UserLogin(email=email, password=NEW))
        fresh, _ = create_session(db, user.id, timedelta(days=1))
    with factory() as db:
        assert validate_session(db, old1) is None
        assert validate_session(db, old2) is None
        active = validate_session(db, fresh)
        assert active is not None and active.user_id == uid


def test_password_change_waits_for_profile_and_preserves_both_edits(isolated_pg):
    factory = isolated_pg.factory
    uid, email, token, _ = account(factory)
    with factory() as db:
        communities = [Community(slug=f"profile-race-{uuid4().hex}", name="Race") for _ in range(2)]
        db.add_all(communities)
        db.flush()
        memberships = [Membership(
            user_id=uid, community_id=community.id,
            status=MembershipStatus.BANNED if index == 0 else MembershipStatus.ACTIVE,
            role=MembershipRole.MEMBER,
            applicant_type=MembershipApplicantType.STUDENT,
            identifier_type=MembershipIdentifierType.MASSAR,
            applicant_first_name=f"Submitted {index}", applicant_family_name="Family",
            cne=f"CNE{index}", promotion="2026",
        ) for index, community in enumerate(communities)]
        db.add_all(memberships)
        db.commit()
        original = [(row.id, row.community_id, row.status, row.role, row.applicant_type,
                     row.identifier_type, row.applicant_first_name, row.applicant_family_name,
                     row.cne, row.promotion, row.created_at, row.updated_at) for row in memberships]

    profile_locked = Event()
    release_profile = Event()
    change_query_started = Event()

    def profile():
        with factory() as db:
            db.execute(text("SET LOCAL lock_timeout = '5s'"))
            db.execute(text("SET LOCAL statement_timeout = '12s'"))
            locked = db.query(User).filter_by(id=uid).with_for_update().one()
            locked.family_name = "Parallel Family"
            db.flush()
            profile_locked.set()
            assert release_profile.wait(timeout=10)
            # This is a real profile service call in the held transaction. It
            # refreshes the locked row, assigns only the supplied first name,
            # and commits both profile changes before password can proceed.
            update_user_profile(db, uid, UserProfileUpdate(first_name="Parallel First"))

    def observe_change_query(_conn, _cursor, statement, *_):
        if "FROM users" in statement and "FOR UPDATE" in statement.upper():
            change_query_started.set()

    pool = ThreadPoolExecutor(max_workers=2)
    listener_added = False
    try:
        profile_future = pool.submit(profile)
        assert profile_locked.wait(timeout=10)
        event.listen(isolated_pg.engine, "before_cursor_execute", observe_change_query)
        listener_added = True
        change_future = pool.submit(change, factory, uid, token)
        assert change_query_started.wait(timeout=10), "password change did not reach the User lock"
        release_profile.set()
        profile_future.result(timeout=15)
        change_future.result(timeout=15)
    finally:
        release_profile.set()
        if listener_added:
            event.remove(isolated_pg.engine, "before_cursor_execute", observe_change_query)
        pool.shutdown(wait=True)

    with factory() as db:
        user = db.get(User, uid)
        assert (user.id, user.email, user.first_name, user.family_name) == (
            uid, email, "Parallel First", "Parallel Family"
        )
        assert verify_password(NEW, user.password_hash)
        assert validate_session(db, token) is None
        actual = [(row.id, row.community_id, row.status, row.role, row.applicant_type,
                   row.identifier_type, row.applicant_first_name, row.applicant_family_name,
                   row.cne, row.promotion, row.created_at, row.updated_at)
                  for row in db.query(Membership).filter_by(user_id=uid)]
        assert sorted(actual, key=str) == sorted(original, key=str)


def test_profile_waiting_on_password_lock_does_not_restore_old_hash(isolated_pg, monkeypatch):
    factory = isolated_pg.factory
    uid, email, token, _ = account(factory)
    hashing = Event()
    release = Event()
    profile_query_started = Event()
    actual_hash = password_service.hash_password

    def pause_hash(value):
        hashing.set()
        assert release.wait(timeout=10)
        return actual_hash(value)

    def observe_profile_query(_conn, _cursor, statement, *_):
        if "FROM users" in statement and "FOR UPDATE" in statement.upper():
            profile_query_started.set()

    monkeypatch.setattr(password_service, "hash_password", pause_hash)

    def profile():
        with factory() as db:
            db.execute(text("SET LOCAL lock_timeout = '5s'"))
            db.execute(text("SET LOCAL statement_timeout = '12s'"))
            # Simulate an ORM User already present from a dependency before
            # waiting for the service's fresh row lock.
            stale = db.get(User, uid)
            assert verify_password(OLD, stale.password_hash)
            update_user_profile(db, uid, UserProfileUpdate(first_name="After Change"))

    pool = ThreadPoolExecutor(max_workers=2)
    listener_added = False
    try:
        change_future = pool.submit(change, factory, uid, token)
        assert hashing.wait(timeout=10)
        event.listen(isolated_pg.engine, "before_cursor_execute", observe_profile_query)
        listener_added = True
        profile_future = pool.submit(profile)
        assert profile_query_started.wait(timeout=10), "profile did not reach its User lock"
        release.set()
        change_future.result(timeout=15)
        profile_future.result(timeout=15)
    finally:
        release.set()
        if listener_added:
            event.remove(isolated_pg.engine, "before_cursor_execute", observe_profile_query)
        pool.shutdown(wait=True)

    with factory() as db:
        user = db.get(User, uid)
        assert (user.id, user.email, user.first_name, user.family_name) == (
            uid, email, "After Change", "Family"
        )
        assert verify_password(NEW, user.password_hash)
        assert validate_session(db, token) is None


def test_password_change_rejects_session_revoked_after_dependency_observation(isolated_pg):
    factory = isolated_pg.factory
    uid, _, token, _ = account(factory)
    with factory() as request_db:
        # Mirror get_current_user's resolved User and cached Session state.
        observed = validate_session(request_db, token)
        assert observed is not None and observed.user_id == uid
        resolved_user = request_db.get(User, uid)
        original_hash = resolved_user.password_hash
        with factory() as logout_db:
            assert revoke_session(logout_db, observed.id)
        try:
            change_password(request_db, resolved_user.id, token,
                            UserPasswordChange(current_password=OLD, new_password=NEW))
        except HTTPException as exc:
            assert exc.status_code == 401 and exc.detail == "Not authenticated"
        else:
            raise AssertionError("revoked initiating session authorized the change")
    with factory() as db:
        assert db.get(User, uid).password_hash == original_hash
        assert validate_session(db, token) is None


def test_live_socket_closes_on_password_revocation_at_policy_interval(isolated_pg, monkeypatch):
    assert WS_REVALIDATION_INTERVAL_SECONDS == 30
    factory = isolated_pg.factory
    uid, _, token, _ = account(factory)
    with factory() as db:
        community = Community(slug=f"password-ws-{uuid4().hex}", name="Password WS")
        db.add(community)
        db.flush()
        db.add(Membership(user_id=uid, community_id=community.id,
                          status=MembershipStatus.ACTIVE, role=MembershipRole.MEMBER))
        db.commit()
        slug = community.slug

    # The route preflight uses its own session factory, whereas the owned
    # server overrides get_db and the discussion check factory separately.
    monkeypatch.setattr(account_mutation_route, "SessionLocal", factory)

    async def workflow(port):
        uri = f"ws://127.0.0.1:{port}/api/v1/communities/{slug}/discussion/ws"
        async with websockets.connect(uri, origin=settings.frontend_url,
                                      additional_headers={"Cookie": f"{settings.session_cookie_name}={token}"}) as ws:
            assert check_ws_auth(token, slug) == (True, uid, None)
            with httpx.Client(base_url=f"http://127.0.0.1:{port}", trust_env=False, timeout=10) as client:
                response = await asyncio.to_thread(
                    client.post, "/api/v1/auth/me/password",
                    json={"current_password": OLD, "new_password": NEW},
                    headers={"Origin": settings.frontend_url,
                             "Cookie": f"{settings.session_cookie_name}={token}"},
                )
            assert response.status_code == 204 and response.content == b""
            assert check_ws_auth(token, slug)[0] is False
            try:
                await asyncio.wait_for(ws.recv(), timeout=50)
            except websockets.exceptions.ConnectionClosed as closed:
                assert closed.rcvd is not None and closed.rcvd.code == 1008
            else:
                raise AssertionError("revoked WebSocket remained open past revalidation")

    with owned_test_server(isolated_pg) as port:
        asyncio.run(workflow(port))
