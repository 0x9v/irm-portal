"""Guarded PostgreSQL acceptance for literal module-document title search."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from acceptance.isolation import disposable_database
from app.core.config import settings
from app.core.sessions import create_session
from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models.community import Community
from app.models.document import Document, DocumentSource, DocumentStatus, DocumentType
from app.models.module import Module
from app.models.user import User


def test_postgres_module_search_escapes_like_metacharacters_and_keeps_scope():
    with disposable_database() as resource:
        inspector = inspect(resource.engine)
        for table_name in ("saved_documents", "document_reading_records"):
            model_table = Base.metadata.tables[table_name]
            database_columns = {
                column["name"]: column
                for column in inspector.get_columns(table_name)
            }
            assert set(database_columns) == set(model_table.columns.keys())
            assert all(
                database_columns[column.name]["nullable"] == column.nullable
                for column in model_table.columns
            )

        community_slug = f"search-{uuid4().hex[:12]}"
        foreign_slug = f"foreign-{uuid4().hex[:12]}"
        suffix = uuid4().hex[:12]
        with Session(resource.engine) as db:
            user = User(
                username=f"search_{suffix}",
                email=f"search_{suffix}@example.invalid",
                password_hash="synthetic-hash",
                first_name="Synthetic",
                family_name="Reader",
            )
            community = Community(name="Synthetic search", slug=community_slug)
            foreign_community = Community(name="Foreign search", slug=foreign_slug)
            db.add_all([user, community, foreign_community])
            db.flush()
            module = Module(community_id=community.id, name="Search module", slug=f"module-{suffix}")
            other_module = Module(community_id=community.id, name="Other module", slug=f"other-{suffix}")
            foreign_module = Module(community_id=foreign_community.id, name="Foreign module", slug=f"foreign-{suffix}")
            db.add_all([module, other_module, foreign_module])
            db.flush()

            def add_document(title, *, target_module=module, doc_type=DocumentType.COURSE,
                             source=DocumentSource.OFFICIAL, status=DocumentStatus.APPROVED,
                             created_at):
                document = Document(
                    module_id=target_module.id,
                    uploader_id=user.id,
                    title=title,
                    type=doc_type,
                    source=source,
                    status=status,
                    storage_path=f"synthetic/{uuid4()}.pdf",
                    vote_threshold_snapshot=None,
                    created_at=created_at,
                    updated_at=created_at,
                )
                db.add(document)
                db.flush()
                return document

            instant = lambda hour: datetime(2026, 8, 1, hour, tzinfo=timezone.utc)
            percent = add_document("Matrix 100% exact", created_at=instant(8))
            add_document("Matrix 1000 exact", created_at=instant(7))
            underscore = add_document("Matrix_A exact", created_at=instant(6))
            add_document("MatrixXA exact", created_at=instant(5))
            backslash = add_document(r"Matrix\Archive exact", created_at=instant(4))
            add_document("MatrixArchive exact", created_at=instant(3))
            combined = add_document(
                "Linear Algebra 2026", doc_type=DocumentType.TD,
                source=DocumentSource.OFFICIAL, created_at=instant(12),
            )
            add_document(
                "Linear Algebra wrong type", doc_type=DocumentType.EXAM,
                source=DocumentSource.OFFICIAL, created_at=instant(11),
            )
            add_document(
                "Linear Algebra wrong source", doc_type=DocumentType.TD,
                source=DocumentSource.STUDENT, created_at=instant(10),
            )
            pending = add_document(
                "Linear Algebra pending", doc_type=DocumentType.TD,
                source=DocumentSource.OFFICIAL, status=DocumentStatus.PENDING,
                created_at=instant(9),
            )
            other_module_doc = add_document(
                "Linear Algebra other module", target_module=other_module, created_at=instant(13)
            )
            foreign_community_doc = add_document(
                "Linear Algebra foreign community", target_module=foreign_module, created_at=instant(14)
            )
            raw_token, _ = create_session(db, user.id, timedelta(days=1))
            db.commit()
            module_slug = module.slug
            percent_id = percent.id
            underscore_id = underscore.id
            backslash_id = backslash.id
            combined_id = combined.id
            pending_id = pending.id
            other_module_doc_id = other_module_doc.id
            foreign_community_doc_id = foreign_community_doc.id

        original_overrides = app.dependency_overrides.copy()

        def override_get_db():
            with resource.factory() as session:
                yield session

        app.dependency_overrides[get_db] = override_get_db
        client = TestClient(app)
        client.cookies.set(settings.session_cookie_name, raw_token)
        base = f"/api/v1/communities/{community_slug}/modules/{module_slug}/documents"
        try:
            for literal, expected in (("%", percent_id), ("_", underscore_id), ("\\", backslash_id)):
                response = client.get(base, params={"q": literal})
                assert response.status_code == 200
                assert [item["id"] for item in response.json()] == [str(expected)]

            combined_response = client.get(
                base,
                params={"q": " linear ", "type": "TD", "source": "OFFICIAL"},
            )
            assert combined_response.status_code == 200
            assert [item["id"] for item in combined_response.json()] == [str(combined_id)]
            assert str(pending_id) not in {item["id"] for item in combined_response.json()}

            unfiltered = client.get(base)
            assert unfiltered.status_code == 200
            rows = unfiltered.json()
            assert rows[0]["id"] == str(combined_id)
            result_ids = {item["id"] for item in rows}
            assert str(pending_id) not in result_ids
            assert str(other_module_doc_id) not in result_ids
            assert str(foreign_community_doc_id) not in result_ids
            assert all(
                rows[index]["created_at"] >= rows[index + 1]["created_at"]
                for index in range(len(rows) - 1)
            )
            assert all(item["status"] == "APPROVED" for item in rows)
            assert "storage_path" not in rows[0]
        finally:
            client.close()
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)
