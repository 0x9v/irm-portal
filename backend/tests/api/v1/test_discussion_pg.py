import threading
import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.models.community import Community
from app.models.discussion_message import DiscussionMessage
from app.models.discussion_reaction import DiscussionReaction
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.user import User
from app.schemas.discussion import DiscussionMessageCreate
from app.services.discussion import create_discussion_message

DB_URL = "postgresql+psycopg://irm_test:irm_test@127.0.0.1:5432/irm_integration_test"
engine = create_engine(DB_URL, pool_size=10, max_overflow=20)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

APPROVED_TEST_DB = "irm_integration_test"
DISALLOWED_DB_NAMES = {"irm", "irm_dev", "irm_prod", "postgres", "template1"}


def verify_test_db_identity(db_name: str) -> None:
    if not db_name or db_name != APPROVED_TEST_DB or db_name.lower() in DISALLOWED_DB_NAMES:
        raise RuntimeError(
            f"SECURITY REFUSAL: Refusing destructive action on database '{db_name}'. "
            f"Must be explicitly '{APPROVED_TEST_DB}'."
        )


@pytest.fixture
def pg_session():
    session = TestingSessionLocal()
    actual_db = session.execute(text("SELECT current_database()")).scalar()
    verify_test_db_identity(actual_db)

    session.execute(text("TRUNCATE TABLE discussion_reactions CASCADE"))
    session.execute(text("TRUNCATE TABLE discussion_messages CASCADE"))
    session.execute(text("TRUNCATE TABLE community_post_replies CASCADE"))
    session.execute(text("TRUNCATE TABLE post_modules CASCADE"))
    session.execute(text("TRUNCATE TABLE community_posts CASCADE"))
    session.execute(text("TRUNCATE TABLE announcement_replies CASCADE"))
    session.execute(text("TRUNCATE TABLE announcements CASCADE"))
    session.execute(text("TRUNCATE TABLE modules CASCADE"))
    session.execute(text("TRUNCATE TABLE memberships CASCADE"))
    session.execute(text("TRUNCATE TABLE communities CASCADE"))
    session.execute(text("TRUNCATE TABLE users CASCADE"))
    session.commit()
    try:
        yield session
    finally:
        session.close()


def test_pg_indexes_and_constraints_exist(pg_session):
    """Verify PostgreSQL contains composite indexes and constraints for discussion tables."""
    rows = pg_session.execute(text("""
        SELECT tablename, indexname, indexdef
        FROM pg_indexes
        WHERE tablename IN ('discussion_messages', 'discussion_reactions');
    """)).fetchall()

    index_map = {f"{row[0]}.{row[1]}": row[2] for row in rows}

    # 1. discussion_messages composite index
    assert "discussion_messages.ix_discussion_messages_community_id_created_at_id" in index_map
    def_msg = index_map["discussion_messages.ix_discussion_messages_community_id_created_at_id"]
    assert "community_id" in def_msg and "created_at" in def_msg and "id" in def_msg

    # 2. discussion_reactions composite index
    assert "discussion_reactions.ix_discussion_reactions_message_id_emoji" in index_map
    def_rx = index_map["discussion_reactions.ix_discussion_reactions_message_id_emoji"]
    assert "message_id" in def_rx and "emoji" in def_rx


def test_pg_concurrent_duplicate_submission(pg_session):
    """
    Test concurrent duplicate submissions with the same (community_id, author_id, client_message_id).
    Ensures transaction recovery handles PostgreSQL UniqueConstraint cleanly.
    """
    u = User(
        id=uuid.uuid4(),
        username="concurrent_user",
        email="concurrent@example.com",
        password_hash="hash",
        first_name="Conc",
        family_name="User",
    )
    c = Community(id=uuid.uuid4(), name="Conc Hub", slug="conc-hub")
    pg_session.add_all([u, c])
    pg_session.commit()

    cid = uuid.uuid4()
    payload = DiscussionMessageCreate(
        client_message_id=cid,
        kind="TEXT",
        content="Concurrent thread message",
    )

    results = []
    errors = []

    def worker():
        session = TestingSessionLocal()
        try:
            author = session.query(User).filter(User.id == u.id).first()
            msg, is_replay = create_discussion_message(
                db=session,
                community_slug=c.slug,
                author=author,
                payload=payload,
            )
            results.append((msg.id, is_replay))
        except Exception as e:
            errors.append(e)
        finally:
            session.close()

    t1 = threading.Thread(target=worker)
    t2 = threading.Thread(target=worker)

    t1.start()
    t2.start()

    t1.join()
    t2.join()

    # No unhandled exceptions
    assert len(errors) == 0, f"Errors occurred: {errors}"
    assert len(results) == 2

    # Exactly one was initial create, and one was replay
    replays = [r[1] for r in results]
    assert True in replays
    assert False in replays

    # Both returned the exact same persisted message ID
    assert results[0][0] == results[1][0]

    # Verify database contains exactly 1 message
    total = (
        pg_session.query(DiscussionMessage)
        .filter(DiscussionMessage.client_message_id == cid)
        .count()
    )
    assert total == 1


def test_pg_cascading_deletes(pg_session):
    """Verify deleting community or message cascades properly in PostgreSQL."""
    u = User(
        id=uuid.uuid4(),
        username="cascade_user",
        email="cascade@example.com",
        password_hash="hash",
        first_name="Casc",
        family_name="User",
    )
    c = Community(id=uuid.uuid4(), name="Cascade Hub", slug="cascade-hub")
    pg_session.add_all([u, c])
    pg_session.commit()

    # Create message
    msg = DiscussionMessage(
        id=uuid.uuid4(),
        community_id=c.id,
        author_id=u.id,
        kind="TEXT",
        content="Cascading target",
        client_message_id=uuid.uuid4(),
    )
    pg_session.add(msg)
    pg_session.commit()

    # Add reaction
    rx = DiscussionReaction(
        id=uuid.uuid4(),
        message_id=msg.id,
        user_id=u.id,
        emoji="thumbs_up",
    )
    pg_session.add(rx)
    pg_session.commit()

    assert pg_session.query(DiscussionReaction).count() == 1
    assert pg_session.query(DiscussionMessage).count() == 1

    # Delete message -> cascades to reactions
    pg_session.delete(msg)
    pg_session.commit()

    assert pg_session.query(DiscussionReaction).count() == 0
    assert pg_session.query(DiscussionMessage).count() == 0


def test_pg_database_check_constraint_rejects_empty_and_whitespace_content(pg_session):
    """
    Verify PostgreSQL database check constraint ck_discussion_messages_kind_fields
    strictly rejects empty and whitespace-only text content at the database level.
    """
    u = User(
        id=uuid.uuid4(),
        username="db_constraint_user",
        email="db_constraint@example.com",
        password_hash="hash",
        first_name="Db",
        family_name="Constraint",
    )
    c = Community(id=uuid.uuid4(), name="Constraint Hub", slug="constraint-hub")
    pg_session.add_all([u, c])
    pg_session.commit()

    # 1. Empty string content fails check constraint
    msg_empty = DiscussionMessage(
        id=uuid.uuid4(),
        community_id=c.id,
        author_id=u.id,
        kind="TEXT",
        content="",
        client_message_id=uuid.uuid4(),
    )
    pg_session.add(msg_empty)
    with pytest.raises(Exception) as exc_info:
        pg_session.commit()
    assert "ck_discussion_messages_kind_fields" in str(exc_info.value)
    pg_session.rollback()

    # 2. Whitespace-only string fails check constraint
    msg_whitespace = DiscussionMessage(
        id=uuid.uuid4(),
        community_id=c.id,
        author_id=u.id,
        kind="TEXT",
        content="   \n\t  ",
        client_message_id=uuid.uuid4(),
    )
    pg_session.add(msg_whitespace)
    with pytest.raises(Exception) as exc_info:
        pg_session.commit()
    assert "ck_discussion_messages_kind_fields" in str(exc_info.value)
    pg_session.rollback()

    # 3. Valid non-empty text content succeeds
    msg_valid = DiscussionMessage(
        id=uuid.uuid4(),
        community_id=c.id,
        author_id=u.id,
        kind="TEXT",
        content="Valid content with\ninternal newlines",
        client_message_id=uuid.uuid4(),
    )
    pg_session.add(msg_valid)
    pg_session.commit()
    assert pg_session.query(DiscussionMessage).count() == 1


def test_pg_concurrent_commit_gap_demonstration_and_recovery(pg_session):
    """
    Demonstrates the concurrent-commit recovery gap against PostgreSQL:
    - Session A creates Message A at T1, but delays commit.
    - Session B creates and commits Message B at T2 (T2 > T1).
    - Client reads Message B, advances cursor to B.id.
    - Session A commits Message A.
    - Catch-up query `after=B.id` permanently misses Message A because A.created_at < B.created_at.
    - Demonstrates recovery via full resynchronization (retrieving the active viewport without cursors).
    """
    from datetime import timedelta
    from app.services.discussion import list_discussion_messages

    u1 = User(
        id=uuid.uuid4(),
        username="gap_user1",
        email="gap1@example.com",
        password_hash="hash",
        first_name="Gap",
        family_name="One",
    )
    u2 = User(
        id=uuid.uuid4(),
        username="gap_user2",
        email="gap2@example.com",
        password_hash="hash",
        first_name="Gap",
        family_name="Two",
    )
    c = Community(id=uuid.uuid4(), name="Gap Hub", slug="gap-hub")
    pg_session.add_all([u1, u2, c])
    pg_session.commit()

    session_a = TestingSessionLocal()
    session_b = TestingSessionLocal()
    reader_session = TestingSessionLocal()

    try:
        t1 = datetime(2026, 10, 7, 12, 0, 0, tzinfo=timezone.utc)
        t2 = t1 + timedelta(seconds=2)

        # 1. Session A inserts Message A with timestamp T1, but does NOT commit yet
        msg_a = DiscussionMessage(
            id=uuid.uuid4(),
            community_id=c.id,
            author_id=u1.id,
            kind="TEXT",
            content="Message A (T1 - delayed commit)",
            client_message_id=uuid.uuid4(),
            created_at=t1,
        )
        session_a.add(msg_a)
        session_a.flush()

        # 2. Session B inserts Message B with timestamp T2 and commits immediately
        msg_b = DiscussionMessage(
            id=uuid.uuid4(),
            community_id=c.id,
            author_id=u2.id,
            kind="TEXT",
            content="Message B (T2 - fast commit)",
            client_message_id=uuid.uuid4(),
            created_at=t2,
        )
        session_b.add(msg_b)
        session_b.commit()

        # 3. Client reads latest history before Session A commits
        history_1 = list_discussion_messages(
            db=reader_session,
            community_slug=c.slug,
            caller_user_id=u1.id,
            limit=30,
        )
        # Only Message B is visible
        assert len(history_1.items) == 1
        assert history_1.items[0].id == msg_b.id

        # Client advances after cursor to Message B
        last_seen_cursor = msg_b.id

        # 4. Now Session A finishes and commits Message A
        session_a.commit()

        # 5. Client attempts incremental catch-up with `after=last_seen_cursor`
        catchup_history = list_discussion_messages(
            db=reader_session,
            community_slug=c.slug,
            caller_user_id=u1.id,
            limit=30,
            after=last_seen_cursor,
        )

        # Catch-up MISSES Message A because A.created_at (T1) < B.created_at (T2)
        assert len(catchup_history.items) == 0, "Demonstration: after cursor catch-up missed Message A!"

        # 6. RECOVERY PATH: Full resynchronization of the active viewport (no cursor)
        full_sync_history = list_discussion_messages(
            db=reader_session,
            community_slug=c.slug,
            caller_user_id=u1.id,
            limit=30,
        )
        # Both Message A and Message B are retrieved in chronological order
        assert len(full_sync_history.items) == 2
        assert full_sync_history.items[0].id == msg_a.id
        assert full_sync_history.items[1].id == msg_b.id
        assert full_sync_history.items[0].content == "Message A (T1 - delayed commit)"
        assert full_sync_history.items[1].content == "Message B (T2 - fast commit)"
    finally:
        session_a.close()
        session_b.close()
        reader_session.close()


def test_pg_history_pagination_75_messages_with_limit_30(pg_session):
    """
    Exercise three history pages across >= 75 real PostgreSQL messages with limit=30.
    Includes:
    - Equal timestamps with distinct UUIDs (deterministic tie-breaking).
    - Long multiline messages.
    - Stickers.
    - Messages with reactions.
    Verifies:
    1. Initial page contains the latest 30 records in chronological display order.
    2. Older pagination retrieves the preceding page of 30 records.
    3. Final partial page contains the remaining 15 records.
    4. All 75 records appear exactly once without duplicates or omissions.
    5. Cursor boundaries neither duplicate nor skip records.
    6. Both cursors together return controlled 400 error.
    7. Foreign or non-existent cursor returns controlled 404 error.
    """
    from datetime import datetime, timezone, timedelta
    from app.services.discussion import list_discussion_messages
    from fastapi import HTTPException

    u = User(
        id=uuid.uuid4(),
        username="pg_paging_user",
        email="pg_paging@example.com",
        password_hash="hash",
        first_name="Pg",
        family_name="User",
    )
    c = Community(id=uuid.uuid4(), name="Paging Hub", slug="paging-hub")
    pg_session.add_all([u, c])
    pg_session.commit()

    base_time = datetime(2026, 10, 1, 10, 0, 0, tzinfo=timezone.utc)
    messages: list[DiscussionMessage] = []

    # Insert 75 messages chronologically
    for i in range(75):
        msg_id = uuid.uuid4()
        client_id = uuid.uuid4()

        # Messages 20..24 share the exact same timestamp to test UUID tie-breaking
        if 20 <= i <= 24:
            created_at = base_time + timedelta(minutes=20)
        else:
            created_at = base_time + timedelta(minutes=i)

        if i % 5 == 0:
            # Sticker message
            m = DiscussionMessage(
                id=msg_id,
                community_id=c.id,
                author_id=u.id,
                kind="STICKER",
                content=None,
                sticker_id="pepe_thumbs_up",
                client_message_id=client_id,
                created_at=created_at,
            )
        elif i % 3 == 0:
            # Long multiline message
            m = DiscussionMessage(
                id=msg_id,
                community_id=c.id,
                author_id=u.id,
                kind="TEXT",
                content=f"Message {i}\nMultiline content line 2\nMultiline content line 3 with details",
                sticker_id=None,
                client_message_id=client_id,
                created_at=created_at,
            )
        else:
            # Standard text message
            m = DiscussionMessage(
                id=msg_id,
                community_id=c.id,
                author_id=u.id,
                kind="TEXT",
                content=f"Message {i} content text",
                sticker_id=None,
                client_message_id=client_id,
                created_at=created_at,
            )
        messages.append(m)

    pg_session.add_all(messages)
    pg_session.commit()

    # Add reactions to 20 messages
    reactions: list[DiscussionReaction] = []
    for m in messages[:20]:
        reactions.append(
            DiscussionReaction(
                id=uuid.uuid4(),
                message_id=m.id,
                user_id=u.id,
                emoji="thumbs_up",
            )
        )
    pg_session.add_all(reactions)
    pg_session.commit()

    # 1. Initial Page (latest 30 records)
    page1 = list_discussion_messages(
        db=pg_session,
        community_slug=c.slug,
        caller_user_id=u.id,
        limit=30,
    )
    assert len(page1.items) == 30
    assert page1.has_more_older is True
    assert page1.older_cursor is not None

    # Verify chronological display order in Page 1 (oldest to newest)
    for k in range(len(page1.items) - 1):
        item_a = page1.items[k]
        item_b = page1.items[k + 1]
        assert (item_a.created_at, str(item_a.id).lower()) < (item_b.created_at, str(item_b.id).lower())

    # 2. Second Page (preceding 30 records before page1.older_cursor)
    page2 = list_discussion_messages(
        db=pg_session,
        community_slug=c.slug,
        caller_user_id=u.id,
        limit=30,
        before=page1.older_cursor,
    )
    assert len(page2.items) == 30
    assert page2.has_more_older is True
    assert page2.older_cursor is not None

    # Verify boundary: Page 2 newest item is strictly older than Page 1 oldest item
    assert (page2.items[-1].created_at, str(page2.items[-1].id).lower()) < (page1.items[0].created_at, str(page1.items[0].id).lower())

    # 3. Third Page (final remaining 15 records)
    page3 = list_discussion_messages(
        db=pg_session,
        community_slug=c.slug,
        caller_user_id=u.id,
        limit=30,
        before=page2.older_cursor,
    )
    assert len(page3.items) == 15
    assert page3.has_more_older is False
    assert page3.older_cursor is None

    # Verify all 75 records appear exactly once without duplicates
    all_retrieved_ids = [m.id for m in page3.items] + [m.id for m in page2.items] + [m.id for m in page1.items]
    assert len(all_retrieved_ids) == 75
    assert len(set(all_retrieved_ids)) == 75
    assert set(all_retrieved_ids) == {m.id for m in messages}

    # Verify equal-timestamp messages (messages 20..24) are strictly ordered by UUID asc
    equal_ts_items = [m for m in (page3.items + page2.items + page1.items) if m.created_at == base_time + timedelta(minutes=20)]
    assert len(equal_ts_items) == 5
    for idx in range(len(equal_ts_items) - 1):
        assert str(equal_ts_items[idx].id).lower() < str(equal_ts_items[idx + 1].id).lower()

    # 4. Error boundaries: both cursors together -> 400
    with pytest.raises(HTTPException) as exc_400:
        list_discussion_messages(
            db=pg_session,
            community_slug=c.slug,
            caller_user_id=u.id,
            limit=30,
            before=page1.older_cursor,
            after=page2.items[0].id,
        )
    assert exc_400.value.status_code == 400

    # 5. Non-existent cursor -> 404
    with pytest.raises(HTTPException) as exc_404:
        list_discussion_messages(
            db=pg_session,
            community_slug=c.slug,
            caller_user_id=u.id,
            limit=30,
            before=uuid.uuid4(),
        )
    assert exc_404.value.status_code == 404
