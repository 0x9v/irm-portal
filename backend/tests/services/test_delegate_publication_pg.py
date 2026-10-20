"""Disposable-schema authority race for new Delegate resources."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event, current_thread
from uuid import uuid4

from sqlalchemy import event

from acceptance.isolation import disposable_database
from app.core.sessions import create_session
from app.models.community import Community
from app.models.document import Document, DocumentSource, DocumentStatus, DocumentType, ResourceKind
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.module import Module
from app.models.user import User
from app.services.module_resource import create_url_resource


def test_delegate_demotion_commits_before_creation_authority_check():
    with disposable_database() as owned:
        assert owned.server_identity["database"] == "irm_integration_test"
        assert owned.server_identity["role"] == "irm_test"
        with owned.factory() as db:
            community = Community(id=uuid4(), name="Publish", slug="publish")
            uploader = User(id=uuid4(), username="publish_delegate", email="delegate@example.invalid",
                            password_hash="opaque", first_name="D", family_name="User")
            db.add_all([community, uploader])
            db.flush()
            module = Module(id=uuid4(), community_id=community.id, name="Module", slug="module")
            membership = Membership(id=uuid4(), user_id=uploader.id, community_id=community.id,
                                    role=MembershipRole.DELEGATE, status=MembershipStatus.ACTIVE)
            db.add_all([module, membership])
            db.commit()
            token, _ = create_session(db, uploader.id, timedelta(days=1))
            ids = (community.id, module.id, uploader.id, membership.id)

        about_to_lock = Event()

        def before_execute(_connection, _cursor, statement, _parameters, _context, _many):
            if (current_thread().name.startswith("delegate-create") and "FROM memberships" in statement
                    and "FOR UPDATE" in statement):
                about_to_lock.set()

        event.listen(owned.engine, "before_cursor_execute", before_execute)
        try:
            with owned.factory() as authority_db:
                membership = authority_db.query(Membership).filter_by(id=ids[3]).with_for_update().one()

                def create():
                    with owned.factory() as db:
                        stale_membership = db.get(Membership, ids[3])
                        target_module = db.get(Module, ids[1])
                        row = create_url_resource(
                            db, target_module, ids[2], stale_membership,
                            kind=ResourceKind.LINK, title="New student notes", description=None,
                            url="https://example.org/notes", requested_source=DocumentSource.STUDENT,
                            category=DocumentType.TD, raw_token=token,
                        )
                        return row.id

                with ThreadPoolExecutor(max_workers=1, thread_name_prefix="delegate-create") as pool:
                    future = pool.submit(create)
                    reached_authority_check = about_to_lock.wait(timeout=10)
                    membership.role = MembershipRole.MEMBER
                    authority_db.commit()
                    assert reached_authority_check
                    resource_id = future.result(timeout=20)
        finally:
            event.remove(owned.engine, "before_cursor_execute", before_execute)

        with owned.factory() as db:
            row = db.get(Document, resource_id)
            assert row.module_id == ids[1]
            assert row.source == DocumentSource.STUDENT
            assert row.status == DocumentStatus.PENDING
            assert row.type == DocumentType.TD
            assert row.vote_threshold_snapshot is not None
