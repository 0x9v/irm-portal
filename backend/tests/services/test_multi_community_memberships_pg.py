"""Community scoped membership index and concurrency checks on guarded PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from acceptance.isolation import disposable_database, migrate
from app.models.community import Community
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.user import User
from app.services.membership import approve_membership, create_membership_request


PREVIOUS_HEAD = "d9a1f3c7b205"
NEW_HEAD = "e4b6c8d0f219"


def make_user(key: str) -> User:
    suffix = f"{key}_{uuid4().hex[:10]}"
    return User(username=suffix, email=f"{suffix}@example.invalid", password_hash="synthetic",
                first_name="Test", family_name="Applicant")


def test_membership_index_migration_preserves_rows_and_refuses_unsafe_downgrade():
    with disposable_database(upgrade=False) as resource:
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD)
        with Session(resource.engine) as db:
            user = make_user("index")
            delegate_user = make_user("delegate")
            communities = [Community(name=f"Community {i}", slug=f"index-{i}") for i in range(2)]
            db.add_all([user, delegate_user, *communities])
            db.flush()
            community_ids = [community.id for community in communities]
            rows = [Membership(user_id=user.id, community_id=community.id, cne=f"CNE{i}",
                               status=MembershipStatus.PENDING if i == 0 else MembershipStatus.ACTIVE,
                               role=MembershipRole.MODERATOR if i == 1 else MembershipRole.MEMBER)
                    for i, community in enumerate(communities)]
            delegate = Membership(user_id=delegate_user.id, community_id=communities[0].id, cne="DELEGATE",
                                  status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE)
            db.add_all([*rows, delegate])
            db.commit()
            original = [(row.id, row.user_id, row.community_id, row.status, row.role,
                         row.cne, row.created_at, row.updated_at) for row in [*rows, delegate]]

        migrate(resource.engine, resource.lease, NEW_HEAD)
        indexes = {index["name"] for index in inspect(resource.engine).get_indexes("memberships")}
        unique_constraints = {item["name"] for item in inspect(resource.engine).get_unique_constraints("memberships")}
        assert "uq_memberships_global_active_pending" not in indexes
        assert "uq_memberships_community_active_delegate" in indexes
        assert "uq_memberships_user_community" in unique_constraints
        with Session(resource.engine) as db:
            after = [(row.id, row.user_id, row.community_id, row.status, row.role,
                      row.cne, row.created_at, row.updated_at)
                     for row in db.query(Membership).order_by(Membership.id).all()]
            assert after == sorted(original, key=lambda item: item[0])
            duplicate_delegate_user = make_user("duplicate_delegate")
            db.add(duplicate_delegate_user)
            db.flush()
            db.add(Membership(user_id=duplicate_delegate_user.id, community_id=community_ids[0],
                              cne="SECOND_DELEGATE", status=MembershipStatus.ACTIVE,
                              role=MembershipRole.DELEGATE))
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()

        with pytest.raises(RuntimeError, match="Cannot restore global PENDING/ACTIVE membership exclusivity"):
            migrate(resource.engine, resource.lease, PREVIOUS_HEAD, downgrade=True)
        assert "uq_memberships_global_active_pending" not in {
            index["name"] for index in inspect(resource.engine).get_indexes("memberships")
        }
        with resource.engine.connect() as connection:
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == NEW_HEAD


@pytest.fixture
def membership_db():
    with disposable_database() as resource:
        yield resource.factory


def test_concurrent_applications_in_different_communities_coexist(membership_db):
    with membership_db() as db:
        user = make_user("different")
        communities = [Community(name=f"Community {i}", slug=f"different-{i}") for i in range(2)]
        db.add_all([user, *communities])
        db.commit()
        user_id = user.id
        slugs = [community.slug for community in communities]

    barrier = Barrier(2)

    def apply(slug):
        with membership_db() as db:
            user = db.get(User, user_id)
            barrier.wait(timeout=10)
            return create_membership_request(db, user, slug, f"{slug}-CNE").id

    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(apply, slugs))
    assert len(set(ids)) == 2
    with membership_db() as db:
        assert db.query(Membership).filter_by(user_id=user_id).count() == 2


def test_concurrent_same_community_applications_create_one_row(membership_db):
    with membership_db() as db:
        user = make_user("same")
        community = Community(name="Same Community", slug="same-community")
        db.add_all([user, community])
        db.commit()
        user_id, slug = user.id, community.slug

    barrier = Barrier(2)

    def apply(_):
        with membership_db() as db:
            user = db.get(User, user_id)
            barrier.wait(timeout=10)
            try:
                return create_membership_request(db, user, slug, "SAME-CNE").id
            except HTTPException as exc:
                return exc.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(apply, range(2)))
    assert sum(isinstance(result, int) and result != 409 for result in results) == 1
    assert results.count(409) == 1
    with membership_db() as db:
        assert db.query(Membership).filter_by(user_id=user_id).count() == 1


def test_concurrent_approvals_change_one_target_row_once(membership_db):
    with membership_db() as db:
        user = make_user("approve")
        community = Community(name="Approval Community", slug="approval-community")
        db.add_all([user, community])
        db.flush()
        pending = Membership(user_id=user.id, community_id=community.id, cne="APPROVE-CNE",
                             status=MembershipStatus.PENDING, role=MembershipRole.MEMBER)
        db.add(pending)
        db.commit()
        membership_id, slug = pending.id, community.slug

    barrier = Barrier(2)

    def approve(_):
        with membership_db() as db:
            barrier.wait(timeout=10)
            try:
                return approve_membership(db, slug, str(membership_id)).status
            except HTTPException as exc:
                return exc.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(approve, range(2)))
    assert results.count(MembershipStatus.ACTIVE) == 1
    assert results.count(409) == 1
    with membership_db() as db:
        assert db.query(Membership).filter_by(id=membership_id).one().status is MembershipStatus.ACTIVE
