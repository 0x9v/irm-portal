"""Guarded disposable-schema verification for the D3 removal migration."""

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import MetaData, Table, inspect, select, text
from sqlalchemy.orm import Session

from acceptance.isolation import disposable_database, migrate
from app.models.community import Community
from app.models.module import Module
from app.models.user import User


CATEGORY_HEAD = "c8e4f1a2b603"
REMOVAL_HEAD = "e3a91c6d2f40"


def test_resource_removal_migration_preserves_rows_and_refuses_lossy_downgrade():
    with disposable_database(upgrade=False) as owned:
        assert owned.server_identity["database"] == "irm_integration_test"
        assert owned.server_identity["role"] == "irm_test"
        migrate(owned.engine, owned.lease, CATEGORY_HEAD)
        with Session(owned.engine) as db:
            community = Community(name="D3", slug="d3")
            owner = User(username="d3_owner", email="d3@example.invalid",
                         password_hash="opaque", first_name="D3", family_name="Owner")
            voter = User(username="d3_voter", email="voter-d3@example.invalid",
                         password_hash="opaque", first_name="D3", family_name="Voter")
            db.add_all([community, owner, voter])
            db.flush()
            module = Module(community_id=community.id, name="D3", slug="d3")
            db.add(module)
            db.flush()
            community_id, module_id, owner_id, voter_id = community.id, module.id, owner.id, voter.id
            db.commit()

        document_id, vote_id, saved_id, reading_id = (uuid4() for _ in range(4))
        created = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)
        with owned.engine.begin() as connection:
            metadata = MetaData()
            documents = Table("documents", metadata, autoload_with=connection)
            connection.execute(documents.insert().values(
                id=document_id, module_id=module_id, uploader_id=owner_id,
                title="Historical PDF", type="TD", resource_kind="PDF", source="STUDENT",
                status="PENDING", storage_path="retained/lecture.pdf",
                vote_threshold_snapshot=3, created_at=created, updated_at=created,
            ))
            connection.execute(Table("document_votes", metadata, autoload_with=connection).insert().values(
                id=vote_id, document_id=document_id, voter_id=voter_id, vote="YES",
                created_at=created, updated_at=created,
            ))
            connection.execute(Table("saved_documents", metadata, autoload_with=connection).insert().values(
                id=saved_id, document_id=document_id, user_id=voter_id, created_at=created,
            ))
            connection.execute(Table("document_reading_records", metadata, autoload_with=connection).insert().values(
                id=reading_id, document_id=document_id, user_id=voter_id,
                last_page=7, last_opened_at=created,
            ))

        migrate(owned.engine, owned.lease, REMOVAL_HEAD)
        columns = {column["name"]: column for column in inspect(owned.engine).get_columns("documents")}
        assert columns["removed_at"]["nullable"] and columns["removed_by_id"]["nullable"]
        with owned.engine.connect() as connection:
            row = connection.execute(select(Table("documents", MetaData(), autoload_with=connection))
                                     .where(text("id = :id")), {"id": document_id}).one()
            assert row.type == "TD" and row.storage_path == "retained/lecture.pdf"
            assert row.removed_at is None and row.removed_by_id is None
            for table, record_id in (("document_votes", vote_id), ("saved_documents", saved_id),
                                     ("document_reading_records", reading_id)):
                assert connection.execute(text(f"SELECT id FROM {table} WHERE id=:id"),
                                          {"id": record_id}).scalar_one() == record_id

        with owned.engine.begin() as connection:
            connection.execute(text("UPDATE documents SET removed_at=:removed, removed_by_id=:actor WHERE id=:id"),
                               {"removed": created, "actor": voter_id, "id": document_id})
        with pytest.raises(RuntimeError, match="removed resources exist"):
            migrate(owned.engine, owned.lease, CATEGORY_HEAD, downgrade=True)
        with owned.engine.begin() as connection:
            connection.execute(text("UPDATE documents SET removed_at=NULL, removed_by_id=NULL WHERE id=:id"),
                               {"id": document_id})
            connection.execute(text("""
                INSERT INTO management_events
                    (id, community_id, actor_id, action, target_type, target_id, created_at)
                VALUES (:event, :community, :actor, 'remove', 'module_resource', :target, :created)
            """), {"event": uuid4(), "community": community_id, "actor": voter_id,
                   "target": document_id, "created": created})
        with pytest.raises(RuntimeError, match="removal audit events exist"):
            migrate(owned.engine, owned.lease, CATEGORY_HEAD, downgrade=True)
        with owned.engine.begin() as connection:
            connection.execute(text("DELETE FROM management_events WHERE target_type='module_resource' AND target_id=:id"),
                               {"id": document_id})
        migrate(owned.engine, owned.lease, CATEGORY_HEAD, downgrade=True)
        assert "removed_at" not in {column["name"] for column in inspect(owned.engine).get_columns("documents")}
        with owned.engine.connect() as connection:
            assert connection.execute(text("SELECT type FROM documents WHERE id=:id"),
                                      {"id": document_id}).scalar_one() == "TD"
            assert connection.execute(text("SELECT count(*) FROM document_votes WHERE id=:id"),
                                      {"id": vote_id}).scalar_one() == 1
            assert connection.execute(text("SELECT count(*) FROM saved_documents WHERE id=:id"),
                                      {"id": saved_id}).scalar_one() == 1
            assert connection.execute(text("SELECT count(*) FROM document_reading_records WHERE id=:id"),
                                      {"id": reading_id}).scalar_one() == 1
