"""Concurrency coverage using only the guarded disposable PostgreSQL schema."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import event, text

from app.models.user import User
from app.schemas.user import UserProfileUpdate
from app.services.user import update_user_profile


def _create_user(factory, username: str) -> User:
    db = factory()
    try:
        user = User(
            username=username,
            email=f"{uuid4().hex}@example.test",
            password_hash="test-only-hash",
            first_name="First",
            family_name="Family",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    finally:
        db.close()


def test_two_users_racing_for_one_username_have_one_sanitized_conflict(isolated_pg):
    suffix = uuid4().hex
    users = [
        _create_user(isolated_pg.factory, f"racer_a_{suffix}"),
        _create_user(isolated_pg.factory, f"racer_b_{suffix}"),
    ]
    barrier = Barrier(2)
    original = {
        user.id: (user.username, user.first_name, user.family_name, user.email,
                  user.password_hash, user.created_at, user.updated_at)
        for user in users
    }

    def race(user):
        db = isolated_pg.factory()
        try:
            db.execute(text("SET LOCAL lock_timeout = '5s'"))
            db.execute(text("SET LOCAL statement_timeout = '10s'"))
            barrier.wait(timeout=10)
            try:
                changed = update_user_profile(
                    db, user.id, UserProfileUpdate(
                        username=f"winner_{suffix}", first_name="Winner First", family_name="Winner Family"
                    )
                )
                return ("ok", changed.username)
            except HTTPException as exc:
                return (exc.status_code, exc.detail)
        finally:
            db.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(race, users))

    assert sum(item[0] == "ok" for item in outcomes) == 1
    assert sum(
        item == ("ok", f"winner_{suffix}") for item in outcomes
    ) == 1
    assert sum(
        item == (409, "Username is already taken.") for item in outcomes
    ) == 1
    with isolated_pg.factory() as db:
        refreshed = db.query(User).filter(User.id.in_([user.id for user in users])).all()
        losers = [user for user in refreshed if user.username != f"winner_{suffix}"]
        assert len(losers) == 1
        loser = losers[0]
        assert (loser.username, loser.first_name, loser.family_name, loser.email,
                loser.password_hash, loser.created_at, loser.updated_at) == original[loser.id]
        winner = next(user for user in refreshed if user.username == f"winner_{suffix}")
        assert (winner.first_name, winner.family_name) == ("Winner First", "Winner Family")
        assert winner.created_at == original[winner.id][-2]


def test_concurrent_partial_patches_preserve_omitted_fields(isolated_pg):
    suffix = uuid4().hex
    user = _create_user(isolated_pg.factory, f"partial_{suffix}")
    barrier = Barrier(2)

    def patch(field, value):
        db = isolated_pg.factory()
        try:
            db.execute(text("SET LOCAL lock_timeout = '5s'"))
            db.execute(text("SET LOCAL statement_timeout = '10s'"))
            barrier.wait(timeout=10)
            return update_user_profile(db, user.id, UserProfileUpdate(**{field: value}))
        finally:
            db.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(patch, "first_name", "Concurrent First"),
            pool.submit(patch, "family_name", "Concurrent Family"),
        ]
        for future in futures:
            future.result(timeout=20)

    db = isolated_pg.factory()
    try:
        refreshed = db.query(User).filter(User.id == user.id).one()
        assert refreshed.username == f"partial_{suffix}"
        assert refreshed.first_name == "Concurrent First"
        assert refreshed.family_name == "Concurrent Family"
    finally:
        db.close()


def test_row_lock_refreshes_stale_user_and_same_field_last_commit_wins(isolated_pg):
    user = _create_user(isolated_pg.factory, f"locked_{uuid4().hex}")
    lock_query_started = Event()
    lock_query_returned = Event()
    first = isolated_pg.factory()
    first.execute(text("SET LOCAL lock_timeout = '5s'"))
    locked = first.query(User).filter(User.id == user.id).with_for_update().one()
    locked.first_name = "First Commit"
    locked.family_name = "Preserved Concurrent Family"
    first.flush()

    def before_cursor(_conn, _cursor, statement, *_):
        if "FOR UPDATE" in statement.upper():
            lock_query_started.set()

    def after_cursor(_conn, _cursor, statement, *_):
        if "FOR UPDATE" in statement.upper():
            lock_query_returned.set()

    def contender():
        with isolated_pg.factory() as db:
            db.execute(text("SET LOCAL lock_timeout = '5s'"))
            db.execute(text("SET LOCAL statement_timeout = '10s'"))
            stale = db.get(User, user.id)
            assert stale.first_name == "First"
            assert stale.family_name == "Family"
            changed = update_user_profile(db, user.id, UserProfileUpdate(first_name="Last Commit"))
            return changed.first_name, changed.family_name

    event.listen(isolated_pg.engine, "before_cursor_execute", before_cursor)
    event.listen(isolated_pg.engine, "after_cursor_execute", after_cursor)
    pool = ThreadPoolExecutor(max_workers=1)
    try:
        future = pool.submit(contender)
        assert lock_query_started.wait(timeout=3), "Service never issued SELECT FOR UPDATE"
        assert not lock_query_returned.wait(timeout=0.1), "Contender bypassed the held row lock"
        first.commit()
        assert future.result(timeout=10) == ("Last Commit", "Preserved Concurrent Family")
        assert lock_query_returned.is_set()
    finally:
        first.rollback()
        first.close()
        pool.shutdown(wait=True)
        event.remove(isolated_pg.engine, "before_cursor_execute", before_cursor)
        event.remove(isolated_pg.engine, "after_cursor_execute", after_cursor)

    with isolated_pg.factory() as db:
        refreshed = db.get(User, user.id)
        assert refreshed.first_name == "Last Commit"
        assert refreshed.family_name == "Preserved Concurrent Family"
