import uuid
from datetime import datetime, timezone, timedelta
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.models.community import Community
from app.models.user import User
from app.models.announcement import Announcement
from app.models.announcement_reply import AnnouncementReply
from app.services.announcement import list_announcement_replies

DB_URL = "postgresql+psycopg://irm_test:irm_test@127.0.0.1:5432/irm_integration_test"
engine = create_engine(DB_URL)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture
def pg_session():
    session = TestingSessionLocal()
    session.execute(text("TRUNCATE TABLE announcement_replies CASCADE"))
    session.execute(text("TRUNCATE TABLE announcements CASCADE"))
    session.execute(text("TRUNCATE TABLE memberships CASCADE"))
    session.execute(text("TRUNCATE TABLE communities CASCADE"))
    session.execute(text("TRUNCATE TABLE users CASCADE"))
    session.commit()
    try:
        yield session
    finally:
        session.close()


def test_pg_announcement_reply_composite_index_exists(pg_session):
    """
    Verify PostgreSQL contains the required composite index on (announcement_id, created_at, id)
    as well as foreign-key indexes.
    """
    rows = pg_session.execute(text("""
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'announcement_replies';
    """)).fetchall()

    index_map = {row[0]: row[1] for row in rows}

    # Verify composite index
    assert "ix_announcement_replies_announcement_id_created_at_id" in index_map
    composite_def = index_map["ix_announcement_replies_announcement_id_created_at_id"]
    assert "announcement_id" in composite_def
    assert "created_at" in composite_def
    assert "id" in composite_def

    # Verify foreign key indexes
    assert "ix_announcement_replies_announcement_id" in index_map
    assert "ix_announcement_replies_author_id" in index_map


def test_pg_announcement_reply_cascades_on_announcement_deletion(pg_session):
    """
    Verify PostgreSQL foreign key CASCADE on announcement deletion:
    Deleting an announcement must automatically cascade and remove all its replies.
    """
    user = User(
        id=uuid.uuid4(),
        username="pg_author",
        email="pg_author@example.com",
        password_hash="fake",
        first_name="PG",
        family_name="Author",
    )
    community = Community(id=uuid.uuid4(), name="PG IRM", slug="pg-irm")
    pg_session.add_all([user, community])
    pg_session.commit()

    announcement = Announcement(
        id=uuid.uuid4(),
        community_id=community.id,
        author_id=user.id,
        title="PG Notice",
        content="Notice content",
    )
    pg_session.add(announcement)
    pg_session.commit()

    reply1 = AnnouncementReply(
        id=uuid.uuid4(),
        announcement_id=announcement.id,
        author_id=user.id,
        content="Reply 1",
    )
    reply2 = AnnouncementReply(
        id=uuid.uuid4(),
        announcement_id=announcement.id,
        author_id=user.id,
        content="Reply 2",
    )
    pg_session.add_all([reply1, reply2])
    pg_session.commit()

    # Verify replies exist
    assert pg_session.query(AnnouncementReply).filter(AnnouncementReply.announcement_id == announcement.id).count() == 2

    # Delete the owning announcement directly in PostgreSQL
    pg_session.delete(announcement)
    pg_session.commit()

    # Verify CASCADE: replies should now be 0
    assert pg_session.query(AnnouncementReply).filter(AnnouncementReply.announcement_id == announcement.id).count() == 0


def test_pg_announcement_reply_cascades_on_user_deletion(pg_session):
    """
    Verify PostgreSQL foreign key CASCADE on user (author) deletion:
    Consistent with project convention for user deletion.
    """
    user = User(
        id=uuid.uuid4(),
        username="pg_reply_author",
        email="pg_reply_author@example.com",
        password_hash="fake",
        first_name="Reply",
        family_name="Author",
    )
    community = Community(id=uuid.uuid4(), name="PG IRM 2", slug="pg-irm-2")
    pg_session.add_all([user, community])
    pg_session.commit()

    announcement = Announcement(
        id=uuid.uuid4(),
        community_id=community.id,
        author_id=user.id,
        title="PG Notice 2",
        content="Notice content 2",
    )
    pg_session.add(announcement)
    pg_session.commit()

    reply = AnnouncementReply(
        id=uuid.uuid4(),
        announcement_id=announcement.id,
        author_id=user.id,
        content="User will be deleted",
    )
    pg_session.add(reply)
    pg_session.commit()

    assert pg_session.query(AnnouncementReply).filter(AnnouncementReply.id == reply.id).count() == 1

    reply_id = reply.id
    # Delete the user
    pg_session.delete(user)
    pg_session.commit()

    # Verify reply cascaded
    assert pg_session.query(AnnouncementReply).filter(AnnouncementReply.id == reply_id).count() == 0


def test_pg_cursor_pagination_execution(pg_session):
    """
    Verify PostgreSQL executes the cursor pagination queries and lexicographic filtering properly.
    """
    user = User(
        id=uuid.uuid4(),
        username="pg_pag_user",
        email="pg_pag@example.com",
        password_hash="fake",
        first_name="Pag",
        family_name="User",
    )
    community = Community(id=uuid.uuid4(), name="PG Pag Comm", slug="pg-pag-comm")
    pg_session.add_all([user, community])
    pg_session.commit()

    announcement = Announcement(
        id=uuid.uuid4(),
        community_id=community.id,
        author_id=user.id,
        title="Pagination Notice",
        content="Pagination Content",
    )
    pg_session.add(announcement)
    pg_session.commit()

    base_time = datetime(2026, 10, 5, 12, 0, 0, tzinfo=timezone.utc)
    for i in range(5):
        r = AnnouncementReply(
            id=uuid.uuid4(),
            announcement_id=announcement.id,
            author_id=user.id,
            content=f"PG Reply {i + 1}",
            created_at=base_time + timedelta(seconds=i),
        )
        pg_session.add(r)
    pg_session.commit()

    # Page 1: limit 2
    items_p1, cursor_1 = list_announcement_replies(
        pg_session, community.slug, announcement.id, limit=2, after=None
    )
    assert len(items_p1) == 2
    assert items_p1[0].content == "PG Reply 1"
    assert items_p1[1].content == "PG Reply 2"
    assert cursor_1 == items_p1[1].id

    # Page 2: limit 2, after cursor 1
    items_p2, cursor_2 = list_announcement_replies(
        pg_session, community.slug, announcement.id, limit=2, after=cursor_1
    )
    assert len(items_p2) == 2
    assert items_p2[0].content == "PG Reply 3"
    assert items_p2[1].content == "PG Reply 4"
    assert cursor_2 == items_p2[1].id

    # Page 3: limit 2, after cursor 2
    items_p3, cursor_3 = list_announcement_replies(
        pg_session, community.slug, announcement.id, limit=2, after=cursor_2
    )
    assert len(items_p3) == 1
    assert items_p3[0].content == "PG Reply 5"
    assert cursor_3 is None


def test_pg_equal_timestamps_deterministic_tiebreaking(pg_session):
    """
    Verify PostgreSQL deterministically orders replies with identical created_at
    by ascending id, and cursor pagination smoothly paginates across identical timestamps.
    """
    user = User(
        id=uuid.uuid4(),
        username="pg_tiebreak_user",
        email="pg_tiebreak@example.com",
        password_hash="fake",
        first_name="Tie",
        family_name="Break",
    )
    community = Community(id=uuid.uuid4(), name="PG Tiebreak Comm", slug="pg-tiebreak-comm")
    pg_session.add_all([user, community])
    pg_session.commit()

    announcement = Announcement(
        id=uuid.uuid4(),
        community_id=community.id,
        author_id=user.id,
        title="Tiebreak Notice",
        content="Tiebreak Content",
    )
    pg_session.add(announcement)
    pg_session.commit()

    same_time = datetime(2026, 10, 5, 14, 0, 0, tzinfo=timezone.utc)
    id_1 = uuid.UUID("11111111-1111-1111-1111-111111111111")
    id_2 = uuid.UUID("22222222-2222-2222-2222-222222222222")
    id_3 = uuid.UUID("33333333-3333-3333-3333-333333333333")
    id_4 = uuid.UUID("44444444-4444-4444-4444-444444444444")

    # Insert out of order
    for uid, content in [
        (id_3, "Reply 3"),
        (id_1, "Reply 1"),
        (id_4, "Reply 4"),
        (id_2, "Reply 2"),
    ]:
        pg_session.add(
            AnnouncementReply(
                id=uid,
                announcement_id=announcement.id,
                author_id=user.id,
                content=content,
                created_at=same_time,
            )
        )
    pg_session.commit()

    # Page 1: limit 2
    items_p1, cursor_1 = list_announcement_replies(
        pg_session, community.slug, announcement.id, limit=2, after=None
    )
    assert len(items_p1) == 2
    assert items_p1[0].id == id_1
    assert items_p1[0].content == "Reply 1"
    assert items_p1[1].id == id_2
    assert items_p1[1].content == "Reply 2"
    assert cursor_1 == id_2

    # Page 2: limit 2, after cursor_1
    items_p2, cursor_2 = list_announcement_replies(
        pg_session, community.slug, announcement.id, limit=2, after=cursor_1
    )
    assert len(items_p2) == 2
    assert items_p2[0].id == id_3
    assert items_p2[0].content == "Reply 3"
    assert items_p2[1].id == id_4
    assert items_p2[1].content == "Reply 4"
    assert cursor_2 is None

