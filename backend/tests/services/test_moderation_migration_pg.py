"""Real PostgreSQL migration verification for Subtask 0.1.7 in disposable schema."""

import uuid
from datetime import datetime, timezone
from pathlib import Path
import pytest
from sqlalchemy import create_engine, text, inspect
from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.autogenerate import compare_metadata

from app.database import Base
import app.models  # Ensure all models are registered on Base.metadata

DB_URL = "postgresql+psycopg://irm_test:irm_test@127.0.0.1:5432/irm_integration_test"
APPROVED_TEST_DB = "irm_integration_test"


def verify_test_db_identity(engine):
    with engine.connect() as conn:
        db_name = conn.execute(text("SELECT current_database();")).scalar()
        if db_name != APPROVED_TEST_DB:
            raise RuntimeError(
                f"SECURITY REFUSAL: Refusing migration test on '{db_name}'. "
                f"Must be strictly '{APPROVED_TEST_DB}'."
            )


@pytest.fixture
def disposable_pg_schema():
    engine = create_engine(DB_URL)
    verify_test_db_identity(engine)
    schema_name = f"disp_mig_{uuid.uuid4().hex[:8]}"

    with engine.begin() as conn:
        conn.execute(text(f"CREATE SCHEMA {schema_name};"))

    try:
        yield engine, schema_name
    finally:
        with engine.begin() as conn:
            conn.execute(text(f"DROP SCHEMA IF EXISTS {schema_name} CASCADE;"))
        engine.dispose()


def test_migration_lifecycle_and_data_preservation_pg(disposable_pg_schema):
    engine, schema = disposable_pg_schema

    cfg = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    script = ScriptDirectory.from_config(cfg)

    # 1. Build chain from base up to f8c2b3d4e5f6
    rev_chain = []
    curr = script.get_revision("f8c2b3d4e5f6")
    while curr is not None:
        rev_chain.append(curr)
        curr = script.get_revision(curr.down_revision) if curr.down_revision else None
    rev_chain.reverse()

    assert len(rev_chain) == 18
    assert rev_chain[-1].revision == "f8c2b3d4e5f6"

    # Execute upgrade to preceding revision (f8c2b3d4e5f6)
    with engine.connect() as conn:
        conn.execute(text(f"SET search_path TO {schema}"))
        context = MigrationContext.configure(conn, opts={"version_table_schema": schema})
        with Operations.context(context):
            for rev in rev_chain:
                rev.module.upgrade()
                context.stamp(script, rev.revision)
        conn.commit()

    # 2. Insert representative synthetic pre-migration fixtures
    user_id = uuid.uuid4()
    delegate_id = uuid.uuid4()
    comm_id = uuid.uuid4()
    module_id = uuid.uuid4()
    doc_id = uuid.uuid4()
    ann_id = uuid.uuid4()
    ann_rep_id = uuid.uuid4()
    post_id = uuid.uuid4()
    post_rep_id = uuid.uuid4()
    msg_id = uuid.uuid4()
    reaction_id = uuid.uuid4()

    now = datetime.now(timezone.utc)

    with engine.begin() as conn:
        conn.execute(text(f"SET search_path TO {schema}"))
        # Insert users
        conn.execute(
            text(f"""
                INSERT INTO {schema}.users (id, username, email, password_hash, first_name, family_name, created_at, updated_at)
                VALUES (:u1, 'testuser', 'test@example.com', 'hash', 'Test', 'User', :now, :now),
                       (:u2, 'deluser', 'del@example.com', 'hash', 'Del', 'User', :now, :now)
            """),
            {"u1": user_id, "u2": delegate_id, "now": now},
        )
        # Insert community
        conn.execute(
            text(f"""
                INSERT INTO {schema}.communities (id, name, slug, document_vote_threshold, created_at, updated_at)
                VALUES (:cid, 'Test Community', 'test-comm', 10, :now, :now)
            """),
            {"cid": comm_id, "now": now},
        )
        # Insert memberships
        conn.execute(
            text(f"""
                INSERT INTO {schema}.memberships (id, user_id, community_id, role, status, cne, created_at, updated_at)
                VALUES (:m1, :u1, :cid, 'MEMBER', 'ACTIVE', 'CNE1', :now, :now),
                       (:m2, :u2, :cid, 'DELEGATE', 'ACTIVE', 'CNE2', :now, :now)
            """),
            {"m1": uuid.uuid4(), "m2": uuid.uuid4(), "u1": user_id, "u2": delegate_id, "cid": comm_id, "now": now},
        )
        # Insert module
        conn.execute(
            text(f"""
                INSERT INTO {schema}.modules (id, community_id, name, slug, created_at, updated_at)
                VALUES (:mid, :cid, 'Module 1', 'mod-1', :now, :now)
            """),
            {"mid": module_id, "cid": comm_id, "now": now},
        )
        # Insert document
        conn.execute(
            text(f"""
                INSERT INTO {schema}.documents (id, module_id, uploader_id, title, type, source, status, storage_path, vote_threshold_snapshot, created_at, updated_at)
                VALUES (:did, :mid, :uid, 'Doc Title', 'COURSE', 'OFFICIAL', 'APPROVED', '/path/test.pdf', 10, :now, :now)
            """),
            {"did": doc_id, "mid": module_id, "uid": user_id, "now": now},
        )
        # Insert announcement
        conn.execute(
            text(f"""
                INSERT INTO {schema}.announcements (id, community_id, author_id, title, content, created_at, updated_at)
                VALUES (:aid, :cid, :uid, 'Ann Title', 'Ann Content', :now, :now)
            """),
            {"aid": ann_id, "cid": comm_id, "uid": user_id, "now": now},
        )
        # Insert announcement reply
        conn.execute(
            text(f"""
                INSERT INTO {schema}.announcement_replies (id, announcement_id, author_id, content, created_at)
                VALUES (:arid, :aid, :uid, 'Ann Reply Content', :now)
            """),
            {"arid": ann_rep_id, "aid": ann_id, "uid": user_id, "now": now},
        )
        # Insert post
        conn.execute(
            text(f"""
                INSERT INTO {schema}.community_posts (id, community_id, author_id, title, content, created_at)
                VALUES (:pid, :cid, :uid, 'Post Title', 'Post Content', :now)
            """),
            {"pid": post_id, "cid": comm_id, "uid": user_id, "now": now},
        )
        # Insert post reply
        conn.execute(
            text(f"""
                INSERT INTO {schema}.community_post_replies (id, post_id, author_id, content, created_at)
                VALUES (:prid, :pid, :uid, 'Post Reply Content', :now)
            """),
            {"prid": post_rep_id, "pid": post_id, "uid": user_id, "now": now},
        )
        # Insert discussion message
        conn.execute(
            text(f"""
                INSERT INTO {schema}.discussion_messages (id, community_id, author_id, kind, content, client_message_id, created_at)
                VALUES (:mid, :cid, :uid, 'TEXT', 'Msg Content', :cmid, :now)
            """),
            {"mid": msg_id, "cid": comm_id, "uid": user_id, "cmid": uuid.uuid4(), "now": now},
        )
        # Insert reaction
        conn.execute(
            text(f"""
                INSERT INTO {schema}.discussion_reactions (id, message_id, user_id, emoji, created_at)
                VALUES (:rid, :mid, :uid, 'heart', :now)
            """),
            {"rid": reaction_id, "mid": msg_id, "uid": user_id, "now": now},
        )

    # Snapshot pre-migration state of all records
    content_tables = ["announcements", "announcement_replies", "community_posts", "community_post_replies", "discussion_messages"]
    pre_snapshots = {}
    with engine.connect() as conn:
        for tbl in content_tables + ["users", "communities", "memberships", "modules", "documents"]:
            rows = conn.execute(text(f"SELECT * FROM {schema}.{tbl}")).mappings().fetchall()
            pre_snapshots[tbl] = [dict(r) for r in rows]

    # 3. Upgrade to a916c0e16b01
    rev_a916 = script.get_revision("a916c0e16b01")
    with engine.connect() as conn:
        conn.execute(text(f"SET search_path TO {schema}"))
        context = MigrationContext.configure(conn, opts={"version_table_schema": schema})
        with Operations.context(context):
            rev_a916.module.upgrade()
            context.stamp(script, rev_a916.revision)
        conn.commit()

    # 4. Verify new columns, tables, constraints
    with engine.connect() as conn:
        # Check columns on all 5 content tables
        for tbl in content_tables:
            cols = conn.execute(text(f"""
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_schema = :s AND table_name = :t
            """), {"s": schema, "t": tbl}).fetchall()
            col_dict = {c[0]: c for c in cols}
            assert "removed_at" in col_dict, f"Missing removed_at in {tbl}"
            assert "removed_by_id" in col_dict, f"Missing removed_by_id in {tbl}"
            assert col_dict["removed_at"][2] == "YES", f"removed_at should be nullable in {tbl}"
            assert col_dict["removed_by_id"][2] == "YES", f"removed_by_id should be nullable in {tbl}"

        # Check management_events table exists
        mg_cols = conn.execute(text(f"""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = :s AND table_name = 'management_events'
        """), {"s": schema}).fetchall()
        assert len(mg_cols) >= 7, "management_events table incomplete"

        # Check unique constraint on management_events
        uq_res = conn.execute(text(f"""
            SELECT tc.constraint_name
            FROM information_schema.table_constraints tc
            WHERE tc.table_schema = :s AND tc.table_name = 'management_events'
              AND tc.constraint_type = 'UNIQUE'
        """), {"s": schema}).fetchall()
        assert any("uq_management_events_removal_target" in r[0] for r in uq_res)

        # 5. Verify existing synthetic records remain visible and unchanged
        for tbl in content_tables:
            rows = conn.execute(text(f"SELECT * FROM {schema}.{tbl}")).mappings().fetchall()
            assert len(rows) == len(pre_snapshots[tbl])
            for r in rows:
                assert r["removed_at"] is None, f"{tbl} row removed_at is not NULL"
                assert r["removed_by_id"] is None, f"{tbl} row removed_by_id is not NULL"
                # Check that original columns have not changed
                orig = next(o for o in pre_snapshots[tbl] if o["id"] == r["id"])
                for k, v in orig.items():
                    assert r[k] == v, f"Field {k} changed in {tbl}"

        # Verify other tables untouched
        for tbl in ["users", "communities", "memberships", "modules", "documents"]:
            rows = conn.execute(text(f"SELECT * FROM {schema}.{tbl}")).mappings().fetchall()
            assert len(rows) == len(pre_snapshots[tbl])
            for r in rows:
                orig = next(o for o in pre_snapshots[tbl] if o["id"] == r["id"])
                for k, v in orig.items():
                    assert r[k] == v, f"Field {k} changed in {tbl}"

    # 6. Verify foreign key SET NULL behavior on content tables and management_events
    temp_actor_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text(f"SET search_path TO {schema}"))
        conn.execute(
            text(f"""
                INSERT INTO {schema}.users (id, username, email, password_hash, first_name, family_name, created_at, updated_at)
                VALUES (:uid, 'removactor', 'actor@example.com', 'h', 'Act', 'Or', :now, :now)
            """),
            {"uid": temp_actor_id, "now": now},
        )
        # Mark announcement as removed by this actor
        conn.execute(
            text(f"""
                UPDATE {schema}.announcements
                SET removed_at = :now, removed_by_id = :uid
                WHERE id = :aid
            """),
            {"now": now, "uid": temp_actor_id, "aid": ann_id},
        )
        # Insert management event
        conn.execute(
            text(f"""
                INSERT INTO {schema}.management_events (id, community_id, actor_id, action, target_type, target_id, created_at)
                VALUES (:mid, :cid, :aid, 'remove', 'announcement', :tid, :now)
            """),
            {"mid": uuid.uuid4(), "cid": comm_id, "aid": temp_actor_id, "tid": ann_id, "now": now},
        )
        # Delete the actor user
        conn.execute(text(f"DELETE FROM {schema}.users WHERE id = :uid"), {"uid": temp_actor_id})

    with engine.connect() as conn:
        # Check SET NULL on announcement
        ann_row = conn.execute(text(f"SELECT removed_at, removed_by_id FROM {schema}.announcements WHERE id = :aid"), {"aid": ann_id}).mappings().one()
        assert ann_row["removed_at"] is not None
        assert ann_row["removed_by_id"] is None, "removed_by_id was not set to NULL on actor deletion!"

        # Check SET NULL on management_events
        ev_row = conn.execute(text(f"SELECT actor_id FROM {schema}.management_events WHERE target_id = :tid"), {"tid": ann_id}).mappings().one()
        assert ev_row["actor_id"] is None, "management_events actor_id was not set to NULL on actor deletion!"

        # Restore announcement to unremoved state before downgrade
        conn.execute(text(f"UPDATE {schema}.announcements SET removed_at = NULL WHERE id = :aid"), {"aid": ann_id})
        conn.commit()

    # 7. Downgrade only within the disposable migration-test scope back to f8c2b3d4e5f6
    with engine.connect() as conn:
        conn.execute(text(f"SET search_path TO {schema}"))
        context = MigrationContext.configure(conn, opts={"version_table_schema": schema})
        with Operations.context(context):
            rev_a916.module.downgrade()
            context.stamp(script, "f8c2b3d4e5f6")
        conn.commit()

    with engine.connect() as conn:
        # Verify management_events is dropped
        exists = conn.execute(text(f"""
            SELECT 1 FROM information_schema.tables WHERE table_schema = :s AND table_name = 'management_events'
        """), {"s": schema}).scalar()
        assert exists is None, "management_events should have been dropped on downgrade"

        # Verify removed_at and removed_by_id columns are dropped
        for tbl in content_tables:
            cols = [r[0] for r in conn.execute(text(f"""
                SELECT column_name FROM information_schema.columns WHERE table_schema = :s AND table_name = :t
            """), {"s": schema, "t": tbl}).fetchall()]
            assert "removed_at" not in cols, f"removed_at still present in {tbl} after downgrade"
            assert "removed_by_id" not in cols, f"removed_by_id still present in {tbl} after downgrade"

            # Check original content still present
            count = conn.execute(text(f"SELECT count(*) FROM {schema}.{tbl}")).scalar()
            assert count == len(pre_snapshots[tbl])

    # 8. Re-upgrade to a916c0e16b01
    with engine.connect() as conn:
        conn.execute(text(f"SET search_path TO {schema}"))
        context = MigrationContext.configure(conn, opts={"version_table_schema": schema})
        with Operations.context(context):
            rev_a916.module.upgrade()
            context.stamp(script, rev_a916.revision)
        conn.commit()

    # 9. Verify parity with SQLAlchemy metadata
    with engine.connect() as conn:
        conn.execute(text(f"SET search_path TO {schema}"))
        context = MigrationContext.configure(conn, opts={"version_table_schema": schema})
        diff = compare_metadata(context, Base.metadata)
        real_diffs = [
            d for d in diff
            if not (d[0] == "remove_table" and d[1].name == "alembic_version")
            and not (d[0] in ("remove_constraint", "add_index") and getattr(d[1], "name", None) == "uq_management_events_removal_target")
        ]
        assert real_diffs == [], f"Schema parity mismatch: {real_diffs}"
