import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models.community import Community
from app.models.module import Module
from app.models.programme import Programme
from scripts.seed import seed_db

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

def test_seed_db(db_session):
    # 1. First seed creates the community.
    # 2. First seed creates the three modules.
    seed_db(db_session)
    
    community = db_session.query(Community).filter_by(slug="irm").first()
    assert community is not None
    assert community.name == "FST Mohammedia — IRM"
    
    modules = db_session.query(Module).all()
    assert len(modules) == 3
    
    slugs = {m.slug for m in modules}
    assert slugs == {"advanced-c", "web-development", "poo"}
    
    # 3. Each module belongs to the IRM community.
    for module in modules:
        assert module.community_id == community.id
        
    # 4. Running the seed a second time does not create duplicates.
    seed_db(db_session)
    
    assert db_session.query(Community).count() == 1
    assert db_session.query(Module).count() == 3


def test_seed_links_new_irm_community_and_modules_to_existing_programme(db_session):
    programme = Programme(
        slug="irm", name="IRM", institution_slug="fst-mohammedia",
        institution_name="FST Mohammedia",
    )
    db_session.add(programme)
    db_session.commit()

    seed_db(db_session)

    community = db_session.query(Community).filter_by(slug="irm").one()
    assert community.programme_id == programme.id
    assert db_session.query(Module).count() == 3
    assert {module.programme_id for module in db_session.query(Module).all()} == {programme.id}


def test_seed_keeps_existing_unlinked_community_and_modules_unlinked(db_session):
    programme = Programme(
        slug="irm", name="IRM", institution_slug="fst-mohammedia",
        institution_name="FST Mohammedia",
    )
    community = Community(name="Unlinked IRM", slug="irm")
    db_session.add_all([programme, community])
    db_session.commit()
    community_id = community.id

    seed_db(db_session)

    assert db_session.query(Community).count() == 1
    assert db_session.get(Community, community_id).programme_id is None
    assert {module.programme_id for module in db_session.query(Module).all()} == {None}
