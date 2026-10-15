"""Atomicity/concurrency and migration checks on explicitly owned fixtures only."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import importlib.util
from io import StringIO
from pathlib import Path
from threading import Barrier
from uuid import uuid4

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import HTTPException
import pytest
from sqlalchemy import MetaData, create_engine, event, inspect, select
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import (Announcement, AnnouncementReply, Community, CommunityPost,
                        CommunityPostReply, DiscussionMessage, ManagementEvent, User)
from app.schemas.announcement import AnnouncementReplyCreate
from app.schemas.community_post import CommunityPostReplyCreate
from app.services.announcement import create_announcement_reply
from app.services.community_post import create_community_post_reply
from app.services.content_removal import remove_content
from app.services.discussion import set_discussion_reaction

KINDS = ("announcement", "announcement_reply", "community_post", "community_post_reply", "discussion_message")


def owned_engine(path):
    assert not path.exists(), "Refuse to reuse an existing database file"
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False, "timeout": 10})
    assert engine.url.get_backend_name() == "sqlite"
    with engine.connect() as connection:
        actual = next(row[2] for row in connection.exec_driver_sql("PRAGMA database_list") if row[1] == "main")
        assert Path(actual).resolve() == path.resolve()
    return engine


@pytest.fixture
def database(tmp_path):
    engine = owned_engine(tmp_path / "moderation-owned.sqlite")
    event.listen(engine, "connect", lambda conn, _: conn.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        users = [User(username=f"actor{i}", email=f"actor{i}@test.invalid", password_hash="fixture",
                      first_name="Fixture", family_name="User") for i in range(4)]
        community = Community(name="Fixture", slug="irm")
        db.add_all([community, *users]); db.flush()
        announcement = Announcement(community_id=community.id, author_id=users[0].id, title="Title", content="Retained")
        post = CommunityPost(community_id=community.id, author_id=users[0].id, title="Title", content="Retained")
        message = DiscussionMessage(community_id=community.id, author_id=users[0].id, kind="TEXT",
                                    content="Retained", client_message_id=uuid4())
        db.add_all([announcement, post, message]); db.flush()
        ar = AnnouncementReply(announcement_id=announcement.id, author_id=users[0].id, content="Retained")
        pr = CommunityPostReply(post_id=post.id, author_id=users[0].id, content="Retained")
        db.add_all([ar, pr]); db.commit()
        targets = dict(zip(KINDS, (announcement.id, ar.id, post.id, pr.id, message.id)))
        yield factory, community.id, [user.id for user in users], targets
    engine.dispose()


@pytest.mark.parametrize("kind", KINDS)
def test_concurrent_removal_one_event_and_original_metadata(database, kind):
    factory, community, actors, targets = database
    barrier = Barrier(4)
    def worker(actor):
        with factory() as db:
            barrier.wait(timeout=5)
            # SQLite has no FOR UPDATE; its write transaction provides the test
            # serialization. Production uses conditional UPDATE + parent locks.
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            parent = targets['announcement' if kind == 'announcement_reply' else 'community_post'] if 'reply' in kind else None
            return actor, remove_content(db, community, actor, kind, targets[kind], parent)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(worker, actors))
    assert sum(first for _, first in results) == 1
    with factory() as db:
        logs = db.query(ManagementEvent).all()
        assert len(logs) == 1
        assert logs[0].actor_id == next(actor for actor, first in results if first)
        assert logs[0].target_id == targets[kind]


@pytest.mark.parametrize("kind", ["announcement", "community_post", "discussion_message"])
def test_mutation_removal_race_never_revives_parent(database, kind):
    factory, community, actors, targets = database
    barrier = Barrier(2)
    def mutation():
        with factory() as db:
            barrier.wait(timeout=5)
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            try:
                if kind == 'announcement':
                    create_announcement_reply(db, 'irm', targets[kind], actors[0], AnnouncementReplyCreate(content='reply'))
                elif kind == 'community_post':
                    create_community_post_reply(db, 'irm', targets[kind], actors[0], CommunityPostReplyCreate(content='reply'))
                else:
                    set_discussion_reaction(db, 'irm', targets[kind], db.get(User, actors[0]), 'heart')
                return 200
            except HTTPException as exc:
                return exc.status_code
    def removal():
        with factory() as db:
            barrier.wait(timeout=5)
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            return remove_content(db, community, actors[1], kind, targets[kind])
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(mutation); removed = pool.submit(removal)
        assert removed.result() is True
        assert pending.result() in (200, 404)
    model = {'announcement': Announcement, 'community_post': CommunityPost, 'discussion_message': DiscussionMessage}[kind]
    with factory() as db:
        assert db.get(model, targets[kind]).removed_at is not None
        assert db.query(ManagementEvent).count() == 1


def migration():
    path = Path(__file__).resolve().parents[2] / 'alembic/versions/a916c0e16b01_add_delegate_content_removal.py'
    spec = importlib.util.spec_from_file_location('removal_revision', path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def test_migration_upgrade_downgrade_reupgrade_preserves_legacy_rows(tmp_path):
    engine = owned_engine(tmp_path / 'migration-owned.sqlite')
    # Reconstruct pre-revision model schema, including all unrelated tables.
    old = MetaData()
    for table in Base.metadata.sorted_tables:
        if table.name == 'management_events': continue
        copy = table.to_metadata(old)
        for name in ('removed_at', 'removed_by_id'):
            if name not in copy.c: continue
            column = copy.c[name]
            for constraint in list(copy.constraints):
                if any(item is column for item in getattr(constraint, 'columns', ())):
                    copy.constraints.remove(constraint)
            copy.foreign_keys.difference_update(column.foreign_keys)
            copy._columns.remove(column)
    old.create_all(engine)
    actor, community, announcement, post, message, ar, pr = [uuid4() for _ in range(7)]
    with engine.begin() as connection:
        connection.execute(old.tables['users'].insert().values(id=actor, username='fixture', email='fixture@test.invalid',
            first_name='Fixture', family_name='User', password_hash='fixture'))
        connection.execute(old.tables['communities'].insert().values(id=community, name='Fixture', slug='irm'))
        for table, identifier in [('announcements', announcement), ('community_posts', post)]:
            connection.execute(old.tables[table].insert().values(id=identifier, community_id=community, author_id=actor,
                title='Retained title', content='Retained content'))
        connection.execute(old.tables['discussion_messages'].insert().values(id=message, community_id=community,
            author_id=actor, kind='TEXT', content='Retained message', client_message_id=uuid4()))
        connection.execute(old.tables['announcement_replies'].insert().values(id=ar, announcement_id=announcement, author_id=actor, content='Retained reply'))
        connection.execute(old.tables['community_post_replies'].insert().values(id=pr, post_id=post, author_id=actor, content='Retained reply'))
        before = {table.name: connection.execute(select(table)).all() for table in old.sorted_tables}
    revision = migration()
    assert revision.down_revision == 'f8c2b3d4e5f6'
    for operation in ('upgrade', 'downgrade', 'upgrade'):
        with engine.begin() as connection:
            actual = next(row[2] for row in connection.exec_driver_sql('PRAGMA database_list') if row[1] == 'main')
            assert Path(actual).resolve() == Path(engine.url.database).resolve()
            context = MigrationContext.configure(connection)
            with Operations.context(context): getattr(revision, operation)()
            for table in old.sorted_tables:
                assert connection.execute(select(table)).all() == before[table.name]
            if operation == 'upgrade':
                assert connection.execute(select(Base.metadata.tables['management_events'])).all() == []
                for table in revision.CONTENT_TABLES:
                    assert connection.exec_driver_sql(f'SELECT removed_at, removed_by_id FROM {table}').one() == (None, None)
                diff = [d for d in compare_metadata(context, Base.metadata) if not (d[0] in ('remove_constraint', 'add_index') and getattr(d[1], 'name', None) == 'uq_management_events_removal_target')]
                assert diff == []
            else:
                assert 'management_events' not in inspect(connection).get_table_names()
    engine.dispose()


def test_revision_postgresql_ddl_and_lock_compilation():
    buffer = StringIO()
    context = MigrationContext.configure(dialect_name='postgresql', opts={'as_sql': True, 'output_buffer': buffer})
    with Operations.context(context): migration().upgrade()
    sql = buffer.getvalue()
    assert 'DELETE FROM' not in sql and 'DROP TABLE' not in sql
    assert sql.count('ADD COLUMN removed_at') == 5 and 'ON DELETE SET NULL' in sql
    assert 'UNIQUE (community_id, action, target_type, target_id)' in sql
    statement = select(DiscussionMessage).where(DiscussionMessage.removed_at.is_(None)).with_for_update(of=DiscussionMessage)
    assert 'FOR UPDATE OF discussion_messages' in str(statement.compile(dialect=context.dialect))
