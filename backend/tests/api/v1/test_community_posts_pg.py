import uuid
from datetime import datetime, timezone, timedelta
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.models.community import Community
from app.models.user import User
from app.models.module import Module
from app.models.community_post import CommunityPost, PostModule
from app.models.community_post_reply import CommunityPostReply
from app.services.community_post import (
    list_community_posts,
    list_community_post_replies,
)

DB_URL = "postgresql+psycopg://irm_test:irm_test@127.0.0.1:5432/irm_integration_test"
engine = create_engine(DB_URL)
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


def test_database_guard_refuses_unsafe_database_names():
    # Safely simulate refusal without connecting to production or printing credentials
    with pytest.raises(RuntimeError, match="SECURITY REFUSAL"):
        verify_test_db_identity("irm")
    with pytest.raises(RuntimeError, match="SECURITY REFUSAL"):
        verify_test_db_identity("irm_dev")
    with pytest.raises(RuntimeError, match="SECURITY REFUSAL"):
        verify_test_db_identity("irm_prod")
    with pytest.raises(RuntimeError, match="SECURITY REFUSAL"):
        verify_test_db_identity("postgres")
    with pytest.raises(RuntimeError, match="SECURITY REFUSAL"):
        verify_test_db_identity("some_test_db")
    with pytest.raises(RuntimeError, match="SECURITY REFUSAL"):
        verify_test_db_identity("")

    # Explicitly approved test database passes
    verify_test_db_identity("irm_integration_test")


def test_pg_indexes_and_foreign_keys_exist(pg_session):
    """
    Verify PostgreSQL contains the required composite indexes:
    - community_posts: (community_id, created_at, id)
    - post_modules: module_id (and primary key on post_id, module_id)
    - community_post_replies: (post_id, created_at, id)
    """
    rows = pg_session.execute(text("""
        SELECT tablename, indexname, indexdef
        FROM pg_indexes
        WHERE tablename IN ('community_posts', 'post_modules', 'community_post_replies');
    """)).fetchall()

    index_map = {f"{row[0]}.{row[1]}": row[2] for row in rows}

    # 1. community_posts
    assert "community_posts.ix_community_posts_community_id_created_at_id" in index_map
    def_posts = index_map["community_posts.ix_community_posts_community_id_created_at_id"]
    assert "community_id" in def_posts and "created_at" in def_posts and "id" in def_posts
    assert "community_posts.ix_community_posts_community_id" in index_map
    assert "community_posts.ix_community_posts_author_id" in index_map

    # 2. post_modules
    assert "post_modules.ix_post_modules_module_id" in index_map
    assert "post_modules.post_modules_pkey" in index_map

    # 3. community_post_replies
    assert "community_post_replies.ix_community_post_replies_post_id_created_at_id" in index_map
    def_replies = index_map["community_post_replies.ix_community_post_replies_post_id_created_at_id"]
    assert "post_id" in def_replies and "created_at" in def_replies and "id" in def_replies
    assert "community_post_replies.ix_community_post_replies_post_id" in index_map
    assert "community_post_replies.ix_community_post_replies_author_id" in index_map


def test_pg_cascades_on_post_deletion(pg_session):
    """
    Verify PostgreSQL foreign key CASCADE on post deletion:
    Deleting a post must automatically cascade and remove its tags in post_modules
    and its replies in community_post_replies.
    """
    user = User(
        id=uuid.uuid4(),
        username="pg_post_author",
        email="pg_post_author@example.com",
        password_hash="fake",
        first_name="PG",
        family_name="Author",
    )
    community = Community(id=uuid.uuid4(), name="PG Comm", slug="pg-comm")
    module = Module(id=uuid.uuid4(), community_id=community.id, name="PG Module", slug="pg-module")
    pg_session.add_all([user, community, module])
    pg_session.commit()

    post = CommunityPost(
        id=uuid.uuid4(),
        community_id=community.id,
        author_id=user.id,
        title="Cascade Post",
        content="Cascade Content",
    )
    post.modules = [module]
    pg_session.add(post)
    pg_session.commit()

    reply = CommunityPostReply(
        id=uuid.uuid4(),
        post_id=post.id,
        author_id=user.id,
        content="Cascade Reply",
    )
    pg_session.add(reply)
    pg_session.commit()

    # Verify initial existence in DB
    assert pg_session.query(CommunityPost).filter(CommunityPost.id == post.id).count() == 1
    assert pg_session.query(PostModule).filter(PostModule.post_id == post.id).count() == 1
    assert pg_session.query(CommunityPostReply).filter(CommunityPostReply.post_id == post.id).count() == 1

    # Delete the owning post
    pg_session.delete(post)
    pg_session.commit()

    # Both tag and reply should be cascaded to 0
    assert pg_session.query(PostModule).filter(PostModule.post_id == post.id).count() == 0
    assert pg_session.query(CommunityPostReply).filter(CommunityPostReply.post_id == post.id).count() == 0
    # Module itself should still exist
    assert pg_session.query(Module).filter(Module.id == module.id).count() == 1


def test_pg_cascades_on_user_deletion(pg_session):
    """
    Verify PostgreSQL foreign key CASCADE on author (user) deletion:
    Deleting the author automatically deletes their posts and replies.
    """
    user = User(
        id=uuid.uuid4(),
        username="pg_del_user",
        email="pg_del_user@example.com",
        password_hash="fake",
        first_name="Del",
        family_name="User",
    )
    community = Community(id=uuid.uuid4(), name="PG Comm 2", slug="pg-comm-2")
    pg_session.add_all([user, community])
    pg_session.commit()

    post = CommunityPost(
        id=uuid.uuid4(),
        community_id=community.id,
        author_id=user.id,
        title="User Cascade Post",
        content="Content",
    )
    pg_session.add(post)
    pg_session.commit()

    reply = CommunityPostReply(
        id=uuid.uuid4(),
        post_id=post.id,
        author_id=user.id,
        content="User Cascade Reply",
    )
    pg_session.add(reply)
    pg_session.commit()

    post_id = post.id
    reply_id = reply.id

    pg_session.delete(user)
    pg_session.commit()

    assert pg_session.query(CommunityPost).filter(CommunityPost.id == post_id).count() == 0
    assert pg_session.query(CommunityPostReply).filter(CommunityPostReply.id == reply_id).count() == 0


def test_pg_cascades_on_module_deletion(pg_session):
    """
    Verify PostgreSQL foreign key CASCADE on module deletion:
    Deleting a module automatically removes its post_modules associations,
    while leaving the post itself intact.
    """
    user = User(
        id=uuid.uuid4(),
        username="pg_mod_user",
        email="pg_mod_user@example.com",
        password_hash="fake",
        first_name="Mod",
        family_name="User",
    )
    community = Community(id=uuid.uuid4(), name="PG Comm 3", slug="pg-comm-3")
    module = Module(id=uuid.uuid4(), community_id=community.id, name="Temp Module", slug="temp-mod")
    pg_session.add_all([user, community, module])
    pg_session.commit()

    post = CommunityPost(
        id=uuid.uuid4(),
        community_id=community.id,
        author_id=user.id,
        title="Post With Module",
        content="Content",
    )
    post.modules = [module]
    pg_session.add(post)
    pg_session.commit()

    assert pg_session.query(PostModule).filter(PostModule.module_id == module.id).count() == 1

    # Delete the module
    pg_session.delete(module)
    pg_session.commit()

    # post_modules entry cascaded
    assert pg_session.query(PostModule).filter(PostModule.module_id == module.id).count() == 0
    # Post itself remains
    assert pg_session.query(CommunityPost).filter(CommunityPost.id == post.id).count() == 1


def test_pg_equal_timestamps_deterministic_tiebreaking_feed(pg_session):
    """
    Verify PostgreSQL deterministically orders posts with identical created_at
    by descending id (created_at.desc(), id.desc()), and cursor pagination smoothly
    paginates across identical timestamps.
    """
    user = User(
        id=uuid.uuid4(),
        username="pg_feed_tie_user",
        email="pg_feed_tie@example.com",
        password_hash="fake",
        first_name="Tie",
        family_name="User",
    )
    community = Community(id=uuid.uuid4(), name="PG Tie Comm", slug="pg-tie-comm")
    pg_session.add_all([user, community])
    pg_session.commit()

    same_time = datetime(2026, 10, 6, 14, 0, 0, tzinfo=timezone.utc)
    id_1 = uuid.UUID("11111111-1111-1111-1111-111111111111")
    id_2 = uuid.UUID("22222222-2222-2222-2222-222222222222")
    id_3 = uuid.UUID("33333333-3333-3333-3333-333333333333")
    id_4 = uuid.UUID("44444444-4444-4444-4444-444444444444")

    # Insert out of order
    for uid, title in [
        (id_2, "Post 2"),
        (id_4, "Post 4"),
        (id_1, "Post 1"),
        (id_3, "Post 3"),
    ]:
        pg_session.add(
            CommunityPost(
                id=uid,
                community_id=community.id,
                author_id=user.id,
                title=title,
                content="Content",
                created_at=same_time,
            )
        )
    pg_session.commit()

    # Descending order: id_4, id_3, id_2, id_1
    # Page 1: limit 2
    items_p1, cursor_1 = list_community_posts(
        pg_session, community.slug, limit=2, after=None
    )
    assert len(items_p1) == 2
    assert items_p1[0].id == id_4
    assert items_p1[1].id == id_3
    assert cursor_1 == id_3

    # Page 2: limit 2, after cursor_1
    items_p2, cursor_2 = list_community_posts(
        pg_session, community.slug, limit=2, after=cursor_1
    )
    assert len(items_p2) == 2
    assert items_p2[0].id == id_2
    assert items_p2[1].id == id_1
    assert cursor_2 is None


def test_pg_equal_timestamps_deterministic_tiebreaking_replies(pg_session):
    """
    Verify PostgreSQL deterministically orders replies with identical created_at
    by ascending id (created_at.asc(), id.asc()), and cursor pagination smoothly
    paginates across identical timestamps.
    """
    user = User(
        id=uuid.uuid4(),
        username="pg_rep_tie_user",
        email="pg_rep_tie@example.com",
        password_hash="fake",
        first_name="Tie",
        family_name="Rep",
    )
    community = Community(id=uuid.uuid4(), name="PG Rep Comm", slug="pg-rep-comm")
    pg_session.add_all([user, community])
    pg_session.commit()

    post = CommunityPost(
        id=uuid.uuid4(),
        community_id=community.id,
        author_id=user.id,
        title="Post For Reply Tiebreak",
        content="Content",
    )
    pg_session.add(post)
    pg_session.commit()

    same_time = datetime(2026, 10, 6, 15, 0, 0, tzinfo=timezone.utc)
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
            CommunityPostReply(
                id=uid,
                post_id=post.id,
                author_id=user.id,
                content=content,
                created_at=same_time,
            )
        )
    pg_session.commit()

    # Ascending order: id_1, id_2, id_3, id_4
    # Page 1: limit 2
    items_p1, cursor_1 = list_community_post_replies(
        pg_session, community.slug, post.id, limit=2, after=None
    )
    assert len(items_p1) == 2
    assert items_p1[0].id == id_1
    assert items_p1[1].id == id_2
    assert cursor_1 == id_2

    # Page 2: limit 2, after cursor_1
    items_p2, cursor_2 = list_community_post_replies(
        pg_session, community.slug, post.id, limit=2, after=cursor_1
    )
    assert len(items_p2) == 2
    assert items_p2[0].id == id_3
    assert items_p2[1].id == id_4
    assert cursor_2 is None


def test_pg_no_row_multiplication_with_module_filtering(pg_session):
    """
    Verify in PostgreSQL that a post tagged with multiple modules
    never multiplies rows in the result set when querying filtered or unfiltered feeds.
    """
    user = User(
        id=uuid.uuid4(),
        username="pg_multi_tag_user",
        email="pg_multitag@example.com",
        password_hash="fake",
        first_name="Multi",
        family_name="Tag",
    )
    community = Community(id=uuid.uuid4(), name="PG Multi Comm", slug="pg-multi-comm")
    m1 = Module(id=uuid.uuid4(), community_id=community.id, name="Mod A", slug="mod-a")
    m2 = Module(id=uuid.uuid4(), community_id=community.id, name="Mod B", slug="mod-b")
    m3 = Module(id=uuid.uuid4(), community_id=community.id, name="Mod C", slug="mod-c")
    pg_session.add_all([user, community, m1, m2, m3])
    pg_session.commit()

    # Post tagged with 3 modules
    post = CommunityPost(
        id=uuid.uuid4(),
        community_id=community.id,
        author_id=user.id,
        title="Multi-Tag Post",
        content="Content",
    )
    post.modules = [m1, m2, m3]
    pg_session.add(post)
    pg_session.commit()

    # 1. Unfiltered feed
    unfiltered, _ = list_community_posts(pg_session, community.slug, limit=20)
    assert len(unfiltered) == 1
    assert unfiltered[0].id == post.id
    assert len(unfiltered[0].modules) == 3

    # 2. Filtered by m1
    filtered_m1, _ = list_community_posts(pg_session, community.slug, limit=20, module_id=m1.id)
    assert len(filtered_m1) == 1
    assert filtered_m1[0].id == post.id

    # 3. Filtered by m2
    filtered_m2, _ = list_community_posts(pg_session, community.slug, limit=20, module_id=m2.id)
    assert len(filtered_m2) == 1
    assert filtered_m2[0].id == post.id
