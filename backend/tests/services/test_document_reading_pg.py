"""Migration, constraints, cascades, and concurrent open checks on a guarded disposable schema."""
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from acceptance.isolation import disposable_database, migrate
from app.models.community import Community
from app.models.document import Document, DocumentSource, DocumentStatus, DocumentType
from app.models.document_reading import DocumentReading
from app.models.module import Module
from app.models.user import User
from app.services.document_reading import open_document

PREVIOUS_HEAD = "b21d7a4c9e60"
NEW_HEAD = "c7e4a9d213f6"


def make_user(label):
    suffix = uuid4().hex[:10]
    return User(username=f"reading_{label}_{suffix}", email=f"reading_{label}_{suffix}@example.invalid",
                password_hash="synthetic-hash", first_name="Synthetic", family_name="User")


def test_document_reading_migration_constraints_concurrency_and_cascades():
    with disposable_database(upgrade=False) as resource:
        assert resource.server_identity["database"] == "irm_integration_test"
        assert resource.server_identity["role"] == "irm_test"
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD)
        with Session(resource.engine) as db:
            uploader, reader, second_reader = make_user("uploader"), make_user("reader"), make_user("second")
            community = Community(name="Synthetic reading", slug=f"reading-{uuid4().hex[:12]}")
            db.add_all([uploader, reader, second_reader, community]); db.flush()
            module = Module(community_id=community.id, name="Signals", slug="signals")
            db.add(module); db.flush()
            document = Document(
                module_id=module.id, uploader_id=uploader.id, title="Synthetic approved PDF",
                type=DocumentType.COURSE, source=DocumentSource.OFFICIAL,
                status=DocumentStatus.APPROVED, storage_path="synthetic/never-a-file.pdf",
            )
            db.add(document); db.commit()
            document_id, reader_id, second_reader_id, uploader_id = document.id, reader.id, second_reader.id, uploader.id

        migrate(resource.engine, resource.lease, NEW_HEAD)
        inspector = inspect(resource.engine)
        columns = {column["name"]: column for column in inspector.get_columns("document_reading_records")}
        assert set(columns) == {"id", "user_id", "document_id", "last_page", "last_opened_at"}
        assert columns["last_page"]["nullable"] is False and columns["last_page"]["default"] == "1"
        assert columns["last_opened_at"]["nullable"] is False and columns["last_opened_at"]["type"].timezone
        unique_constraints = inspector.get_unique_constraints("document_reading_records")
        assert any(
            constraint.get("name") == "uq_document_reading_user_document"
            and constraint.get("column_names") == ["user_id", "document_id"]
            for constraint in unique_constraints
        )
        assert any(
            constraint["name"] == "ck_document_reading_last_page_positive"
            for constraint in inspector.get_check_constraints("document_reading_records")
        )
        indexes = {item["name"]: item for item in inspector.get_indexes("document_reading_records")}
        expected_indexes = {"ix_document_reading_user_opened_id", "ix_document_reading_document_id"}
        assert expected_indexes <= set(indexes)
        assert indexes["ix_document_reading_user_opened_id"]["column_names"] == ["user_id", "last_opened_at", "id"]
        assert indexes["ix_document_reading_document_id"]["column_names"] == ["document_id"]
        assert all(fk["options"].get("ondelete") == "CASCADE" for fk in inspector.get_foreign_keys("document_reading_records"))

        def concurrent_open(_):
            with Session(resource.engine) as db:
                return open_document(db, user_id=reader_id, document=db.get(Document, document_id)).last_page

        with ThreadPoolExecutor(max_workers=4) as pool:
            assert set(pool.map(concurrent_open, range(8))) == {1}
        with Session(resource.engine) as db:
            assert db.query(DocumentReading).filter_by(user_id=reader_id, document_id=document_id).count() == 1
            db.add(DocumentReading(user_id=second_reader_id, document_id=document_id, last_page=5))
            db.commit()
            assert db.query(DocumentReading).filter_by(document_id=document_id).count() == 2
            with pytest.raises(IntegrityError):
                db.add(DocumentReading(user_id=reader_id, document_id=document_id, last_page=7))
                db.commit()
            db.rollback()
            with pytest.raises(IntegrityError):
                db.add(DocumentReading(user_id=uploader_id, document_id=document_id, last_page=0))
                db.commit()
            db.rollback()
            db.delete(db.get(Document, document_id)); db.commit()
            assert db.query(DocumentReading).filter_by(document_id=document_id).count() == 0

            replacement = Document(
                module_id=db.query(Module).one().id, uploader_id=db.query(User).filter(User.username.like("reading_uploader_%")).one().id,
                title="Second synthetic PDF", type=DocumentType.COURSE, source=DocumentSource.OFFICIAL,
                status=DocumentStatus.APPROVED, storage_path="synthetic/second.pdf",
            )
            db.add(replacement); db.flush()
            record = DocumentReading(user_id=reader_id, document_id=replacement.id, last_page=2)
            db.add(record); db.commit()
            db.delete(db.get(User, reader_id)); db.commit()
            assert db.query(DocumentReading).filter_by(document_id=replacement.id).count() == 0

        migrate(resource.engine, resource.lease, PREVIOUS_HEAD, downgrade=True)
        assert "document_reading_records" not in inspect(resource.engine).get_table_names()
        migrate(resource.engine, resource.lease, NEW_HEAD)
        assert "document_reading_records" in inspect(resource.engine).get_table_names()
