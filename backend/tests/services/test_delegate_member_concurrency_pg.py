"""Real PostgreSQL concurrency and atomicity tests for Task 0.1.8 in disposable schema."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Barrier
import uuid
import pytest
from sqlalchemy import create_engine, text, event
from sqlalchemy.orm import sessionmaker, Session
from fastapi import HTTPException

from app.database import Base
from app.models.community import Community
from app.models.management_event import ManagementEvent
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.membership_permission import MembershipPermission, PermissionType
from app.models.user import User
from app.services.membership import (
    remove_community_membership,
    ban_community_membership,
    unban_community_membership,
    create_membership_request,
    approve_membership,
    transition_membership_role,
)

from acceptance.isolation import disposable_database


@pytest.fixture
def disposable_schema_engine():
    with disposable_database() as resource:
        yield resource.engine, resource.factory, resource.lease.schema


def test_forced_pre_commit_failure_rolls_back_everything(disposable_schema_engine):
    _, factory, _ = disposable_schema_engine

    now = datetime.now(timezone.utc)
    with factory() as db:
        c = Community(id=uuid.uuid4(), name="IRM", slug="irm", document_vote_threshold=10)
        u_del = User(id=uuid.uuid4(), username="del", email="del@e.c", password_hash="h", first_name="D", family_name="U")
        u_tgt = User(id=uuid.uuid4(), username="tgt", email="tgt@e.c", password_hash="h", first_name="T", family_name="U")
        db.add_all([c, u_del, u_tgt])
        db.flush()

        m_del = Membership(id=uuid.uuid4(), user_id=u_del.id, community_id=c.id, cne="C1", role=MembershipRole.DELEGATE, status=MembershipStatus.ACTIVE, created_at=now, updated_at=now)
        m_tgt = Membership(id=uuid.uuid4(), user_id=u_tgt.id, community_id=c.id, cne="C2", role=MembershipRole.MODERATOR, status=MembershipStatus.ACTIVE, created_at=now, updated_at=now)
        db.add_all([m_del, m_tgt])
        db.flush()

        perm = MembershipPermission(id=uuid.uuid4(), membership_id=m_tgt.id, permission=PermissionType.CREATE_ANNOUNCEMENTS)
        db.add(perm)
        db.commit()

        del_id = u_del.id
        tgt_mid = str(m_tgt.id)
        comm_slug = c.slug

    # Intercept before_flush to force error when ManagementEvent is flushed
    def fail_event(session, *_):
        if any(isinstance(obj, ManagementEvent) for obj in session.new):
            raise RuntimeError("FORCED_AUDIT_ERROR")

    event.listen(Session, "before_flush", fail_event)

    try:
        with factory() as db:
            del_user = db.get(User, del_id)
            with pytest.raises(RuntimeError, match="FORCED_AUDIT_ERROR"):
                remove_community_membership(db, comm_slug, tgt_mid, del_user)
    finally:
        event.remove(Session, "before_flush", fail_event)

    # Verify atomic rollback
    with factory() as db:
        m = db.get(Membership, uuid.UUID(tgt_mid))
        assert m.status == MembershipStatus.ACTIVE
        assert m.role == MembershipRole.MODERATOR
        perms = db.query(MembershipPermission).filter(MembershipPermission.membership_id == uuid.UUID(tgt_mid)).all()
        assert len(perms) == 1
        events = db.query(ManagementEvent).filter(ManagementEvent.target_id == uuid.UUID(tgt_mid)).all()
        assert len(events) == 0


def test_concurrent_identical_removals_produce_one_event(disposable_schema_engine):
    _, factory, _ = disposable_schema_engine

    now = datetime.now(timezone.utc)
    with factory() as db:
        c = Community(id=uuid.uuid4(), name="IRM", slug="irm", document_vote_threshold=10)
        u_del = User(id=uuid.uuid4(), username="del", email="del@e.c", password_hash="h", first_name="D", family_name="U")
        u_tgt = User(id=uuid.uuid4(), username="tgt", email="tgt@e.c", password_hash="h", first_name="T", family_name="U")
        db.add_all([c, u_del, u_tgt])
        db.flush()

        m_del = Membership(id=uuid.uuid4(), user_id=u_del.id, community_id=c.id, cne="C1", role=MembershipRole.DELEGATE, status=MembershipStatus.ACTIVE, created_at=now, updated_at=now)
        m_tgt = Membership(id=uuid.uuid4(), user_id=u_tgt.id, community_id=c.id, cne="C2", role=MembershipRole.MEMBER, status=MembershipStatus.ACTIVE, created_at=now, updated_at=now)
        db.add_all([m_del, m_tgt])
        db.commit()

        del_id = u_del.id
        tgt_mid = str(m_tgt.id)
        comm_slug = c.slug

    barrier = Barrier(4)

    def worker(_):
        with factory() as db:
            del_user = db.get(User, del_id)
            barrier.wait(timeout=5)
            remove_community_membership(db, comm_slug, tgt_mid, del_user)
            return True

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(worker, range(4)))

    assert all(results)
    with factory() as db:
        m = db.get(Membership, uuid.UUID(tgt_mid))
        assert m.status == MembershipStatus.REMOVED
        events = db.query(ManagementEvent).filter(ManagementEvent.target_id == uuid.UUID(tgt_mid)).all()
        assert len(events) == 1


def test_competing_ban_and_reapplication_race(disposable_schema_engine):
    _, factory, _ = disposable_schema_engine

    now = datetime.now(timezone.utc)
    with factory() as db:
        c = Community(id=uuid.uuid4(), name="IRM", slug="irm", document_vote_threshold=10)
        u_del = User(id=uuid.uuid4(), username="del", email="del@e.c", password_hash="h", first_name="D", family_name="U")
        u_tgt = User(id=uuid.uuid4(), username="tgt", email="tgt@e.c", password_hash="h", first_name="T", family_name="U")
        db.add_all([c, u_del, u_tgt])
        db.flush()

        m_del = Membership(id=uuid.uuid4(), user_id=u_del.id, community_id=c.id, cne="C1", role=MembershipRole.DELEGATE, status=MembershipStatus.ACTIVE, created_at=now, updated_at=now)
        m_tgt = Membership(id=uuid.uuid4(), user_id=u_tgt.id, community_id=c.id, cne="C2", role=MembershipRole.MEMBER, status=MembershipStatus.REMOVED, created_at=now, updated_at=now)
        db.add_all([m_del, m_tgt])
        db.commit()

        del_id = u_del.id
        tgt_id = u_tgt.id
        tgt_mid = str(m_tgt.id)
        comm_slug = c.slug

    barrier = Barrier(2)

    def do_ban():
        with factory() as db:
            del_user = db.get(User, del_id)
            barrier.wait(timeout=5)
            ban_community_membership(db, comm_slug, tgt_mid, del_user)
            return "banned"

    def do_reapply():
        with factory() as db:
            tgt_user = db.get(User, tgt_id)
            barrier.wait(timeout=5)
            try:
                create_membership_request(db, tgt_user, comm_slug, "CNE_NEW")
                return "reapplied"
            except HTTPException as e:
                return f"rejected_{e.status_code}"

    with ThreadPoolExecutor(max_workers=2) as pool:
        f_ban = pool.submit(do_ban)
        f_reapply = pool.submit(do_reapply)
        res_ban = f_ban.result()
        res_reapply = f_reapply.result()

    assert res_ban == "banned"
    # Result must either be banned first (reapply gets 403), or reapply first (then ban transitions to BANNED).
    with factory() as db:
        m = db.get(Membership, uuid.UUID(tgt_mid))
        assert m.status == MembershipStatus.BANNED


def test_competing_ban_and_approval_race(disposable_schema_engine):
    _, factory, _ = disposable_schema_engine

    now = datetime.now(timezone.utc)
    with factory() as db:
        c = Community(id=uuid.uuid4(), name="IRM", slug="irm", document_vote_threshold=10)
        u_del = User(id=uuid.uuid4(), username="del", email="del@e.c", password_hash="h", first_name="D", family_name="U")
        u_tgt = User(id=uuid.uuid4(), username="tgt", email="tgt@e.c", password_hash="h", first_name="T", family_name="U")
        db.add_all([c, u_del, u_tgt])
        db.flush()

        m_del = Membership(id=uuid.uuid4(), user_id=u_del.id, community_id=c.id, cne="C1", role=MembershipRole.DELEGATE, status=MembershipStatus.ACTIVE, created_at=now, updated_at=now)
        m_tgt = Membership(id=uuid.uuid4(), user_id=u_tgt.id, community_id=c.id, cne="C2", role=MembershipRole.MEMBER, status=MembershipStatus.PENDING, created_at=now, updated_at=now)
        db.add_all([m_del, m_tgt])
        db.commit()

        del_id = u_del.id
        tgt_mid = str(m_tgt.id)
        comm_slug = c.slug

    barrier = Barrier(2)

    def do_ban():
        with factory() as db:
            del_user = db.get(User, del_id)
            barrier.wait(timeout=5)
            ban_community_membership(db, comm_slug, tgt_mid, del_user)
            return "banned"

    def do_approve():
        with factory() as db:
            barrier.wait(timeout=5)
            try:
                approve_membership(db, comm_slug, tgt_mid)
                return "approved"
            except HTTPException as e:
                return f"conflict_{e.status_code}"

    with ThreadPoolExecutor(max_workers=2) as pool:
        f_ban = pool.submit(do_ban)
        f_app = pool.submit(do_approve)
        r_ban = f_ban.result()
        r_app = f_app.result()

    assert r_ban == "banned"
    # In both ordering outcomes, final status is BANNED!
    with factory() as db:
        m = db.get(Membership, uuid.UUID(tgt_mid))
        assert m.status == MembershipStatus.BANNED


def test_actor_authorization_revoked_during_transaction(disposable_schema_engine):
    _, factory, _ = disposable_schema_engine

    now = datetime.now(timezone.utc)
    with factory() as db:
        c = Community(id=uuid.uuid4(), name="IRM", slug="irm", document_vote_threshold=10)
        u_del = User(id=uuid.uuid4(), username="del", email="del@e.c", password_hash="h", first_name="D", family_name="U")
        u_tgt = User(id=uuid.uuid4(), username="tgt", email="tgt@e.c", password_hash="h", first_name="T", family_name="U")
        db.add_all([c, u_del, u_tgt])
        db.flush()

        m_del = Membership(id=uuid.uuid4(), user_id=u_del.id, community_id=c.id, cne="C1", role=MembershipRole.DELEGATE, status=MembershipStatus.ACTIVE, created_at=now, updated_at=now)
        m_tgt = Membership(id=uuid.uuid4(), user_id=u_tgt.id, community_id=c.id, cne="C2", role=MembershipRole.MEMBER, status=MembershipStatus.ACTIVE, created_at=now, updated_at=now)
        db.add_all([m_del, m_tgt])
        db.commit()

        del_id = u_del.id
        del_mid = str(m_del.id)
        tgt_mid = str(m_tgt.id)
        comm_slug = c.slug

    # Demote the delegate in a separate transaction
    with factory() as db:
        m = db.get(Membership, uuid.UUID(del_mid))
        m.role = MembershipRole.MEMBER
        db.commit()

    # Actor attempts mutation -> must fail with 403 Forbidden
    with factory() as db:
        del_user = db.get(User, del_id)
        with pytest.raises(HTTPException) as exc_info:
            remove_community_membership(db, comm_slug, tgt_mid, del_user)
        assert exc_info.value.status_code == 403


def test_legitimate_later_action_cycles_create_additional_events(disposable_schema_engine):
    _, factory, _ = disposable_schema_engine

    now = datetime.now(timezone.utc)
    with factory() as db:
        c = Community(id=uuid.uuid4(), name="IRM", slug="irm", document_vote_threshold=10)
        u_del = User(id=uuid.uuid4(), username="del", email="del@e.c", password_hash="h", first_name="D", family_name="U")
        u_tgt = User(id=uuid.uuid4(), username="tgt", email="tgt@e.c", password_hash="h", first_name="T", family_name="U")
        db.add_all([c, u_del, u_tgt])
        db.flush()

        m_del = Membership(id=uuid.uuid4(), user_id=u_del.id, community_id=c.id, cne="C1", role=MembershipRole.DELEGATE, status=MembershipStatus.ACTIVE, created_at=now, updated_at=now)
        m_tgt = Membership(id=uuid.uuid4(), user_id=u_tgt.id, community_id=c.id, cne="C2", role=MembershipRole.MEMBER, status=MembershipStatus.ACTIVE, created_at=now, updated_at=now)
        db.add_all([m_del, m_tgt])
        db.commit()

        del_id = u_del.id
        tgt_id = u_tgt.id
        tgt_mid = str(m_tgt.id)
        comm_slug = c.slug

    # Cycle 1: Remove
    with factory() as db:
        del_user = db.get(User, del_id)
        remove_community_membership(db, comm_slug, tgt_mid, del_user)

    # Reapply -> Approve
    with factory() as db:
        tgt_user = db.get(User, tgt_id)
        create_membership_request(db, tgt_user, comm_slug, "CNE_CYCLE1")
        approve_membership(db, comm_slug, tgt_mid)

    # Cycle 2: Remove again
    with factory() as db:
        del_user = db.get(User, del_id)
        remove_community_membership(db, comm_slug, tgt_mid, del_user)

    # Verify that BOTH remove events exist for this target
    with factory() as db:
        events = db.query(ManagementEvent).filter(
            ManagementEvent.target_id == uuid.UUID(tgt_mid),
            ManagementEvent.action == "remove",
        ).all()
        assert len(events) == 2

    # Cycle 3: Ban -> Unban -> Reapply -> Approve -> Ban again
    with factory() as db:
        del_user = db.get(User, del_id)
        ban_community_membership(db, comm_slug, tgt_mid, del_user)
        unban_community_membership(db, comm_slug, tgt_mid, del_user)

    with factory() as db:
        tgt_user = db.get(User, tgt_id)
        create_membership_request(db, tgt_user, comm_slug, "CNE_CYCLE2")
        approve_membership(db, comm_slug, tgt_mid)

    with factory() as db:
        del_user = db.get(User, del_id)
        ban_community_membership(db, comm_slug, tgt_mid, del_user)

    with factory() as db:
        ban_events = db.query(ManagementEvent).filter(
            ManagementEvent.target_id == uuid.UUID(tgt_mid),
            ManagementEvent.action == "ban",
        ).all()
        assert len(ban_events) == 2
        unban_events = db.query(ManagementEvent).filter(
            ManagementEvent.target_id == uuid.UUID(tgt_mid),
            ManagementEvent.action == "unban",
        ).all()
        assert len(unban_events) == 1
