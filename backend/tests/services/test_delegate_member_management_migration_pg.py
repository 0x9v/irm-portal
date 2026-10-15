"""Real PostgreSQL migration verification for Task 0.1.8 in disposable schema."""

import uuid
from datetime import datetime, timezone
from pathlib import Path
import pytest
from sqlalchemy import create_engine, text
from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.autogenerate import compare_metadata

from app.database import Base
import app.models

from acceptance.isolation import disposable_database, migrate


@pytest.fixture
def disposable_pg_schema():
    with disposable_database(upgrade=False) as resource:
        yield resource


def test_member_management_migration_lifecycle_and_parity_pg(disposable_pg_schema):
    resource = disposable_pg_schema
    engine, schema = resource.engine, resource.lease.schema

    cfg = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    script = ScriptDirectory.from_config(cfg)

    # Standard Alembic machinery; version tracking remains inside this lease.
    migrate(engine, resource.lease, "a916c0e16b01")

    # 2. Insert representative synthetic existing data
    user_id = uuid.uuid4()
    delegate_id = uuid.uuid4()
    comm_id = uuid.uuid4()
    mid_1 = uuid.uuid4()
    mid_2 = uuid.uuid4()
    now = datetime.now(timezone.utc)

    with engine.begin() as conn:
        conn.execute(text(f"SET search_path TO {schema}"))
        conn.execute(
            text(f"""
                INSERT INTO {schema}.users (id, username, email, password_hash, first_name, family_name, created_at, updated_at)
                VALUES (:u1, 'testuser', 'test@example.com', 'hash', 'Test', 'User', :now, :now),
                       (:u2, 'deluser', 'del@example.com', 'hash', 'Del', 'User', :now, :now)
            """),
            {"u1": user_id, "u2": delegate_id, "now": now},
        )
        conn.execute(
            text(f"""
                INSERT INTO {schema}.communities (id, name, slug, document_vote_threshold, created_at, updated_at)
                VALUES (:cid, 'Test Community', 'test-comm', 10, :now, :now)
            """),
            {"cid": comm_id, "now": now},
        )
        conn.execute(
            text(f"""
                INSERT INTO {schema}.memberships (id, user_id, community_id, role, status, cne, created_at, updated_at)
                VALUES (:m1, :u1, :cid, 'MEMBER', 'ACTIVE', 'CNE1', :now, :now),
                       (:m2, :u2, :cid, 'DELEGATE', 'ACTIVE', 'CNE2', :now, :now)
            """),
            {"m1": mid_1, "m2": mid_2, "u1": user_id, "u2": delegate_id, "cid": comm_id, "now": now},
        )
        # Content removal event
        ann_target = uuid.uuid4()
        conn.execute(
            text(f"""
                INSERT INTO {schema}.management_events (id, community_id, actor_id, action, target_type, target_id, created_at)
                VALUES (:ev_id, :cid, :aid, 'remove', 'announcement', :tid, :now)
            """),
            {"ev_id": uuid.uuid4(), "cid": comm_id, "aid": delegate_id, "tid": ann_target, "now": now},
        )

    # Snapshot pre-migration rows
    tables = ["users", "communities", "memberships", "management_events"]
    pre_snapshots = {}
    with engine.connect() as conn:
        for tbl in tables:
            rows = conn.execute(text(f"SELECT * FROM {schema}.{tbl}")).mappings().fetchall()
            pre_snapshots[tbl] = [dict(r) for r in rows]

    # 3. Apply new revision c4d8e9f1a2b3
    rev_c4d8 = script.get_revision("c4d8e9f1a2b3")
    assert rev_c4d8.down_revision == "a916c0e16b01"

    migrate(engine, resource.lease)

    # 4. Verify preservation and constraints
    with engine.connect() as conn:
        # Check all rows preserved
        for tbl in tables:
            rows = conn.execute(text(f"SELECT * FROM {schema}.{tbl}")).mappings().fetchall()
            assert len(rows) == len(pre_snapshots[tbl])
            for r in rows:
                orig = next(o for o in pre_snapshots[tbl] if o["id"] == r["id"])
                for k, v in orig.items():
                    assert r[k] == v, f"Field {k} altered in {tbl}"

        # Verify check constraint on memberships status
        ck_res = conn.execute(text(f"""
            SELECT conname, pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            JOIN pg_namespace n ON t.relnamespace = n.oid
            WHERE n.nspname = :s AND t.relname = 'memberships' AND c.conname = 'membership_status';
        """), {"s": schema}).fetchall()
        assert len(ck_res) == 1, "membership_status check constraint not found on PostgreSQL"
        assert "REMOVED" in ck_res[0][1] and "BANNED" in ck_res[0][1]

        # Verify partial unique index on management_events
        idx_res = conn.execute(text(f"""
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = :s AND tablename = 'management_events' AND indexname = 'uq_management_events_removal_target';
        """), {"s": schema}).fetchall()
        assert len(idx_res) == 1, "uq_management_events_removal_target index not found"
        assert "target_type" in idx_res[0][1]

        # Verify that multiple membership management events CAN be inserted for the same target
        mem_target_id = mid_1
        conn.execute(
            text(f"""
                INSERT INTO {schema}.management_events (id, community_id, actor_id, action, target_type, target_id, created_at)
                VALUES (:e1, :cid, :aid, 'remove', 'membership', :tid, :now),
                       (:e2, :cid, :aid, 'remove', 'membership', :tid, :now);
            """),
            {"e1": uuid.uuid4(), "e2": uuid.uuid4(), "cid": comm_id, "aid": delegate_id, "tid": mem_target_id, "now": now},
        )
        conn.commit()

        # But content removal events still enforce uniqueness!
        with pytest.raises(Exception):
            conn.execute(
                text(f"""
                    INSERT INTO {schema}.management_events (id, community_id, actor_id, action, target_type, target_id, created_at)
                    VALUES (:e, :cid, :aid, 'remove', 'announcement', :tid, :now);
                """),
                {"e": uuid.uuid4(), "cid": comm_id, "aid": delegate_id, "tid": ann_target, "now": now},
            )
        conn.rollback()

    # 5. Downgrade only inside disposable test schema back to a916c0e16b01
    with engine.connect() as conn:
        # Clean the second membership event inserted during constraint testing so downgrade unique constraint succeeds
        conn.execute(text(f"DELETE FROM {schema}.management_events WHERE target_type = 'membership'"))
        conn.commit()

    migrate(engine, resource.lease, "a916c0e16b01", downgrade=True)

    with engine.connect() as conn:
        # Check constraint removed
        ck_res = conn.execute(text(f"""
            SELECT conname
            FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            JOIN pg_namespace n ON t.relnamespace = n.oid
            WHERE n.nspname = :s AND t.relname = 'memberships' AND c.conname = 'membership_status';
        """), {"s": schema}).fetchall()
        assert len(ck_res) == 0, "membership_status check constraint still present after downgrade"

        # Unique constraint restored
        uq_res = conn.execute(text(f"""
            SELECT constraint_name
            FROM information_schema.table_constraints
            WHERE table_schema = :s AND table_name = 'management_events' AND constraint_name = 'uq_management_events_removal_target';
        """), {"s": schema}).fetchall()
        assert len(uq_res) == 1, "uq_management_events_removal_target unique constraint not restored after downgrade"

    # 6. Re-upgrade and verify model parity with Base.metadata
    migrate(engine, resource.lease)

    with engine.connect() as conn:
        conn.execute(text(f"SET search_path TO {schema}"))
        context = MigrationContext.configure(conn, opts={"version_table_schema": schema})
        diff = compare_metadata(context, Base.metadata)
        real_diffs = [d for d in diff if not (d[0] == "remove_table" and d[1].name == "alembic_version")]
        assert real_diffs == [], f"Schema parity mismatch after re-upgrade: {real_diffs}"
