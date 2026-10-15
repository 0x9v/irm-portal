"""Programme Module linkage preservation on guarded disposable PostgreSQL schemas."""
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from acceptance.isolation import disposable_database, migrate
from app.models.community import Community
from app.models.community_post import CommunityPost, PostModule
from app.models.document import Document, DocumentStatus
from app.models.document_reading import DocumentReading
from app.models.document_vote import DocumentVote, VoteValue
from app.models.module import Module
from app.models.programme import Programme
from app.models.saved_document import SavedDocument
from app.models.user import User


PREVIOUS_HEAD = "e4b6c8d0f219"
NEW_HEAD = "f4b8c1d2e390"


def test_module_programme_migration_preserves_community_owned_resources():
    with disposable_database(upgrade=False) as resource:
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD)
        now = datetime(2026, 10, 12, 12, 30, tzinfo=timezone.utc)
        with Session(resource.engine) as db:
            user = User(
                username=f"module_link_{uuid4().hex[:10]}",
                email=f"module_link_{uuid4().hex[:10]}@example.invalid",
                password_hash="synthetic",
                first_name="Migration",
                family_name="Fixture",
            )
            programme = db.query(Programme).filter_by(slug="irm").one()
            irm = Community(name="FST Mohammedia — IRM", slug="irm", programme_id=programme.id)
            sibling = Community(name="IRM annual community", slug=f"irm-next-{uuid4().hex[:8]}", programme_id=programme.id)
            unlinked = Community(name="Unrelated community", slug=f"unlinked-{uuid4().hex[:8]}")
            db.add_all([user, irm, sibling, unlinked])
            db.flush()
            module_ids = {"irm": uuid4(), "sibling": uuid4(), "unlinked": uuid4()}
            community_ids = {"irm": irm.id, "sibling": sibling.id, "unlinked": unlinked.id}
            for key, name in (("irm", "Signals"), ("sibling", "Signals"), ("unlinked", "Independent")):
                db.execute(
                    text("""INSERT INTO modules (id, community_id, name, slug, created_at, updated_at)
                        VALUES (:id, :community_id, :name, :slug, :created_at, :updated_at)"""),
                    {
                        "id": module_ids[key], "community_id": community_ids[key], "name": name,
                        "slug": "signals" if key != "unlinked" else "independent",
                        "created_at": now, "updated_at": now,
                    },
                )
            document_id = uuid4()
            db.execute(
                text("""INSERT INTO documents
                    (id, module_id, uploader_id, title, type, source, status, storage_path,
                     preview_path, vote_threshold_snapshot, created_at, updated_at)
                    VALUES (:id, :module_id, :uploader_id, :title, :type, :source, :status,
                     :storage_path, :preview_path, :threshold, :created_at, :updated_at)"""),
                {
                    "id": document_id, "module_id": module_ids["irm"], "uploader_id": user.id,
                    "title": "Preserved exam", "type": "EXAM", "source": "STUDENT", "status": "PENDING",
                    "storage_path": "irm/legacy-module/original.pdf",
                    "preview_path": "irm/legacy-module/original-preview.png", "threshold": 8,
                    "created_at": now, "updated_at": now,
                },
            )
            vote = DocumentVote(document_id=document_id, voter_id=user.id, vote=VoteValue.YES,
                                created_at=now, updated_at=now)
            saved = SavedDocument(user_id=user.id, document_id=document_id, created_at=now)
            reading = DocumentReading(user_id=user.id, document_id=document_id, last_page=4, last_opened_at=now)
            post = CommunityPost(community_id=irm.id, author_id=user.id, title="Tagged post", content="Preserve tag", created_at=now)
            db.add_all([vote, saved, reading, post])
            db.flush()
            db.add(PostModule(post_id=post.id, module_id=module_ids["irm"]))
            db.commit()
            ids = {"user": user.id, "programme": programme.id, "document": document_id,
                   "vote": vote.id, "saved": saved.id, "reading": reading.id, "post": post.id,
                   "modules": module_ids, "communities": community_ids}

        migrate(resource.engine, resource.lease, NEW_HEAD)
        inspector = inspect(resource.engine)
        module_columns = {column["name"]: column for column in inspector.get_columns("modules")}
        assert module_columns["programme_id"]["nullable"] is True
        assert "ix_modules_programme_id" in {index["name"] for index in inspector.get_indexes("modules")}
        module_fk = next(fk for fk in inspector.get_foreign_keys("modules")
                         if fk["constrained_columns"] == ["programme_id"])
        assert module_fk["referred_table"] == "programmes"
        assert module_fk["options"]["ondelete"] == "RESTRICT"
        assert any(constraint["name"] == "uq_modules_community_slug"
                   and constraint["column_names"] == ["community_id", "slug"]
                   for constraint in inspector.get_unique_constraints("modules"))
        assert Module.__table__.c.programme_id.nullable is True
        assert Module.programme.property.back_populates == "modules"
        assert Programme.modules.property.back_populates == "programme"

        with Session(resource.engine) as db:
            modules = {module.id: module for module in db.query(Module).all()}
            assert set(modules) == set(ids["modules"].values())
            assert modules[ids["modules"]["irm"]].programme_id == ids["programme"]
            assert modules[ids["modules"]["sibling"]].programme_id == ids["programme"]
            assert modules[ids["modules"]["unlinked"]].programme_id is None
            assert modules[ids["modules"]["irm"]].community_id == ids["communities"]["irm"]
            assert modules[ids["modules"]["sibling"]].slug == modules[ids["modules"]["irm"]].slug == "signals"
            assert {module.created_at for module in modules.values()} == {now}
            assert {module.updated_at for module in modules.values()} == {now}

            document = db.get(Document, ids["document"])
            assert (document.module_id, document.status, document.vote_threshold_snapshot) == (
                ids["modules"]["irm"], DocumentStatus.PENDING, 8
            )
            assert document.storage_path == "irm/legacy-module/original.pdf"
            assert document.preview_path == "irm/legacy-module/original-preview.png"
            assert document.created_at == now and document.updated_at == now
            preserved_vote = db.get(DocumentVote, ids["vote"])
            assert preserved_vote.vote is VoteValue.YES
            assert preserved_vote.created_at == now and preserved_vote.updated_at == now
            preserved_saved = db.get(SavedDocument, ids["saved"])
            assert preserved_saved.document_id == ids["document"] and preserved_saved.created_at == now
            preserved_reading = db.get(DocumentReading, ids["reading"])
            assert preserved_reading.last_page == 4 and preserved_reading.last_opened_at == now
            assert db.query(PostModule).filter_by(post_id=ids["post"], module_id=ids["modules"]["irm"]).count() == 1
            assert db.get(CommunityPost, ids["post"]).created_at == now
            assert db.query(Module).count() == 3
            assert db.query(Document).count() == db.query(DocumentVote).count() == 1
            assert db.query(SavedDocument).count() == db.query(DocumentReading).count() == 1
            assert db.query(CommunityPost).count() == db.query(PostModule).count() == 1
            assert db.query(Community).count() == 3
            assert db.query(Programme).count() == 1

            # Programme linkage is descriptive here and cannot bypass the existing community predicate.
            sibling_module = db.query(Module).filter_by(community_id=ids["communities"]["sibling"], slug="signals").one()
            assert sibling_module.id != ids["modules"]["irm"]

        with pytest.raises(RuntimeError, match="Modules reference a Programme"):
            migrate(resource.engine, resource.lease, PREVIOUS_HEAD, downgrade=True)
        with Session(resource.engine) as db:
            assert db.query(Module).count() == 3
            assert db.query(Document).count() == 1
            assert db.get(Document, ids["document"]).storage_path == "irm/legacy-module/original.pdf"


def test_module_programme_downgrade_is_safe_when_links_are_null():
    with disposable_database(upgrade=False) as resource:
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD)
        now = datetime(2026, 10, 12, 12, 30, tzinfo=timezone.utc)
        with Session(resource.engine) as db:
            user = User(username=f"module_safe_{uuid4().hex[:10]}", email=f"module_safe_{uuid4().hex[:10]}@example.invalid",
                        password_hash="synthetic", first_name="Safe", family_name="Downgrade")
            community = Community(name="Unlinked", slug=f"safe-{uuid4().hex[:8]}")
            db.add_all([user, community])
            db.flush()
            module_id, document_id = uuid4(), uuid4()
            db.execute(text("""INSERT INTO modules (id, community_id, name, slug, created_at, updated_at)
                VALUES (:id, :community_id, 'Safe module', 'safe-module', :now, :now)"""),
                {"id": module_id, "community_id": community.id, "now": now})
            db.execute(text("""INSERT INTO documents
                (id, module_id, uploader_id, title, type, source, status, storage_path, created_at, updated_at)
                VALUES (:id, :module_id, :user_id, 'Safe document', 'COURSE', 'OFFICIAL', 'APPROVED',
                'safe/module/file.pdf', :now, :now)"""),
                {"id": document_id, "module_id": module_id, "user_id": user.id, "now": now})
            db.commit()

        migrate(resource.engine, resource.lease, NEW_HEAD)
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD, downgrade=True)
        with resource.engine.connect() as connection:
            assert "programme_id" not in {column["name"] for column in inspect(connection).get_columns("modules")}
            assert connection.execute(text("SELECT id FROM modules")).scalar_one() == module_id
            assert connection.execute(text("SELECT id FROM documents")).scalar_one() == document_id
            assert connection.execute(text("SELECT storage_path FROM documents")).scalar_one() == "safe/module/file.pdf"
