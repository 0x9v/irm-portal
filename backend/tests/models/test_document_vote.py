import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.exc import IntegrityError

from app.database import Base
from app.models.community import Community
from app.models.document import Document, DocumentSource, DocumentStatus, DocumentType
from app.models.document_vote import DocumentVote, VoteValue
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


def _create_document(db, module, user):
    doc = Document(
        module_id=module.id,
        uploader_id=user.id,
        title="Test Document",
        type=DocumentType.COURSE,
        source=DocumentSource.OFFICIAL,
        status=DocumentStatus.PENDING,
        storage_path="/path/to/doc.pdf", vote_threshold_snapshot=10
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def test_document_vote_creation(db_session):
    community = _create_community(db_session)
    module = _create_module(db_session, community)
    uploader = _create_user(db_session, "uploader")
    voter = _create_user(db_session, "voter")
    doc = _create_document(db_session, module, uploader)

    vote = DocumentVote(
        document_id=doc.id,
        voter_id=voter.id,
        vote=VoteValue.YES,
    )
    db_session.add(vote)
    db_session.commit()
    db_session.refresh(vote)

    assert vote.id is not None
    # 5. YES is stored correctly.
    assert vote.vote == VoteValue.YES

    # 1. A vote can be associated with a Document.
    assert vote.document_id == doc.id
    # 2. A vote can be associated with a User.
    assert vote.voter_id == voter.id

    # 3. Document.votes exposes the vote.
    assert len(doc.votes) == 1
    assert doc.votes[0].id == vote.id

    # 4. User.document_votes exposes the vote.
    assert len(voter.document_votes) == 1
    assert voter.document_votes[0].id == vote.id


def test_document_vote_no_value(db_session):
    community = _create_community(db_session)
    module = _create_module(db_session, community)
    uploader = _create_user(db_session, "uploader")
    voter = _create_user(db_session, "voter")
    doc = _create_document(db_session, module, uploader)

    vote = DocumentVote(
        document_id=doc.id,
        voter_id=voter.id,
        vote=VoteValue.NO,
    )
    db_session.add(vote)
    db_session.commit()
    db_session.refresh(vote)

    # 6. NO is stored correctly.
    assert vote.vote == VoteValue.NO


def test_unique_constraint(db_session):
    # 7. The same user cannot create two votes for the same document.
    community = _create_community(db_session)
    module = _create_module(db_session, community)
    uploader = _create_user(db_session, "uploader")
    voter = _create_user(db_session, "voter")
    doc = _create_document(db_session, module, uploader)

    vote1 = DocumentVote(
        document_id=doc.id,
        voter_id=voter.id,
        vote=VoteValue.YES,
    )
    db_session.add(vote1)
    db_session.commit()

    vote2 = DocumentVote(
        document_id=doc.id,
        voter_id=voter.id,
        vote=VoteValue.NO,
    )
    db_session.add(vote2)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_multiple_votes_same_user_different_docs(db_session):
    # 8. The same user can vote on different documents.
    community = _create_community(db_session)
    module = _create_module(db_session, community)
    uploader = _create_user(db_session, "uploader")
    voter = _create_user(db_session, "voter")
    doc1 = _create_document(db_session, module, uploader)
    doc2 = _create_document(db_session, module, uploader)

    vote1 = DocumentVote(
        document_id=doc1.id,
        voter_id=voter.id,
        vote=VoteValue.YES,
    )
    vote2 = DocumentVote(
        document_id=doc2.id,
        voter_id=voter.id,
        vote=VoteValue.YES,
    )
    db_session.add(vote1)
    db_session.add(vote2)
    db_session.commit()
    
    assert db_session.query(DocumentVote).filter_by(voter_id=voter.id).count() == 2


def test_multiple_users_same_document(db_session):
    # 9. Different users can vote on the same document.
    community = _create_community(db_session)
    module = _create_module(db_session, community)
    uploader = _create_user(db_session, "uploader")
    voter1 = _create_user(db_session, "voter1")
    voter2 = _create_user(db_session, "voter2")
    doc = _create_document(db_session, module, uploader)

    vote1 = DocumentVote(
        document_id=doc.id,
        voter_id=voter1.id,
        vote=VoteValue.YES,
    )
    vote2 = DocumentVote(
        document_id=doc.id,
        voter_id=voter2.id,
        vote=VoteValue.NO,
    )
    db_session.add(vote1)
    db_session.add(vote2)
    db_session.commit()
    
    assert db_session.query(DocumentVote).filter_by(document_id=doc.id).count() == 2


def test_cascade_delete_document(db_session):
    # 10. Deleting a Document removes its votes.
    community = _create_community(db_session)
    module = _create_module(db_session, community)
    uploader = _create_user(db_session, "uploader")
    voter = _create_user(db_session, "voter")
    doc = _create_document(db_session, module, uploader)

    vote = DocumentVote(
        document_id=doc.id,
        voter_id=voter.id,
        vote=VoteValue.YES,
    )
    db_session.add(vote)
    db_session.commit()
    
    assert db_session.query(DocumentVote).count() == 1
    
    db_session.delete(doc)
    db_session.commit()
    
    assert db_session.query(DocumentVote).count() == 0


def test_cascade_delete_user(db_session):
    # 11. Deleting a User removes their votes.
    community = _create_community(db_session)
    module = _create_module(db_session, community)
    uploader = _create_user(db_session, "uploader")
    voter = _create_user(db_session, "voter")
    doc = _create_document(db_session, module, uploader)

    vote = DocumentVote(
        document_id=doc.id,
        voter_id=voter.id,
        vote=VoteValue.YES,
    )
    db_session.add(vote)
    db_session.commit()
    
    assert db_session.query(DocumentVote).count() == 1
    
    db_session.delete(voter)
    db_session.commit()
    
    assert db_session.query(DocumentVote).count() == 0
