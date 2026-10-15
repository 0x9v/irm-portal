"""Programme foundation migration preservation on guarded disposable schemas."""
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import MetaData, func, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from acceptance.isolation import disposable_database, migrate
from app.models.announcement import Announcement
from app.models.announcement_reply import AnnouncementReply
from app.models.community import Community
from app.models.community_post import CommunityPost
from app.models.community_post_reply import CommunityPostReply
from app.models.discussion_message import DiscussionMessage
from app.models.discussion_reaction import DiscussionReaction
from app.models.document import Document, DocumentSource, DocumentStatus, DocumentType
from app.models.document_reading import DocumentReading
from app.models.document_vote import DocumentVote, VoteValue
from app.models.management_event import ManagementEvent
from app.models.membership import (
    Membership,
    MembershipApplicantType,
    MembershipIdentifierType,
    MembershipRole,
    MembershipStatus,
)
from app.models.membership_permission import MembershipPermission, PermissionType
from app.models.programme import Programme
from app.models.saved_document import SavedDocument
from app.models.user import User


PREVIOUS_HEAD = "c7e4a9d213f6"
NEW_HEAD = "d9a1f3c7b205"


def reflect_table(engine, name):
    """Return a fresh Core table matching the historical schema on engine."""
    metadata = MetaData()
    metadata.reflect(bind=engine, only=[name])
    return metadata.tables[name]


def make_user() -> User:
    suffix = uuid4().hex[:12]
    return User(
        username=f"programme_{suffix}",
        email=f"programme_{suffix}@example.invalid",
        password_hash="synthetic-hash",
        first_name="Existing",
        family_name="Account",
    )


def test_programme_migration_links_only_irm_and_preserves_dependents():
    with disposable_database(upgrade=False) as resource:
        assert resource.server_identity["database"] == "irm_integration_test"
        assert resource.server_identity["role"] == "irm_test"
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD)

        # These fixtures are inserted at c7e4a9d213f6, before programme_id
        # exists on either table. Reflect the actual predecessor schema rather
        # than asking the current ORM mappings to emit columns from later
        # revisions.
        communities = reflect_table(resource.engine, "communities")
        modules = reflect_table(resource.engine, "modules")
        irm_id, other_id, module_id = uuid4(), uuid4(), uuid4()
        now = datetime.now(timezone.utc)
        with Session(resource.engine) as db:
            user = make_user()
            db.add(user)
            db.flush()
            other_slug = f"other-{uuid4().hex[:8]}"
            db.execute(communities.insert(), [
                {"id": irm_id, "name": "FST Mohammedia — IRM", "slug": "irm",
                 "document_vote_threshold": 10, "created_at": now, "updated_at": now},
                {"id": other_id, "name": "Unclassified community", "slug": other_slug,
                 "document_vote_threshold": 10, "created_at": now, "updated_at": now},
            ])

            member = Membership(
                user_id=user.id,
                community_id=irm_id,
                cne="R001234567",
                applicant_type=MembershipApplicantType.STUDENT,
                identifier_type=MembershipIdentifierType.MASSAR,
                applicant_first_name="Applicant",
                applicant_family_name="Preserved",
                promotion="2023/2024",
                status=MembershipStatus.ACTIVE,
                role=MembershipRole.MODERATOR,
            )
            db.execute(modules.insert(), {"id": module_id, "community_id": irm_id,
                                          "name": "Signals", "slug": "signals",
                                          "created_at": now, "updated_at": now})
            announcement = Announcement(community_id=irm_id, author_id=user.id, title="Notice", content="Body")
            post = CommunityPost(community_id=irm_id, author_id=user.id, title="Post", content="Content")
            message = DiscussionMessage(
                community_id=irm_id,
                author_id=user.id,
                kind="TEXT",
                content="Discussion message",
                client_message_id=uuid4(),
            )
            db.add_all([member, announcement, post, message])
            db.flush()

            permission = MembershipPermission(
                membership_id=member.id,
                permission=PermissionType.CREATE_ANNOUNCEMENTS,
            )
            document = Document(
                module_id=module_id,
                uploader_id=user.id,
                title="Preserved file",
                type=DocumentType.COURSE,
                source=DocumentSource.OFFICIAL,
                status=DocumentStatus.APPROVED,
                storage_path="legacy-community/module/document.pdf",
                preview_path="legacy-community/module/document.png",
            )
            announcement_reply = AnnouncementReply(
                announcement_id=announcement.id,
                author_id=user.id,
                content="Announcement reply",
            )
            post_reply = CommunityPostReply(post_id=post.id, author_id=user.id, content="Post reply")
            reaction = DiscussionReaction(message_id=message.id, user_id=user.id, emoji="thanks")
            event = ManagementEvent(
                community_id=irm_id,
                actor_id=user.id,
                action="remove",
                target_type="community_post",
                target_id=post.id,
            )
            db.add_all([permission, document, announcement_reply, post_reply, reaction, event])
            db.flush()
            vote = DocumentVote(document_id=document.id, voter_id=user.id, vote=VoteValue.YES)
            saved = SavedDocument(user_id=user.id, document_id=document.id)
            reading = DocumentReading(user_id=user.id, document_id=document.id, last_page=7)
            db.add_all([vote, saved, reading])
            db.commit()

            ids = {
                "user": user.id,
                "irm": irm_id,
                "other": other_id,
                "membership": member.id,
                "permission": permission.id,
                "module": module_id,
                "document": document.id,
                "vote": vote.id,
                "saved": saved.id,
                "reading": reading.id,
                "announcement": announcement.id,
                "announcement_reply": announcement_reply.id,
                "post": post.id,
                "post_reply": post_reply.id,
                "message": message.id,
                "reaction": reaction.id,
                "event": event.id,
            }

        migrate(resource.engine, resource.lease, NEW_HEAD)
        # Migration has completed and the pre-migration Session is closed.
        # Use a newly reflected table for modules: B2 adds Community linkage,
        # while Module.programme_id is not introduced until B4.
        modules_after_b2 = reflect_table(resource.engine, "modules")
        inspector = inspect(resource.engine)
        assert "programmes" in inspector.get_table_names()
        programme_columns = {item["name"]: item for item in inspector.get_columns("programmes")}
        assert set(programme_columns) == {
            "id", "slug", "name", "institution_slug", "institution_name", "created_at", "updated_at"
        }
        assert all(not programme_columns[name]["nullable"] for name in programme_columns)
        assert programme_columns["slug"]["type"].length == 100
        assert programme_columns["name"]["type"].length == 100
        assert programme_columns["institution_slug"]["type"].length == 100
        assert programme_columns["institution_name"]["type"].length == 150
        assert any(
            item["name"] == "uq_programmes_slug" and item["column_names"] == ["slug"]
            for item in inspector.get_unique_constraints("programmes")
        )
        community_columns = {item["name"]: item for item in inspector.get_columns("communities")}
        assert community_columns["programme_id"]["nullable"] is True
        assert "ix_communities_programme_id" in {item["name"] for item in inspector.get_indexes("communities")}
        programme_fk = next(
            item for item in inspector.get_foreign_keys("communities")
            if item["constrained_columns"] == ["programme_id"]
        )
        assert programme_fk["referred_table"] == "programmes"
        assert programme_fk["options"]["ondelete"] == "RESTRICT"

        with Session(resource.engine) as db:
            programme = db.query(Programme).filter_by(slug="irm").one()
            assert programme.id.hex == "9e85c0d808a84a258ca613fcaf412c20"
            assert programme.name == "IRM"
            assert programme.institution_slug == "fst-mohammedia"
            assert programme.institution_name == "FST Mohammedia"
            assert db.get(Community, ids["irm"]).programme_id == programme.id
            assert db.get(Community, ids["other"]).programme_id is None
            assert [community.id for community in programme.communities] == [ids["irm"]]

            member = db.get(Membership, ids["membership"])
            assert (member.id, member.user_id, member.community_id) == (
                ids["membership"], ids["user"], ids["irm"]
            )
            assert (member.cne, member.applicant_type, member.identifier_type) == (
                "R001234567", MembershipApplicantType.STUDENT, MembershipIdentifierType.MASSAR
            )
            assert (member.applicant_first_name, member.applicant_family_name, member.promotion) == (
                "Applicant", "Preserved", "2023/2024"
            )
            assert db.get(MembershipPermission, ids["permission"]).permission is PermissionType.CREATE_ANNOUNCEMENTS
            assert db.execute(select(modules_after_b2.c.community_id).where(
                modules_after_b2.c.id == ids["module"]
            )).scalar_one() == ids["irm"]
            saved_document = db.get(Document, ids["document"])
            assert saved_document.module_id == ids["module"]
            assert saved_document.storage_path == "legacy-community/module/document.pdf"
            assert saved_document.preview_path == "legacy-community/module/document.png"
            assert db.get(DocumentVote, ids["vote"]).document_id == ids["document"]
            assert db.get(SavedDocument, ids["saved"]).document_id == ids["document"]
            assert db.get(DocumentReading, ids["reading"]).last_page == 7
            assert db.get(Announcement, ids["announcement"]).community_id == ids["irm"]
            assert db.get(AnnouncementReply, ids["announcement_reply"]).announcement_id == ids["announcement"]
            assert db.get(CommunityPost, ids["post"]).community_id == ids["irm"]
            assert db.get(CommunityPostReply, ids["post_reply"]).post_id == ids["post"]
            assert db.get(DiscussionMessage, ids["message"]).community_id == ids["irm"]
            assert db.get(DiscussionReaction, ids["reaction"]).message_id == ids["message"]
            assert db.get(ManagementEvent, ids["event"]).target_id == ids["post"]

            expected_counts = {
                User: 1,
                Community: 2,
                Membership: 1,
                MembershipPermission: 1,
                Document: 1,
                DocumentVote: 1,
                SavedDocument: 1,
                DocumentReading: 1,
                Announcement: 1,
                AnnouncementReply: 1,
                CommunityPost: 1,
                CommunityPostReply: 1,
                DiscussionMessage: 1,
                DiscussionReaction: 1,
                ManagementEvent: 1,
            }
            for model, count in expected_counts.items():
                assert db.query(model).count() == count
            assert db.execute(select(func.count()).select_from(modules_after_b2)).scalar_one() == 1

            # The community FK prevents deleting a programme while it is in use.
            db.delete(programme)
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()

        # A referenced Programme must make downgrade stop before DDL.
        with pytest.raises(RuntimeError, match="communities reference a Programme"):
            migrate(resource.engine, resource.lease, PREVIOUS_HEAD, downgrade=True)
        assert "programmes" in inspect(resource.engine).get_table_names()
        with Session(resource.engine) as db:
            assert db.get(Community, ids["irm"]).programme_id is not None
            assert db.get(Document, ids["document"]).storage_path == "legacy-community/module/document.pdf"


def test_programme_migration_without_irm_creates_no_community_and_leaves_other_unlinked():
    with disposable_database(upgrade=False) as resource:
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD)
        communities = reflect_table(resource.engine, "communities")
        other_id = uuid4()
        with Session(resource.engine) as db:
            now = datetime.now(timezone.utc)
            db.execute(communities.insert(), {
                "id": other_id, "name": "Unclassified", "slug": f"other-{uuid4().hex[:8]}",
                "document_vote_threshold": 10, "created_at": now, "updated_at": now,
            })
            db.commit()

        migrate(resource.engine, resource.lease, NEW_HEAD)
        with Session(resource.engine) as db:
            programme = db.query(Programme).filter_by(slug="irm").one()
            assert programme.name == "IRM"
            assert db.query(Community).filter_by(slug="irm").count() == 0
            assert db.get(Community, other_id).programme_id is None
            assert db.query(Community).count() == 1

        # With no community reference, downgrade can remove only the new foundation.
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD, downgrade=True)
        assert "programmes" not in inspect(resource.engine).get_table_names()
        with Session(resource.engine) as db:
            assert db.get(Community, other_id).slug.startswith("other-")
