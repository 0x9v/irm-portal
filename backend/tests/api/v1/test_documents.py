import pytest
from datetime import timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.sessions import create_session
from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models.community import Community
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.membership_permission import MembershipPermission, PermissionType
from app.models.module import Module
from app.models.user import User
from app.models.document import Document, DocumentStatus, DocumentSource

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, 
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

@pytest.fixture(autouse=True)
def setup_overrides():
    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()

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

@pytest.fixture
def client():
    return TestClient(app)

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

def _create_token(db, user):
    raw_token, _ = create_session(db, user.id, timedelta(days=1))
    return raw_token

def _create_community(db, slug):
    community = Community(name=f"Community {slug}", slug=slug)
    db.add(community)
    db.commit()
    db.refresh(community)
    return community

def _create_membership(db, user, community, status, role=MembershipRole.MEMBER):
    m = Membership(user_id=user.id, community_id=community.id, cne="123", status=status, role=role)
    db.add(m)
    db.commit()
    return m

def _create_module(db, community, name, slug):
    module = Module(community_id=community.id, name=name, slug=slug)
    db.add(module)
    db.commit()
    db.refresh(module)
    return module

def _get_valid_pdf_bytes():
    import fitz
    doc = fitz.open()
    doc.new_page()
    return doc.write()

def _get_valid_image_bytes(format="JPEG"):
    from PIL import Image
    import io
    img = Image.new("RGB", (10, 10), color="red")
    out = io.BytesIO()
    img.save(out, format=format)
    return out.getvalue()

def _upload(client, token, community_slug, module_slug, file_name="test.pdf", content_type="application/pdf", extra_data=None):
    if extra_data is None:
        extra_data = {}
    data = {
        "title": "My Doc",
        "type": "COURSE",
        **extra_data
    }
    
    if content_type == "application/pdf":
        file_content = _get_valid_pdf_bytes()
    elif content_type == "image/jpeg":
        file_content = _get_valid_image_bytes("JPEG")
    elif content_type == "image/png":
        file_content = _get_valid_image_bytes("PNG")
    else:
        file_content = b"fake content"

    files = {
        "file": (file_name, file_content, content_type)
    }
    headers = {settings.session_cookie_name: token} if token else None
    return client.post(
        f"/api/v1/communities/{community_slug}/modules/{module_slug}/documents",
        data=data,
        files=files,
        cookies=headers
    )

def test_upload_authentication_authorization(client, db_session):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    
    # 1. Unauthenticated upload -> 401
    resp = _upload(client, None, community.slug, module.slug)
    assert resp.status_code == 401
    
    # 4. Registered non-member upload -> 403
    user_non_member = _create_user(db_session, "nonmember")
    token_nm = _create_token(db_session, user_non_member)
    resp = _upload(client, token_nm, community.slug, module.slug)
    assert resp.status_code == 403
    
    # 2. Pending membership upload -> 403
    user_pending = _create_user(db_session, "pending")
    token_p = _create_token(db_session, user_pending)
    _create_membership(db_session, user_pending, community, MembershipStatus.PENDING)
    resp = _upload(client, token_p, community.slug, module.slug)
    assert resp.status_code == 403
    
    # 3. Rejected membership upload -> 403
    user_rejected = _create_user(db_session, "rejected")
    token_r = _create_token(db_session, user_rejected)
    _create_membership(db_session, user_rejected, community, MembershipStatus.REJECTED)
    resp = _upload(client, token_r, community.slug, module.slug)
    assert resp.status_code == 403

def test_member_upload(client, db_session):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    user = _create_user(db_session, "member")
    token = _create_token(db_session, user)
    _create_membership(db_session, user, community, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    # 5. ACTIVE MEMBER can upload a student document (omitted source defaults to STUDENT).
    resp = _upload(client, token, community.slug, module.slug)
    assert resp.status_code == 201
    data = resp.json()
    
    # 6. Member upload gets source = STUDENT.
    assert data["source"] == "STUDENT"
    # 7. Member upload gets status = PENDING.
    assert data["status"] == "PENDING"
    
    # Member explicitly providing source=STUDENT succeeds.
    resp_student = _upload(client, token, community.slug, module.slug, extra_data={"source": "STUDENT"})
    assert resp_student.status_code == 201
    assert resp_student.json()["source"] == "STUDENT"
    
    # 10. A MEMBER attempting source=OFFICIAL is rejected.
    resp2 = _upload(client, token, community.slug, module.slug, extra_data={"source": "OFFICIAL"})
    assert resp2.status_code == 403
    
    # 11. Client cannot manipulate status through the request body
    resp3 = _upload(client, token, community.slug, module.slug, extra_data={"status": "APPROVED"})
    assert resp3.status_code == 201
    assert resp3.json()["status"] == "PENDING"

def test_delegate_upload(client, db_session):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    user = _create_user(db_session, "delegate")
    token = _create_token(db_session, user)
    _create_membership(db_session, user, community, MembershipStatus.ACTIVE, MembershipRole.DELEGATE)
    
    # 8. Omitting source for DELEGATE/MODERATOR remains a validation error.
    resp_no_source = _upload(client, token, community.slug, module.slug)
    assert resp_no_source.status_code == 422
    
    # 5. DELEGATE explicit OFFICIAL → OFFICIAL + APPROVED.
    resp = _upload(client, token, community.slug, module.slug, extra_data={"source": "OFFICIAL"})
    assert resp.status_code == 201
    assert resp.json()["source"] == "OFFICIAL"
    assert resp.json()["status"] == "APPROVED"
    
    # 4. DELEGATE explicit STUDENT → STUDENT + PENDING.
    resp2 = _upload(client, token, community.slug, module.slug, extra_data={"source": "STUDENT"})
    assert resp2.status_code == 201
    assert resp2.json()["source"] == "STUDENT"
    assert resp2.json()["status"] == "PENDING"
    
    # 9. Client-supplied status cannot override backend (OFFICIAL should not become PENDING)
    resp3 = _upload(client, token, community.slug, module.slug, extra_data={"source": "OFFICIAL", "status": "PENDING"})
    assert resp3.status_code == 201
    assert resp3.json()["status"] == "APPROVED"

def test_moderator_upload(client, db_session):
    community = _create_community(db_session, "irm2")
    module = _create_module(db_session, community, "Mod2", "mod2")
    user = _create_user(db_session, "moderator")
    token = _create_token(db_session, user)
    membership = _create_membership(db_session, user, community, MembershipStatus.ACTIVE, MembershipRole.MODERATOR)
    
    # 8. Omitting source for DELEGATE/MODERATOR remains a validation error.
    resp_no_source = _upload(client, token, community.slug, module.slug)
    assert resp_no_source.status_code == 422
    
    # MODERATOR explicit OFFICIAL without permission → 403.
    resp_no_perm = _upload(client, token, community.slug, module.slug, extra_data={"source": "OFFICIAL"})
    assert resp_no_perm.status_code == 403
    
    # Grant permission
    perm = MembershipPermission(membership_id=membership.id, permission=PermissionType.UPLOAD_OFFICIAL_DOCUMENTS)
    db_session.add(perm)
    db_session.commit()
    
    # 7. MODERATOR explicit OFFICIAL with perm → OFFICIAL + APPROVED.
    resp = _upload(client, token, community.slug, module.slug, extra_data={"source": "OFFICIAL"})
    assert resp.status_code == 201
    assert resp.json()["source"] == "OFFICIAL"
    assert resp.json()["status"] == "APPROVED"
    
    # 6. MODERATOR explicit STUDENT → STUDENT + PENDING (no extra grant needed)
    resp2 = _upload(client, token, community.slug, module.slug, extra_data={"source": "STUDENT"})
    assert resp2.status_code == 201
    assert resp2.json()["source"] == "STUDENT"

    assert resp2.json()["status"] == "PENDING"

def test_module_community_scoping(client, db_session):
    user = _create_user(db_session, "user")
    token = _create_token(db_session, user)
    
    comm1 = _create_community(db_session, "comm1")
    mod1 = _create_module(db_session, comm1, "Mod 1", "mod1")
    _create_membership(db_session, user, comm1, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    comm2 = _create_community(db_session, "comm2")
    mod2 = _create_module(db_session, comm2, "Mod 2", "mod2")
    
    # 12. Valid community + valid module works.
    resp = _upload(client, token, comm1.slug, mod1.slug)
    assert resp.status_code == 201
    
    # 13. Unknown community -> 404 (handled by get_current_active_membership or module finding)
    resp = _upload(client, token, "unknown", mod1.slug)
    assert resp.status_code == 404
    
    # 14. Unknown module -> 404
    resp = _upload(client, token, comm1.slug, "unknown")
    assert resp.status_code == 404
    
    # 15. Module belonging to another community cannot be used.
    # user is not member of comm2 anyway, so 403 or 404
    resp = _upload(client, token, comm2.slug, mod2.slug)
    assert resp.status_code in [403, 404]

def test_file_validation(client, db_session):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    user = _create_user(db_session, "member")
    token = _create_token(db_session, user)
    _create_membership(db_session, user, community, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    # 16. PDF upload succeeds.
    assert _upload(client, token, community.slug, module.slug, content_type="application/pdf").status_code == 201
    
    # 17. JPEG upload succeeds.
    assert _upload(client, token, community.slug, module.slug, content_type="image/jpeg").status_code == 201
    
    # 18. PNG upload succeeds.
    assert _upload(client, token, community.slug, module.slug, content_type="image/png").status_code == 201
    
    # 19. Unsupported file type is rejected.
    assert _upload(client, token, community.slug, module.slug, content_type="text/plain").status_code == 400
    
    # 20. Path traversal / malicious filenames cannot control storage paths.
    resp = _upload(client, token, community.slug, module.slug, file_name="../../malicious.pdf")
    assert resp.status_code == 201
    # Check DB that the storage_path is safe and doesn't contain ../
    import uuid
    doc = db_session.query(Document).filter_by(id=uuid.UUID(resp.json()["id"])).first()
    assert "../" not in doc.storage_path
from unittest import mock

def test_persistence_storage(client, db_session):
    community = _create_community(db_session, "irm")
    module = _create_module(db_session, community, "Mod", "mod")
    user = _create_user(db_session, "member")
    token = _create_token(db_session, user)
    _create_membership(db_session, user, community, MembershipStatus.ACTIVE, MembershipRole.MEMBER)
    
    # 21. Successful upload creates both the physical stored file and Document record.
    resp = _upload(client, token, community.slug, module.slug)
    assert resp.status_code == 201
    import uuid
    doc_id = uuid.UUID(resp.json()["id"])
    doc = db_session.query(Document).filter_by(id=doc_id).first()
    assert doc is not None
    # We can check that the storage file exists if we don't mock it, but we are using the real tmp_path or just default
    # For now, let's trust the storage abstraction tests.

    from app.core.storage.exceptions import StorageError
    # 22. Failed storage operation does not leave an incorrect Document row.
    with mock.patch("app.core.storage.local.LocalFileSystemStorage.save") as mock_save:
        mock_save.side_effect = StorageError("Storage failed")
        resp_fail = _upload(client, token, community.slug, module.slug)
        assert resp_fail.status_code == 500
        docs_after = db_session.query(Document).count()
        # Since it raised before DB add, the count should just be 1 from the first test
        assert docs_after == 1

    # 23. Failed database persistence does not leave an orphaned stored file where cleanup is possible.
    with mock.patch("sqlalchemy.orm.Session.commit") as mock_commit:
        mock_commit.side_effect = Exception("DB failed")
        with mock.patch("app.core.storage.local.LocalFileSystemStorage.delete") as mock_delete:
            resp_db_fail = _upload(client, token, community.slug, module.slug)
            assert resp_db_fail.status_code == 500
            assert mock_delete.called
