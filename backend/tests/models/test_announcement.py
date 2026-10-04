import pytest
from sqlalchemy.exc import IntegrityError
from app.models.community import Community
from app.models.announcement import Announcement
from app.models.user import User
from app.database import Base
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

@pytest.fixture(scope="module")
def engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)

@pytest.fixture
def db_session(engine):
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()

def _create_user(db, username):
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash="hash",
        first_name="First",
        family_name="Last"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

def _create_community(db, slug):
    community = Community(
        name=f"Community {slug}",
        slug=slug
    )
    db.add(community)
    db.commit()
    db.refresh(community)
    return community

def test_announcement_creation(db_session):
    user = _create_user(db_session, "author1")
    community = _create_community(db_session, "c1")
    
    # 1. An Announcement can be associated with a Community.
    # 2. An Announcement can be associated with a User.
    # 5. title is stored correctly.
    # 6. content is stored correctly.
    ann = Announcement(
        community_id=community.id,
        author_id=user.id,
        title="Welcome to C1",
        content="This is the first announcement."
    )
    db_session.add(ann)
    db_session.commit()
    
    assert ann.id is not None
    assert ann.title == "Welcome to C1"
    assert ann.content == "This is the first announcement."
    assert ann.community == community
    assert ann.author == user
    
    # 11. created_at and updated_at behave consistently with existing models.
    assert ann.created_at is not None
    assert ann.updated_at is not None
    
    # 3. Community.announcements exposes the correct announcements.
    assert ann in community.announcements
    # 4. User.announcements exposes the correct announcements.
    assert ann in user.announcements


def test_duplicate_titles_allowed(db_session):
    user = _create_user(db_session, "author2")
    c2 = _create_community(db_session, "c2")
    c3 = _create_community(db_session, "c3")
    
    # 7. Duplicate titles are allowed in the same community.
    ann1 = Announcement(community_id=c2.id, author_id=user.id, title="Update", content="Content 1")
    ann2 = Announcement(community_id=c2.id, author_id=user.id, title="Update", content="Content 2")
    db_session.add_all([ann1, ann2])
    db_session.commit()
    
    assert ann1.id != ann2.id
    
    # 8. Different communities can have announcements with the same title.
    ann3 = Announcement(community_id=c3.id, author_id=user.id, title="Update", content="Content 3")
    db_session.add(ann3)
    db_session.commit()
    
    assert ann3.id is not None


def test_cascade_delete_community(db_session):
    user = _create_user(db_session, "author3")
    c4 = _create_community(db_session, "c4")
    
    ann = Announcement(community_id=c4.id, author_id=user.id, title="Delete Me", content="To be deleted")
    db_session.add(ann)
    db_session.commit()
    
    ann_id = ann.id
    
    # 9. Deleting a Community does not leave orphaned announcements. (it cascades)
    db_session.delete(c4)
    db_session.commit()
    
    assert db_session.query(Announcement).filter_by(id=ann_id).first() is None


def test_cascade_delete_user(db_session):
    user = _create_user(db_session, "author4")
    c5 = _create_community(db_session, "c5")
    
    ann = Announcement(community_id=c5.id, author_id=user.id, title="Delete Author", content="To be deleted via user")
    db_session.add(ann)
    db_session.commit()
    
    ann_id = ann.id
    
    # 10. The author relationship remains valid according to the chosen foreign-key behavior. (CASCADE)
    db_session.delete(user)
    db_session.commit()
    
    assert db_session.query(Announcement).filter_by(id=ann_id).first() is None
