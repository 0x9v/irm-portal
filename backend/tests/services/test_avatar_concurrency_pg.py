"""Avatar pointer races using the guarded disposable PostgreSQL schema."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import text

from app.core.config import settings
from app.core.avatars import read_avatar
from app.core.sessions import create_session, validate_session
from app.core.security import hash_password, verify_password
from app.core.storage.local import LocalFileSystemStorage
from app.models.session import Session as AccountSession
from app.models.user import User
from app.schemas.user import UserPasswordChange, UserProfileUpdate
from app.services import avatar as avatar_service
from app.services.password import change_password
from app.services.user import update_user_profile


JPEG = b"\xff\xd8\xffavatar-test\xff\xd9"


def _account(factory, name=None):
    with factory() as db:
        user = User(
            username=f"avatar_{name or uuid4().hex}",
            email=f"{uuid4().hex}@example.test",
            password_hash="test-only-password-hash",
            first_name="First",
            family_name="Family",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        token, _ = create_session(db, user.id, timedelta(days=1))
        return user.id, token


def _configure(monkeypatch, isolated_pg, tmp_path):
    def timed_factory():
        db = isolated_pg.factory()
        db.execute(text("SET LOCAL lock_timeout = '5s'"))
        db.execute(text("SET LOCAL statement_timeout = '12s'"))
        return db

    monkeypatch.setattr(avatar_service, "SessionLocal", timed_factory)
    monkeypatch.setattr(settings, "storage_root", tmp_path / "avatar-storage")
    return LocalFileSystemStorage(settings.storage_root)


def _timeouts(db):
    db.execute(text("SET LOCAL lock_timeout = '5s'"))
    db.execute(text("SET LOCAL statement_timeout = '12s'"))


def _assert_current_file(factory, storage, user_id):
    with factory() as db:
        key = db.get(User, user_id).avatar_storage_key
    if key is None:
        return None
    version = avatar_service.parse_avatar_storage_key(key, user_id)
    assert read_avatar(storage, user_id, key).startswith(b"\xff\xd8")
    assert version is not None
    return key


def test_concurrent_replacements_leave_current_pointer_on_present_immutable_file(
    isolated_pg, monkeypatch, tmp_path
):
    factory = isolated_pg.factory
    user_id, token = _account(factory)
    storage = _configure(monkeypatch, isolated_pg, tmp_path)
    barrier = Barrier(2)

    def replace():
        with factory() as db:
            _timeouts(db)
            assert db.get(User, user_id) is not None
        barrier.wait(timeout=10)
        return avatar_service.replace_user_avatar(user_id, token, JPEG, storage)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = [pool.submit(replace) for _ in range(2)]
        urls = [future.result(timeout=20) for future in results]

    assert urls[0] != urls[1]
    current_key = _assert_current_file(factory, storage, user_id)
    assert current_key is not None
    assert sum(storage.exists(key) for key in (
        f"avatars/{user_id}/{url.rsplit('/', 1)[-1]}.jpg" for url in urls
    )) == 1


def test_concurrent_replacement_and_removal_leave_consistent_pointer_and_files(
    isolated_pg, monkeypatch, tmp_path
):
    factory = isolated_pg.factory
    user_id, token = _account(factory)
    storage = _configure(monkeypatch, isolated_pg, tmp_path)
    initial_url = avatar_service.replace_user_avatar(user_id, token, JPEG, storage)
    initial_key = f"avatars/{user_id}/{initial_url.rsplit('/', 1)[-1]}.jpg"
    barrier = Barrier(2)

    def replace():
        barrier.wait(timeout=10)
        return avatar_service.replace_user_avatar(user_id, token, JPEG, storage)

    def remove():
        barrier.wait(timeout=10)
        return avatar_service.remove_user_avatar(user_id, token, storage)

    with ThreadPoolExecutor(max_workers=2) as pool:
        replacement = pool.submit(replace)
        removal = pool.submit(remove)
        replacement.result(timeout=20)
        removal.result(timeout=20)

    final_key = _assert_current_file(factory, storage, user_id)
    if final_key is None:
        assert not storage.exists(initial_key)
    else:
        assert final_key != initial_key
        assert storage.exists(final_key)


def test_avatar_races_with_profile_and_password_mutations_without_stale_overwrite(
    isolated_pg, monkeypatch, tmp_path
):
    factory = isolated_pg.factory
    user_id, token = _account(factory)
    storage = _configure(monkeypatch, isolated_pg, tmp_path)
    barrier = Barrier(2)

    def avatar():
        barrier.wait(timeout=10)
        return avatar_service.replace_user_avatar(user_id, token, JPEG, storage)

    def profile():
        barrier.wait(timeout=10)
        with factory() as db:
            _timeouts(db)
            return update_user_profile(db, user_id, UserProfileUpdate(first_name="Concurrent"))

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(avatar), pool.submit(profile)]
        for future in futures:
            future.result(timeout=20)

    assert _assert_current_file(factory, storage, user_id) is not None
    with factory() as db:
        user = db.get(User, user_id)
        assert user.first_name == "Concurrent"
        assert user.username.startswith("avatar_")
        assert user.email.endswith("@example.test")
        account_session = db.query(AccountSession).filter_by(user_id=user_id).one()
        assert not account_session.is_revoked

    # The same User -> Session order serializes the avatar operation with a
    # password change. Depending on who acquires the User first, the avatar
    # commits before the password revokes this token, or is rejected after.
    outcome_barrier = Barrier(2)

    def second_avatar():
        outcome_barrier.wait(timeout=10)
        try:
            return avatar_service.replace_user_avatar(user_id, token, JPEG, storage)
        except HTTPException as error:
            return error.status_code

    def password():
        outcome_barrier.wait(timeout=10)
        with factory() as db:
            _timeouts(db)
            return change_password(
                db, user_id, token,
                UserPasswordChange(current_password="old-password", new_password="new-password"),
            )

    # Password verification normally depends on a valid hash. Install one
    # before the race; the avatar path itself never reads or modifies it.
    with factory() as db:
        db.get(User, user_id).password_hash = hash_password("old-password")
        db.commit()

    with ThreadPoolExecutor(max_workers=2) as pool:
        avatar_future = pool.submit(second_avatar)
        password_future = pool.submit(password)
        avatar_result = avatar_future.result(timeout=20)
        password_future.result(timeout=20)
    assert avatar_result == 401 or isinstance(avatar_result, str)
    with factory() as db:
        user = db.get(User, user_id)
        assert user.first_name == "Concurrent"
        assert verify_password("new-password", user.password_hash)
        assert validate_session(db, token) is None
        assert db.query(AccountSession).filter_by(user_id=user_id).one().is_revoked
    final_key = _assert_current_file(factory, storage, user_id)
    assert final_key is None or storage.exists(final_key)
