"""Guarded PostgreSQL migration, data-preservation, and payload-constraint checks."""

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import MetaData, Table, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from acceptance.isolation import disposable_database, migrate
from app.models.community import Community
from app.models.module import Module
from app.models.user import User


PREVIOUS_HEAD = "e8a4f6b1c932"
NEW_HEAD = "b7c3e9a4d182"
CREATED = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)


def _historical_document_rows(resource, module_id, uploader_id, vote_user_id):
    document_ids = {suffix: uuid4() for suffix in ("pdf", "jpg", "png")}
    with resource.engine.begin() as connection:
        metadata = MetaData()
        documents = Table("documents", metadata, autoload_with=connection)
        for suffix, document_id in document_ids.items():
            connection.execute(documents.insert().values(
                id=document_id, module_id=module_id, uploader_id=uploader_id,
                title=f"Legacy {suffix}", type="COURSE", source="STUDENT", status="PENDING",
                storage_path=f"{module_id}/{uuid4()}.{suffix}", preview_path=None,
                vote_threshold_snapshot=4, created_at=CREATED, updated_at=CREATED,
            ))
        votes = Table("document_votes", metadata, autoload_with=connection)
        connection.execute(votes.insert().values(
            id=uuid4(), document_id=document_ids["jpg"], voter_id=vote_user_id,
            vote="YES", created_at=CREATED, updated_at=CREATED,
        ))
        saved = Table("saved_documents", metadata, autoload_with=connection)
        connection.execute(saved.insert().values(
            id=uuid4(), user_id=vote_user_id, document_id=document_ids["pdf"], created_at=CREATED,
        ))
        reading = Table("document_reading_records", metadata, autoload_with=connection)
        connection.execute(reading.insert().values(
            id=uuid4(), user_id=vote_user_id, document_id=document_ids["pdf"],
            last_page=3, last_opened_at=CREATED,
        ))
    return document_ids


def test_typed_resource_migration_backfills_legacy_formats_and_preserves_relations():
    with disposable_database(upgrade=False) as resource:
        assert resource.server_identity["database"] == "irm_integration_test"
        assert resource.server_identity["role"] == "irm_test"
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD)

        with Session(resource.engine) as session:
            community = Community(name="MR2 legacy", slug="mr2-legacy", document_vote_threshold=4)
            uploader = User(username="mr2_uploader", email="mr2-uploader@example.invalid",
                            password_hash="opaque", first_name="Legacy", family_name="Uploader")
            voter = User(username="mr2_voter", email="mr2-voter@example.invalid",
                         password_hash="opaque", first_name="Vote", family_name="Preserver")
            session.add_all([community, uploader, voter])
            session.flush()
            module = Module(community_id=community.id, name="Historical", slug="historical")
            session.add(module)
            session.flush()
            # Copy plain UUID scalars while the ORM session is live; all later
            # historical Core inserts/assertions use only these captured values.
            community_id, module_id = community.id, module.id
            uploader_id, voter_id = uploader.id, voter.id
            session.commit()

        document_ids = _historical_document_rows(resource, module_id, uploader_id, voter_id)
        migrate(resource.engine, resource.lease, NEW_HEAD)

        columns = {column["name"]: column for column in inspect(resource.engine).get_columns("documents")}
        assert columns["storage_path"]["nullable"] is True
        assert columns["type"]["nullable"] is True
        assert columns["resource_kind"]["nullable"] is False
        with resource.engine.connect() as connection:
            migrated_documents = Table("documents", MetaData(), autoload_with=connection)
            mapped = dict(connection.execute(
                select(migrated_documents.c.id, migrated_documents.c.resource_kind)
                .where(migrated_documents.c.id.in_(list(document_ids.values())))
            ).all())
            assert mapped == {
                document_ids["pdf"]: "PDF",
                document_ids["jpg"]: "IMAGE",
                document_ids["png"]: "IMAGE",
            }
            assert connection.execute(text("SELECT count(*) FROM document_votes WHERE document_id=:id"),
                                      {"id": document_ids["jpg"]}).scalar_one() == 1
            assert connection.execute(text("SELECT count(*) FROM saved_documents WHERE document_id=:id"),
                                      {"id": document_ids["pdf"]}).scalar_one() == 1
            assert connection.execute(text("SELECT count(*) FROM document_reading_records WHERE document_id=:id"),
                                      {"id": document_ids["pdf"]}).scalar_one() == 1
            assert connection.execute(text("SELECT community_id FROM modules WHERE id=:id"),
                                      {"id": module_id}).scalar_one() == community_id

        constraints = {constraint["name"] for constraint in inspect(resource.engine).get_check_constraints("documents")}
        assert {"ck_document_resource_kind", "ck_document_resource_payload",
                "ck_document_resource_image_key", "ck_document_description_length"}.issubset(constraints)

        # A URL resource cannot carry a file payload, and a canonical image key
        # cannot coexist with the legacy file/preview columns.
        with resource.engine.begin() as connection:
            documents = Table("documents", MetaData(), autoload_with=connection)
            valid_link = dict(
                module_id=module_id, uploader_id=uploader_id, title="Validated link", type=None,
                source="OFFICIAL", status="APPROVED", storage_path=None, preview_path=None,
                vote_threshold_snapshot=None, created_at=CREATED, updated_at=CREATED,
                description=None, resource_kind="LINK", image_storage_key=None,
                youtube_video_id=None, external_url="https://example.com/notes",
            )
            link_id = uuid4()
            connection.execute(documents.insert().values(id=link_id, **valid_link))
            image_id = uuid4()
            connection.execute(documents.insert().values(
                id=image_id, module_id=module_id, uploader_id=uploader_id,
                title="Canonical image", type=None, source="OFFICIAL", status="APPROVED",
                storage_path=None, preview_path=None, vote_threshold_snapshot=None,
                created_at=CREATED, updated_at=CREATED, description=None,
                resource_kind="IMAGE",
                image_storage_key=f"module-resources/{community_id}/{module_id}/{uuid4()}/{uuid4()}.webp",
                youtube_video_id=None, external_url=None,
            ))
        with pytest.raises(IntegrityError):
            with resource.engine.begin() as connection:
                connection.execute(text("UPDATE documents SET type='OTHER' WHERE id=:id"),
                                   {"id": image_id})
        with pytest.raises(IntegrityError):
            with resource.engine.begin() as connection:
                connection.execute(text("UPDATE documents SET storage_path='wrong.pdf' WHERE id=:id"),
                                   {"id": link_id})

        with pytest.raises(RuntimeError, match="Cannot downgrade typed module resources"):
            migrate(resource.engine, resource.lease, PREVIOUS_HEAD, downgrade=True)
        assert "resource_kind" in {column["name"] for column in inspect(resource.engine).get_columns("documents")}

        with resource.engine.begin() as connection:
            connection.execute(text("DELETE FROM documents WHERE id=:id"), {"id": link_id})
            connection.execute(text("DELETE FROM documents WHERE id=:id"), {"id": image_id})
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD, downgrade=True)
        legacy_columns = {column["name"] for column in inspect(resource.engine).get_columns("documents")}
        assert "resource_kind" not in legacy_columns and "description" not in legacy_columns
        with resource.engine.connect() as connection:
            metadata = MetaData()
            legacy_documents = Table("documents", metadata, autoload_with=connection)
            rows = connection.execute(select(legacy_documents.c.id, legacy_documents.c.storage_path)
                                      .where(legacy_documents.c.id.in_(list(document_ids.values())))).all()
            assert {row.id for row in rows} == set(document_ids.values())
            assert connection.execute(text("SELECT count(*) FROM document_votes WHERE document_id=:id"),
                                      {"id": document_ids["jpg"]}).scalar_one() == 1
            assert connection.execute(text("SELECT count(*) FROM saved_documents WHERE document_id=:id"),
                                      {"id": document_ids["pdf"]}).scalar_one() == 1
            assert connection.execute(text("SELECT count(*) FROM document_reading_records WHERE document_id=:id"),
                                      {"id": document_ids["pdf"]}).scalar_one() == 1

        migrate(resource.engine, resource.lease, NEW_HEAD)
        with resource.engine.connect() as connection:
            image_kind = connection.execute(text("SELECT resource_kind FROM documents WHERE id=:id"),
                                            {"id": document_ids["png"]}).scalar_one()
            assert image_kind == "IMAGE"


def test_unknown_legacy_storage_suffix_aborts_without_guessing_a_kind():
    with disposable_database(upgrade=False) as resource:
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD)
        with Session(resource.engine) as session:
            community = Community(name="MR2 unknown", slug="mr2-unknown")
            user = User(username="mr2_unknown", email="mr2-unknown@example.invalid",
                        password_hash="opaque", first_name="Unknown", family_name="Suffix")
            session.add_all([community, user])
            session.flush()
            module = Module(community_id=community.id, name="Bad path", slug="bad-path")
            session.add(module)
            session.flush()
            module_id, uploader_id = module.id, user.id
            session.commit()
        bad_id = uuid4()
        with resource.engine.begin() as connection:
            documents = Table("documents", MetaData(), autoload_with=connection)
            connection.execute(documents.insert().values(
                id=bad_id, module_id=module_id, uploader_id=uploader_id, title="Unknown",
                type="OTHER", source="OFFICIAL", status="APPROVED", storage_path="legacy/unknown.bin",
                preview_path=None, vote_threshold_snapshot=None, created_at=CREATED, updated_at=CREATED,
            ))
        with pytest.raises(RuntimeError, match=str(bad_id)):
            migrate(resource.engine, resource.lease, NEW_HEAD)
        assert "resource_kind" not in {column["name"] for column in inspect(resource.engine).get_columns("documents")}
        with resource.engine.connect() as connection:
            assert connection.execute(text("SELECT count(*) FROM documents WHERE id=:id AND storage_path='legacy/unknown.bin'"),
                                      {"id": bad_id}).scalar_one() == 1
