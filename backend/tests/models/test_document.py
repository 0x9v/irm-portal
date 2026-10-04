import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models.community import Community
from app.models.document import Document, DocumentSource, DocumentStatus, DocumentType
from app.models.module import Module
from app.models.user import User

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

def _create_community(db):
    community = Community(name="Comm", slug="comm")
    db.add(community)
    db.commit()
    db.refresh(community)
    return community

def _create_module(db, community):
    module = Module(community_id=community.id, name="Module", slug="mod")
    db.add(module)
    db.commit()
    db.refresh(module)
    return module

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

def test_document_creation(db_session):
    community = _create_community(db_session)
    module = _create_module(db_session, community)
    user = _create_user(db_session, "user")
    
    doc = Document(
        module_id=module.id,
        uploader_id=user.id,
        title="Test Document",
        type=DocumentType.COURSE,
        source=DocumentSource.OFFICIAL,
        status=DocumentStatus.PENDING,
        storage_path="/path/to/doc.pdf", vote_threshold_snapshot=10
    )
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)
    
    assert doc.id is not None
    assert doc.title == "Test Document"
    
    # 5. The document type is stored correctly.
    assert doc.type == DocumentType.COURSE
    # 6. The document source is stored correctly.
    assert doc.source == DocumentSource.OFFICIAL
    # 7. The document status is stored correctly.
    assert doc.status == DocumentStatus.PENDING
    # 8. storage_path is stored correctly.
    assert doc.storage_path == "/path/to/doc.pdf"
    
    # 1. A Document can be associated with a Module.
    assert doc.module_id == module.id
    # 2. A Document can be associated with a User.
    assert doc.uploader_id == user.id
    
    # 3. Module.documents exposes the Document.
    assert len(module.documents) == 1
    assert module.documents[0].id == doc.id
    
    # 4. User.documents exposes the Document.
    assert len(user.documents) == 1
    assert user.documents[0].id == doc.id

def test_cascade_delete_module(db_session):
    # 9. Deleting a Module does not leave orphaned Documents.
    community = _create_community(db_session)
    module = _create_module(db_session, community)
    user = _create_user(db_session, "user")
    
    doc = Document(
        module_id=module.id,
        uploader_id=user.id,
        title="Test",
        type=DocumentType.COURSE,
        source=DocumentSource.OFFICIAL,
        storage_path="path", vote_threshold_snapshot=10
    )
    db_session.add(doc)
    db_session.commit()
    
    assert db_session.query(Document).count() == 1
    
    db_session.delete(module)
    db_session.commit()
    
    assert db_session.query(Document).count() == 0

def test_cascade_delete_user(db_session):
    # 10. Deleting a User does not leave orphaned Documents.
    community = _create_community(db_session)
    module = _create_module(db_session, community)
    user = _create_user(db_session, "user")
    
    doc = Document(
        module_id=module.id,
        uploader_id=user.id,
        title="Test",
        type=DocumentType.COURSE,
        source=DocumentSource.OFFICIAL,
        storage_path="path", vote_threshold_snapshot=10
    )
    db_session.add(doc)
    db_session.commit()
    
    assert db_session.query(Document).count() == 1
    
    db_session.delete(user)
    db_session.commit()
    
    assert db_session.query(Document).count() == 0
