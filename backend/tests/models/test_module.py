import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models.community import Community
from app.models.module import Module

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, 
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(autouse=True)
def init_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)

@pytest.fixture
def db_session():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

def _create_community(db, slug):
    community = Community(
        name=f"Comm {slug}",
        slug=slug
    )
    db.add(community)
    db.commit()
    db.refresh(community)
    return community

def test_module_creation(db_session):
    # 1. A Module can be associated with a Community.
    # 4. A module can have the expected name and slug.
    community = _create_community(db_session, "irm")
    
    module = Module(
        community_id=community.id,
        name="Test Module",
        slug="test-module"
    )
    db_session.add(module)
    db_session.commit()
    db_session.refresh(module)
    
    assert module.id is not None
    assert module.name == "Test Module"
    assert module.slug == "test-module"
    
    # 2. Community.modules exposes the Module.
    assert len(community.modules) == 1
    assert community.modules[0].id == module.id
    
    # 3. Module.community exposes the correct Community.
    assert module.community.id == community.id

def test_same_slug_different_communities(db_session):
    # 5. Two modules with the same slug can exist in different communities.
    community1 = _create_community(db_session, "comm1")
    community2 = _create_community(db_session, "comm2")
    
    module1 = Module(community_id=community1.id, name="Module 1", slug="common-slug")
    module2 = Module(community_id=community2.id, name="Module 2", slug="common-slug")
    
    db_session.add_all([module1, module2])
    db_session.commit()
    
    assert module1.id is not None
    assert module2.id is not None

def test_same_slug_same_community_fails(db_session):
    # 6. Two modules with the same slug cannot exist in the same community.
    community = _create_community(db_session, "comm")
    
    module1 = Module(community_id=community.id, name="Module 1", slug="common-slug")
    db_session.add(module1)
    db_session.commit()
    
    module2 = Module(community_id=community.id, name="Module 2", slug="common-slug")
    db_session.add(module2)
    
    with pytest.raises(IntegrityError):
        db_session.commit()

def test_cascade_delete_community(db_session):
    # 7. Deleting a Community does not leave orphaned Modules.
    community = _create_community(db_session, "comm")
    
    module = Module(community_id=community.id, name="Module", slug="mod")
    db_session.add(module)
    db_session.commit()
    
    assert db_session.query(Module).count() == 1
    
    db_session.delete(community)
    db_session.commit()
    
    assert db_session.query(Module).count() == 0
