"""Saved-document migration and concurrency checks on a guarded disposable schema."""
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from acceptance.isolation import disposable_database, migrate
from app.models.community import Community
from app.models.document import Document, DocumentSource, DocumentStatus, DocumentType
from app.models.module import Module
from app.models.saved_document import SavedDocument
from app.models.user import User
from app.services.saved_document import save_approved_document

PREVIOUS_HEAD = "98b4d2a6f731"
NEW_HEAD = "b21d7a4c9e60"


def make_user(label):
    return User(username=f"saved_{label}_{uuid4().hex[:8]}", email=f"saved_{label}_{uuid4().hex[:8]}@example.invalid",
                password_hash="synthetic-hash", first_name="Synthetic", family_name="User")


def test_saved_document_migration_parity_concurrency_and_cascades():
    with disposable_database(upgrade=False) as resource:
        assert resource.server_identity["database"] == "irm_integration_test"
        assert resource.server_identity["role"] == "irm_test"
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD)
        with Session(resource.engine) as db:
            owner, saver = make_user("owner"), make_user("saver")
            community = Community(name="Synthetic saved docs", slug=f"saved-{uuid4().hex[:12]}")
            db.add_all([owner, saver, community]); db.flush()
            module = Module(community_id=community.id, name="Signals", slug="signals")
            db.add(module); db.flush()
            document = Document(
                module_id=module.id, uploader_id=owner.id, title="Synthetic approved",
                type=DocumentType.COURSE, source=DocumentSource.OFFICIAL,
                status=DocumentStatus.APPROVED, storage_path="synthetic/never-a-file.pdf",
                vote_threshold_snapshot=None,
            )
            db.add(document); db.commit()
            community_slug, document_id, saver_id, owner_id = community.slug, document.id, saver.id, owner.id

        migrate(resource.engine, resource.lease, NEW_HEAD)
        inspector = inspect(resource.engine)
        columns = {column["name"]: column for column in inspector.get_columns("saved_documents")}
        assert set(columns) == {"id", "user_id", "document_id", "created_at"}
        assert columns["created_at"]["nullable"] is False and columns["created_at"]["type"].timezone
        unique_constraints = inspector.get_unique_constraints("saved_documents")
        assert any(
            constraint.get("name") == "uq_saved_documents_user_document"
            and constraint.get("column_names") == ["user_id", "document_id"]
            for constraint in unique_constraints
        )
        indexes = {index["name"]: index for index in inspector.get_indexes("saved_documents")}
        expected_indexes = {"ix_saved_documents_user_created_id", "ix_saved_documents_document_id"}
        assert expected_indexes <= set(indexes)
        assert indexes["ix_saved_documents_user_created_id"]["column_names"] == ["user_id", "created_at", "id"]
        assert indexes["ix_saved_documents_document_id"]["column_names"] == ["document_id"]
        assert [foreign_key["options"].get("ondelete") for foreign_key in inspector.get_foreign_keys("saved_documents")] == ["CASCADE", "CASCADE"]

        def concurrent_save(_):
            with Session(resource.engine) as db:
                return save_approved_document(db, saver_id, community_slug, document_id)

        with ThreadPoolExecutor(max_workers=4) as pool:
            assert all(pool.map(concurrent_save, range(8)))
        with Session(resource.engine) as db:
            assert db.query(SavedDocument).filter_by(user_id=saver_id, document_id=document_id).count() == 1
            db.delete(db.get(User, saver_id)); db.commit()
            assert db.query(SavedDocument).filter_by(user_id=saver_id).count() == 0
            other = make_user("other")
            db.add(other); db.flush()
            db.add(SavedDocument(user_id=other.id, document_id=document_id)); db.commit()
            db.delete(db.get(Document, document_id)); db.commit()
            assert db.query(SavedDocument).filter_by(user_id=other.id).count() == 0

        migrate(resource.engine, resource.lease, PREVIOUS_HEAD, downgrade=True)
        assert "saved_documents" not in inspect(resource.engine).get_table_names()
        migrate(resource.engine, resource.lease, NEW_HEAD)
        assert "saved_documents" in inspect(resource.engine).get_table_names()
