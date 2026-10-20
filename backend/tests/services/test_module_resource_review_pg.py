"""Lease-guarded PostgreSQL tests for the shared resource review decision."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier, Event
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import event, inspect, text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from acceptance.isolation import disposable_database
from app.models.community import Community
from app.models.document import Document, DocumentSource, DocumentStatus, DocumentType, ResourceKind
from app.models.document_vote import DocumentVote, VoteValue
from app.models.management_event import ManagementEvent
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.module import Module
from app.models.user import User
from app.core.sessions import create_session
from app.models.session import Session as BrowserSession
from app.services.document_vote import check_full_document_access
from app.services.module_resource import approve_pending_resource, cast_resource_vote, remove_resource


def _seed(factory, *, kind=ResourceKind.LINK, threshold=1):
    with factory() as db:
        community = Community(id=uuid4(), name="Review", slug="review", document_vote_threshold=threshold)
        uploader = User(id=uuid4(), username="review_uploader", email="uploader@example.invalid",
                        password_hash="opaque", first_name="U", family_name="Owner")
        voter = User(id=uuid4(), username="review_voter", email="voter@example.invalid",
                     password_hash="opaque", first_name="V", family_name="Member")
        staff = User(id=uuid4(), username="review_staff", email="staff@example.invalid",
                     password_hash="opaque", first_name="S", family_name="Moderator")
        other_staff = User(id=uuid4(), username="review_other_staff", email="other@example.invalid",
                           password_hash="opaque", first_name="O", family_name="Moderator")
        db.add_all([community, uploader, voter, staff, other_staff])
        db.flush()
        module = Module(id=uuid4(), community_id=community.id, name="Module", slug="module")
        db.add(module)
        db.add_all([
            Membership(user_id=uploader.id, community_id=community.id, status=MembershipStatus.ACTIVE,
                       role=MembershipRole.MEMBER),
            Membership(user_id=voter.id, community_id=community.id, status=MembershipStatus.ACTIVE,
                       role=MembershipRole.MEMBER),
            Membership(user_id=staff.id, community_id=community.id, status=MembershipStatus.ACTIVE,
                       role=MembershipRole.MODERATOR),
            Membership(user_id=other_staff.id, community_id=community.id, status=MembershipStatus.ACTIVE,
                       role=MembershipRole.MODERATOR),
        ])
        payload = ({"type": DocumentType.COURSE, "storage_path": f"{module.id}/{uuid4()}.pdf"}
                   if kind == ResourceKind.PDF else {"type": None, "external_url": "https://example.com/notes"})
        resource = Document(id=uuid4(), module_id=module.id, uploader_id=uploader.id,
                            title="Resource", resource_kind=kind, source=DocumentSource.STUDENT,
                            status=DocumentStatus.PENDING, vote_threshold_snapshot=threshold, **payload)
        db.add(resource)
        db.commit()
        return dict(resource=resource.id, community=community.id, module=module.id,
                    uploader=uploader.id, voter=voter.id, staff=staff.id, other_staff=other_staff.id)


def _events(db, resource_id):
    return db.query(ManagementEvent).filter(
        ManagementEvent.action == "approve", ManagementEvent.target_type == "module_resource",
        ManagementEvent.target_id == resource_id,
    ).all()


def test_vote_and_staff_approval_serialize_on_one_document_row():
    with disposable_database() as owned:
        assert owned.server_identity["database"] == "irm_integration_test"
        assert owned.server_identity["role"] == "irm_test"
        ids = _seed(owned.factory)
        barrier = Barrier(2)

        def run_vote():
            with owned.factory() as db:
                barrier.wait(timeout=5)
                try:
                    cast_resource_vote(db, "review", ids["resource"], ids["voter"], VoteValue.YES)
                    return "vote"
                except HTTPException as error:
                    return error.status_code

        def run_approval():
            with owned.factory() as db:
                barrier.wait(timeout=5)
                try:
                    approve_pending_resource(db, "review", ids["resource"], ids["staff"])
                    return "approve"
                except HTTPException as error:
                    return error.status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = [pool.submit(run_vote), pool.submit(run_approval)]
            results = [future.result(timeout=20) for future in outcomes]
        assert sorted(map(str, results)) in (["409", "approve"], ["409", "vote"])
        with owned.factory() as db:
            row = db.get(Document, ids["resource"])
            votes = db.query(DocumentVote).filter_by(document_id=row.id).all()
            events = _events(db, row.id)
            assert row.status == DocumentStatus.APPROVED
            assert row.vote_threshold_snapshot == 1
            assert (len(votes), len(events)) in ((1, 0), (0, 1))


def test_two_staff_approvals_create_one_event_and_preserve_snapshot():
    with disposable_database() as owned:
        ids = _seed(owned.factory, threshold=3)
        barrier = Barrier(2)

        def approve(actor):
            with owned.factory() as db:
                barrier.wait(timeout=5)
                try:
                    approve_pending_resource(db, "review", ids["resource"], actor)
                    return 200
                except HTTPException as error:
                    return error.status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(approve, actor) for actor in (ids["staff"], ids["other_staff"])]
            assert sorted(f.result(timeout=20) for f in futures) == [200, 409]
        with owned.factory() as db:
            row = db.get(Document, ids["resource"])
            assert row.status == DocumentStatus.APPROVED and row.vote_threshold_snapshot == 3
            assert len(_events(db, row.id)) == 1
            assert db.query(DocumentVote).filter_by(document_id=row.id).count() == 0


def test_authority_loss_before_locked_review_is_fail_closed():
    with disposable_database() as owned:
        ids = _seed(owned.factory)
        started = Event()
        with owned.factory() as manager:
            manager.query(User.id).filter(User.id == ids["staff"]).with_for_update().first()
            membership = manager.query(Membership).filter_by(
                user_id=ids["staff"], community_id=ids["community"],
            ).with_for_update().one()

            def attempt():
                with owned.factory() as db:
                    started.set()
                    with pytest.raises(HTTPException) as error:
                        approve_pending_resource(db, "review", ids["resource"], ids["staff"])
                    return error.value.status_code

            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(attempt)
                assert started.wait(timeout=5)
                membership.status = MembershipStatus.REMOVED
                manager.commit()
                assert future.result(timeout=20) == 403
        with owned.factory() as db:
            assert db.get(Document, ids["resource"]).status == DocumentStatus.PENDING
            assert not _events(db, ids["resource"])


def test_audit_insert_failure_rolls_back_approval_and_legacy_votes():
    with disposable_database() as owned:
        ids = _seed(owned.factory, kind=ResourceKind.PDF, threshold=3)
        with owned.factory() as db:
            vote = DocumentVote(document_id=ids["resource"], voter_id=ids["voter"], vote=VoteValue.YES)
            db.add(vote)
            db.commit()
            vote_id = vote.id

        def fail_audit(session, *_args):
            if any(isinstance(obj, ManagementEvent) and obj.action == "approve" for obj in session.new):
                raise RuntimeError("injected audit failure")

        event.listen(Session, "before_flush", fail_audit)
        try:
            with owned.factory() as db:
                with pytest.raises(RuntimeError, match="injected audit failure"):
                    approve_pending_resource(db, "review", ids["resource"], ids["staff"])
        finally:
            event.remove(Session, "before_flush", fail_audit)

        with owned.factory() as db:
            row = db.get(Document, ids["resource"])
            voter = db.get(User, ids["voter"])
            assert row.status == DocumentStatus.PENDING and row.vote_threshold_snapshot == 3
            assert db.get(DocumentVote, vote_id).vote == VoteValue.YES
            assert check_full_document_access(db, row, voter)
            assert not _events(db, row.id)


def test_migrated_description_constraint_matches_metadata_semantics():
    with disposable_database() as owned:
        ids = _seed(owned.factory)
        checks = {item["name"]: item["sqltext"] for item in inspect(owned.engine).get_check_constraints("documents")}
        assert "ck_document_description_length" in checks
        insert = text("""
            INSERT INTO documents (id, module_id, uploader_id, title, description,
                resource_kind, source, status, external_url, created_at, updated_at)
            VALUES (:id, :module, :uploader, 'Description test', :description,
                'LINK', 'OFFICIAL', 'APPROVED', 'https://example.com', now(), now())
            RETURNING description
        """)

        def insert_description(connection, description):
            return connection.execute(insert, dict(
                id=uuid4(), module=ids["module"], uploader=ids["uploader"],
                description=description,
            )).scalar_one()

        for valid in (None, "Normal text", "x" * 2000):
            with owned.engine.begin() as connection:
                assert insert_description(connection, valid) == valid

        for invalid in ("", " ", " leading", "trailing "):
            with pytest.raises(IntegrityError) as error:
                with owned.engine.begin() as connection:
                    insert_description(connection, invalid)
            assert error.value.orig.sqlstate == "23514"
            assert error.value.orig.diag.constraint_name == "ck_document_description_length"

        with pytest.raises(DataError) as error:
            with owned.engine.begin() as connection:
                insert_description(connection, "x" * 2001)
        assert error.value.orig.sqlstate == "22001"


@pytest.mark.parametrize("first", ["approval", "removal"])
def test_approval_and_removal_serialize_on_document_row(first):
    with disposable_database() as owned:
        assert owned.server_identity["database"] == "irm_integration_test"
        assert owned.server_identity["role"] == "irm_test"
        ids = _seed(owned.factory, threshold=3)
        held = Event()
        release = Event()
        attempting_lock = Event()

        def pause_winner(session, *_args):
            if session.info.get("d3_winner") and not held.is_set():
                held.set()
                assert release.wait(timeout=10)

        def mark_loser_lock(state):
            if state.session.info.get("d3_loser") and state.is_select:
                sql = str(state.statement).upper()
                if "DOCUMENTS" in sql and "FOR UPDATE" in sql:
                    attempting_lock.set()

        event.listen(Session, "before_flush", pause_winner)
        event.listen(Session, "do_orm_execute", mark_loser_lock)
        try:
            def winner():
                with owned.factory() as db:
                    db.info["d3_winner"] = True
                    if first == "approval":
                        approve_pending_resource(db, "review", ids["resource"], ids["staff"])
                    else:
                        remove_resource(db, "review", ids["resource"], ids["uploader"])

            def loser():
                with owned.factory() as db:
                    db.info["d3_loser"] = True
                    try:
                        if first == "approval":
                            remove_resource(db, "review", ids["resource"], ids["uploader"])
                        else:
                            cast_resource_vote(db, "review", ids["resource"], ids["voter"], VoteValue.YES)
                    except HTTPException as error:
                        return error.status_code
                    return 200

            with ThreadPoolExecutor(max_workers=2) as pool:
                winning = pool.submit(winner)
                assert held.wait(timeout=10)
                losing = pool.submit(loser)
                assert attempting_lock.wait(timeout=10)
                assert not losing.done()
                release.set()
                winning.result(timeout=20)
                assert losing.result(timeout=20) == (409 if first == "approval" else 404)
        finally:
            release.set()
            event.remove(Session, "before_flush", pause_winner)
            event.remove(Session, "do_orm_execute", mark_loser_lock)

        with owned.factory() as db:
            row = db.get(Document, ids["resource"])
            assert (row.status, row.removed_at is not None) == (
                (DocumentStatus.APPROVED, False) if first == "approval"
                else (DocumentStatus.PENDING, True))
            assert db.query(DocumentVote).filter_by(document_id=row.id).count() == 0
            assert db.query(ManagementEvent).filter_by(
                target_id=row.id, action="remove").count() == (0 if first == "approval" else 1)


def test_removal_authority_revocation_under_user_membership_locks():
    with disposable_database() as owned:
        ids = _seed(owned.factory)
        started = Event()
        with owned.factory() as manager:
            manager.query(User.id).filter(User.id == ids["uploader"]).with_for_update().first()
            membership = manager.query(Membership).filter_by(
                user_id=ids["uploader"], community_id=ids["community"],
            ).with_for_update().one()

            def attempt():
                with owned.factory() as db:
                    started.set()
                    with pytest.raises(HTTPException) as error:
                        remove_resource(db, "review", ids["resource"], ids["uploader"])
                    return error.value.status_code

            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(attempt)
                assert started.wait(timeout=5)
                membership.status = MembershipStatus.REMOVED
                manager.commit()
                assert future.result(timeout=20) == 403
        with owned.factory() as db:
            assert db.get(Document, ids["resource"]).removed_at is None


def test_removal_rechecks_session_after_user_lock():
    with disposable_database() as owned:
        ids = _seed(owned.factory)
        with owned.factory() as db:
            token, browser_session = create_session(db, ids["uploader"], timedelta(days=1))
            session_id = browser_session.id
        started = Event()
        with owned.factory() as manager:
            manager.query(User.id).filter(User.id == ids["uploader"]).with_for_update().first()
            session = manager.query(BrowserSession).filter_by(id=session_id).with_for_update().one()

            def attempt():
                with owned.factory() as db:
                    started.set()
                    with pytest.raises(HTTPException) as error:
                        remove_resource(db, "review", ids["resource"], ids["uploader"], token)
                    return error.value.status_code

            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(attempt)
                assert started.wait(timeout=5)
                session.is_revoked = True
                manager.commit()
                assert future.result(timeout=20) == 401
        with owned.factory() as db:
            assert db.get(Document, ids["resource"]).removed_at is None
