import os
import uuid
from datetime import timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.sessions import create_session
from app.core.storage.local import LocalFileSystemStorage
from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models.community import Community
from app.models.document import Document, DocumentSource, DocumentStatus, DocumentType
from app.models.document_vote import DocumentVote, VoteValue
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.module import Module
from app.models.user import User

storage = LocalFileSystemStorage()

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
    u = User(
        username=username,
        email=f"{username}@example.com",
        password_hash="hash",
        first_name="First",
        family_name="Last",
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _create_token(db, user):
    token, _ = create_session(db, user.id, timedelta(days=1))
    return token


def _create_community_module(db, slug):
    c = Community(name=f"Community {slug}", slug=slug)
    db.add(c)
    db.commit()
    db.refresh(c)
    m = Module(community_id=c.id, name=f"Module {slug}", slug=f"mod-{slug}")
    db.add(m)
    db.commit()
    db.refresh(m)
    return c, m


def _create_membership(db, user, community, status, role):
    m = Membership(
        user_id=user.id,
        community_id=community.id,
        cne=f"CNE_{user.username}",
        status=status,
        role=role,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def _create_document_with_file(
    db,
    module,
    uploader,
    source,
    status,
    filename="test.pdf",
    content=b"ORIGINAL_INLINE_BYTES_0123456789",
    title="Test Document",
):
    unique_key = f"modules/{module.id}/{uuid.uuid4()}/{filename}"
    storage.save(unique_key, content)

    doc = Document(
        module_id=module.id,
        uploader_id=uploader.id,
        title=title,
        type=DocumentType.COURSE,
        source=source,
        status=status,
        storage_path=unique_key,
        vote_threshold_snapshot=10,
        preview_path="preview.png",
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def _cast_vote(db, user, document, vote_value):
    v = DocumentVote(voter_id=user.id, document_id=document.id, vote=vote_value)
    db.add(v)
    db.commit()
    return v


# 1. Unauthenticated guest receives 401
def test_guest_unauthenticated_receives_401(client):
    res = client.get(f"/api/v1/documents/{uuid.uuid4()}/view")
    assert res.status_code == 401
    assert "Not authenticated" in res.json().get("detail", "")


# 2. Unknown document receives safe 404
def test_unknown_document_receives_safe_404(client, db_session):
    u = _create_user(db_session, "viewer1")
    t = _create_token(db_session, u)
    res = client.get(
        f"/api/v1/documents/{uuid.uuid4()}/view",
        cookies={settings.session_cookie_name: t},
    )
    assert res.status_code == 404
    assert res.json()["detail"] == "Document not found."


# 3. Invalid UUID receives safe 404
def test_invalid_uuid_receives_safe_404(client, db_session):
    u = _create_user(db_session, "viewer2")
    t = _create_token(db_session, u)
    res = client.get(
        "/api/v1/documents/not-a-valid-uuid/view",
        cookies={settings.session_cookie_name: t},
    )
    assert res.status_code == 404
    assert res.json()["detail"] == "Document not found."


# 4. Pending document denied with safe 404
def test_pending_document_denied_safe_404(client, db_session):
    c, m = _create_community_module(db_session, "view_pend")
    upl = _create_user(db_session, "upl_pend")
    u = _create_user(db_session, "user_pend")
    t = _create_token(db_session, u)

    doc = _create_document_with_file(
        db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.PENDING
    )

    res = client.get(
        f"/api/v1/documents/{doc.id}/view",
        cookies={settings.session_cookie_name: t},
    )
    assert res.status_code == 404
    assert res.json()["detail"] == "Document not found."


# 5. Pending YES voter STILL denied safe 404 on view (only download permits it)
def test_pending_yes_voter_denied_on_view(client, db_session):
    c, m = _create_community_module(db_session, "view_yes")
    upl = _create_user(db_session, "upl_yes")
    u = _create_user(db_session, "yes_voter")
    t = _create_token(db_session, u)
    _create_membership(db_session, u, c, MembershipStatus.ACTIVE, MembershipRole.MEMBER)

    doc = _create_document_with_file(
        db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.PENDING
    )
    _cast_vote(db_session, u, doc, VoteValue.YES)

    # Confirm download IS permitted for this user
    dl_res = client.get(
        f"/api/v1/documents/{doc.id}/download",
        cookies={settings.session_cookie_name: t},
    )
    assert dl_res.status_code == 200

    # But inline view MUST be denied with safe 404
    view_res = client.get(
        f"/api/v1/documents/{doc.id}/view",
        cookies={settings.session_cookie_name: t},
    )
    assert view_res.status_code == 404
    assert view_res.json()["detail"] == "Document not found."


# 6. Rejected document denied with safe 404
def test_rejected_document_denied_safe_404(client, db_session):
    c, m = _create_community_module(db_session, "view_rej")
    upl = _create_user(db_session, "upl_rej")
    u = _create_user(db_session, "user_rej")
    t = _create_token(db_session, u)

    doc = _create_document_with_file(
        db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.REJECTED
    )

    res = client.get(
        f"/api/v1/documents/{doc.id}/view",
        cookies={settings.session_cookie_name: t},
    )
    assert res.status_code == 404
    assert res.json()["detail"] == "Document not found."


# 7. Pending official document denied with safe 404
def test_pending_official_document_denied(client, db_session):
    c, m = _create_community_module(db_session, "view_off_pend")
    upl = _create_user(db_session, "upl_off")
    u = _create_user(db_session, "user_off")
    t = _create_token(db_session, u)

    doc = _create_document_with_file(
        db_session, m, upl, DocumentSource.OFFICIAL, DocumentStatus.PENDING
    )

    res = client.get(
        f"/api/v1/documents/{doc.id}/view",
        cookies={settings.session_cookie_name: t},
    )
    assert res.status_code == 404
    assert res.json()["detail"] == "Document not found."


# 8. Approved PDF served inline with correct headers and content
def test_approved_pdf_served_inline(client, db_session):
    c, m = _create_community_module(db_session, "view_pdf")
    upl = _create_user(db_session, "upl_pdf")
    u = _create_user(db_session, "user_pdf")
    t = _create_token(db_session, u)

    raw_bytes = b"%PDF-1.4 sample content for inline viewing"
    doc = _create_document_with_file(
        db_session,
        m,
        upl,
        DocumentSource.STUDENT,
        DocumentStatus.APPROVED,
        filename="lecture.pdf",
        content=raw_bytes,
        title="Lecture Notes 01",
    )

    res = client.get(
        f"/api/v1/documents/{doc.id}/view",
        cookies={settings.session_cookie_name: t},
    )
    assert res.status_code == 200
    assert res.content == raw_bytes
    assert res.headers["content-type"] == "application/pdf"
    assert "inline" in res.headers["content-disposition"]
    disposition = res.headers["content-disposition"]
    assert 'Lecture%20Notes%2001.pdf' in disposition or 'Lecture Notes 01.pdf' in disposition
    assert "private" in res.headers["cache-control"]
    assert "no-store" in res.headers["cache-control"]
    assert res.headers.get("x-content-type-options") == "nosniff"
    assert res.headers.get("accept-ranges") == "bytes"


# 9. Approved JPEG and PNG served with correct MIME types
def test_approved_jpeg_and_png_served_inline(client, db_session):
    c, m = _create_community_module(db_session, "view_images")
    upl = _create_user(db_session, "upl_img")
    u = _create_user(db_session, "user_img")
    t = _create_token(db_session, u)

    jpeg_bytes = b"\xff\xd8\xff\xe0\x00\x10JFIF sample jpeg"
    doc_jpeg = _create_document_with_file(
        db_session,
        m,
        upl,
        DocumentSource.OFFICIAL,
        DocumentStatus.APPROVED,
        filename="chart.jpg",
        content=jpeg_bytes,
        title="Architecture Diagram",
    )

    res_jpg = client.get(
        f"/api/v1/documents/{doc_jpeg.id}/view",
        cookies={settings.session_cookie_name: t},
    )
    assert res_jpg.status_code == 200
    assert res_jpg.content == jpeg_bytes
    assert res_jpg.headers["content-type"] == "image/jpeg"
    assert "inline" in res_jpg.headers["content-disposition"]
    disp_jpg = res_jpg.headers["content-disposition"]
    assert 'Architecture%20Diagram.jpg' in disp_jpg or 'Architecture Diagram.jpg' in disp_jpg

    png_bytes = b"\x89PNG\r\n\x1a\n sample png"
    doc_png = _create_document_with_file(
        db_session,
        m,
        upl,
        DocumentSource.STUDENT,
        DocumentStatus.APPROVED,
        filename="photo.png",
        content=png_bytes,
        title="Lab Screenshot",
    )

    res_png = client.get(
        f"/api/v1/documents/{doc_png.id}/view",
        cookies={settings.session_cookie_name: t},
    )
    assert res_png.status_code == 200
    assert res_png.content == png_bytes
    assert res_png.headers["content-type"] == "image/png"
    assert "inline" in res_png.headers["content-disposition"]
    disp_png = res_png.headers["content-disposition"]
    assert 'Lab%20Screenshot.png' in disp_png or 'Lab Screenshot.png' in disp_png


# 10. Approved document access matches shared policy (non-members and foreign members)
def test_approved_document_shared_access_policy(client, db_session):
    c, m = _create_community_module(db_session, "view_shared")
    upl = _create_user(db_session, "upl_shared")
    doc = _create_document_with_file(
        db_session,
        m,
        upl,
        DocumentSource.STUDENT,
        DocumentStatus.APPROVED,
        filename="shared.pdf",
        content=b"SHARED_APPROVED_CONTENT",
    )

    # Caller 1: Authenticated non-member
    u_non = _create_user(db_session, "non_member_view")
    t_non = _create_token(db_session, u_non)
    res_non = client.get(
        f"/api/v1/documents/{doc.id}/view",
        cookies={settings.session_cookie_name: t_non},
    )
    assert res_non.status_code == 200
    assert res_non.content == b"SHARED_APPROVED_CONTENT"

    # Caller 2: Member of another community
    c_other, _ = _create_community_module(db_session, "view_other_comm")
    u_other = _create_user(db_session, "other_member_view")
    t_other = _create_token(db_session, u_other)
    _create_membership(db_session, u_other, c_other, MembershipStatus.ACTIVE, MembershipRole.MEMBER)

    res_other = client.get(
        f"/api/v1/documents/{doc.id}/view",
        cookies={settings.session_cookie_name: t_other},
    )
    assert res_other.status_code == 200
    assert res_other.content == b"SHARED_APPROVED_CONTENT"


# 11. Authorized approved document with missing physical file returns controlled 404
def test_authorized_approved_document_missing_file_controlled_404(client, db_session):
    c, m = _create_community_module(db_session, "view_missing")
    upl = _create_user(db_session, "upl_miss")
    u = _create_user(db_session, "user_miss")
    t = _create_token(db_session, u)

    doc = _create_document_with_file(
        db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.APPROVED
    )

    # Delete physical file from storage
    storage.delete(doc.storage_path)

    res = client.get(
        f"/api/v1/documents/{doc.id}/view",
        cookies={settings.session_cookie_name: t},
    )
    assert res.status_code == 404
    assert "missing" in res.json()["detail"].lower()


# 12. Unauthorized requests do not invoke physical file resolution
def test_unauthorized_requests_do_not_resolve_physical_file(client, db_session):
    c, m = _create_community_module(db_session, "view_spy")
    upl = _create_user(db_session, "upl_spy")
    u = _create_user(db_session, "user_spy")
    t = _create_token(db_session, u)

    doc_pending = _create_document_with_file(
        db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.PENDING
    )
    doc_rejected = _create_document_with_file(
        db_session, m, upl, DocumentSource.STUDENT, DocumentStatus.REJECTED
    )

    with patch("app.api.v1.endpoints.documents_global.get_document_download_info") as mock_info:
        # A. Unauthenticated request
        client.get(f"/api/v1/documents/{doc_pending.id}/view")
        assert mock_info.call_count == 0

        # B. Unknown document
        client.get(
            f"/api/v1/documents/{uuid.uuid4()}/view",
            cookies={settings.session_cookie_name: t},
        )
        assert mock_info.call_count == 0

        # C. Pending document
        client.get(
            f"/api/v1/documents/{doc_pending.id}/view",
            cookies={settings.session_cookie_name: t},
        )
        assert mock_info.call_count == 0

        # D. Rejected document
        client.get(
            f"/api/v1/documents/{doc_rejected.id}/view",
            cookies={settings.session_cookie_name: t},
        )
        assert mock_info.call_count == 0


# 13. Safe filename sanitation and absence of internal storage paths in headers
def test_safe_filename_and_no_internal_paths_in_headers(client, db_session):
    c, m = _create_community_module(db_session, "view_sanitize")
    upl = _create_user(db_session, "upl_san")
    u = _create_user(db_session, "user_san")
    t = _create_token(db_session, u)

    doc = _create_document_with_file(
        db_session,
        m,
        upl,
        DocumentSource.STUDENT,
        DocumentStatus.APPROVED,
        filename="tricky.pdf",
        content=b"TRICKY_CONTENT",
        title='../../etc/passwd" <script>evil</script> Valid_Title',
    )

    res = client.get(
        f"/api/v1/documents/{doc.id}/view",
        cookies={settings.session_cookie_name: t},
    )
    assert res.status_code == 200
    disposition = res.headers.get("content-disposition", "")
    assert "inline" in disposition
    # Internal path segments and quotes must not exist
    assert ".." not in disposition
    assert "/etc" not in disposition
    assert "<script>" not in disposition
    assert str(doc.storage_path) not in str(res.headers)


# 14. Valid single byte range returns 206 Partial Content with correct bytes and headers
def test_byte_range_request_returns_206_partial_content(client, db_session):
    c, m = _create_community_module(db_session, "view_range")
    upl = _create_user(db_session, "upl_range")
    u = _create_user(db_session, "user_range")
    t = _create_token(db_session, u)

    test_content = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    doc = _create_document_with_file(
        db_session,
        m,
        upl,
        DocumentSource.STUDENT,
        DocumentStatus.APPROVED,
        filename="range.pdf",
        content=test_content,
        title="Range Test Document",
    )

    # Request first 10 bytes: bytes 0-9
    res = client.get(
        f"/api/v1/documents/{doc.id}/view",
        headers={"Range": "bytes=0-9"},
        cookies={settings.session_cookie_name: t},
    )
    assert res.status_code == 206
    assert res.content == b"0123456789"
    assert res.headers["content-range"] == f"bytes 0-9/{len(test_content)}"
    assert res.headers["content-length"] == "10"
    assert res.headers["content-type"] == "application/pdf"
    assert "inline" in res.headers["content-disposition"]
    assert "private" in res.headers["cache-control"]
    assert "no-store" in res.headers["cache-control"]
    assert res.headers.get("x-content-type-options") == "nosniff"

    # Request middle range: bytes 10-19
    res2 = client.get(
        f"/api/v1/documents/{doc.id}/view",
        headers={"Range": "bytes=10-19"},
        cookies={settings.session_cookie_name: t},
    )
    assert res2.status_code == 206
    assert res2.content == b"ABCDEFGHIJ"
    assert res2.headers["content-range"] == f"bytes 10-19/{len(test_content)}"
    assert res2.headers["content-length"] == "10"


# 15. Unsatisfiable byte range returns 416 Range Not Satisfiable
def test_unsatisfiable_byte_range_returns_416(client, db_session):
    c, m = _create_community_module(db_session, "view_unsat")
    upl = _create_user(db_session, "upl_unsat")
    u = _create_user(db_session, "user_unsat")
    t = _create_token(db_session, u)

    test_content = b"SHORT_CONTENT"
    doc = _create_document_with_file(
        db_session,
        m,
        upl,
        DocumentSource.STUDENT,
        DocumentStatus.APPROVED,
        filename="short.pdf",
        content=test_content,
    )

    # Request range way beyond content size
    res = client.get(
        f"/api/v1/documents/{doc.id}/view",
        headers={"Range": "bytes=5000-6000"},
        cookies={settings.session_cookie_name: t},
    )
    assert res.status_code == 416
    assert res.headers.get("content-range") == f"bytes */{len(test_content)}"


# 16. Unsupported stored document format returns safe 415
def test_unsupported_stored_format_returns_415(client, db_session):
    c, m = _create_community_module(db_session, "view_unsupp")
    upl = _create_user(db_session, "upl_unsupp")
    u = _create_user(db_session, "user_unsupp")
    t = _create_token(db_session, u)

    # Stored document with unexpected extension / format (e.g. text/html)
    unique_key = f"modules/{m.id}/{uuid.uuid4()}/malicious.html"
    storage.save(unique_key, b"<html><body>Active Script</body></html>")

    doc = Document(
        module_id=m.id,
        uploader_id=upl.id,
        title="Html Doc",
        type=DocumentType.COURSE,
        source=DocumentSource.STUDENT,
        status=DocumentStatus.APPROVED,
        storage_path=unique_key,
        vote_threshold_snapshot=10,
    )
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)

    res = client.get(
        f"/api/v1/documents/{doc.id}/view",
        cookies={settings.session_cookie_name: t},
    )
    assert res.status_code == 415
    assert "unsupported" in res.json()["detail"].lower()


# 17. Download endpoint continues to serve as attachment
def test_download_endpoint_remains_attachment(client, db_session):
    c, m = _create_community_module(db_session, "view_dl_att")
    upl = _create_user(db_session, "upl_dl")
    u = _create_user(db_session, "user_dl")
    t = _create_token(db_session, u)

    doc = _create_document_with_file(
        db_session,
        m,
        upl,
        DocumentSource.STUDENT,
        DocumentStatus.APPROVED,
        filename="lecture.pdf",
        content=b"ATTACHMENT_CONTENT",
        title="Lecture Note",
    )

    res = client.get(
        f"/api/v1/documents/{doc.id}/download",
        cookies={settings.session_cookie_name: t},
    )
    assert res.status_code == 200
    assert "attachment" in res.headers["content-disposition"]
    disp = res.headers["content-disposition"]
    assert 'Lecture%20Note.pdf' in disp or 'Lecture Note.pdf' in disp
    assert "inline" not in res.headers["content-disposition"]


# 18. Unicode title is safely handled in Content-Disposition
def test_unicode_filename_handled_safely(client, db_session):
    c, m = _create_community_module(db_session, "view_unicode")
    upl = _create_user(db_session, "upl_uni")
    u = _create_user(db_session, "user_uni")
    t = _create_token(db_session, u)

    doc = _create_document_with_file(
        db_session,
        m,
        upl,
        DocumentSource.STUDENT,
        DocumentStatus.APPROVED,
        filename="french.pdf",
        content=b"FRENCH_CONTENT",
        title="Résumé_Cours",
    )

    res = client.get(
        f"/api/v1/documents/{doc.id}/view",
        cookies={settings.session_cookie_name: t},
    )
    assert res.status_code == 200
    assert res.content == b"FRENCH_CONTENT"
    disposition = res.headers.get("content-disposition", "")
    assert "inline" in disposition
    # Must be valid ASCII / RFC 5987 without raw non-ASCII header bytes
    disposition.encode("ascii")


# 19. Range header on unauthorized requests does NOT bypass authentication or access rules
def test_range_header_on_unauthorized_request_does_not_bypass(client, db_session):
    c, m = _create_community_module(db_session, "view_range_auth")
    upl = _create_user(db_session, "upl_ra")
    u = _create_user(db_session, "user_ra")
    t = _create_token(db_session, u)

    doc_pending = _create_document_with_file(
        db_session,
        m,
        upl,
        DocumentSource.STUDENT,
        DocumentStatus.PENDING,
        filename="secret.pdf",
        content=b"TOP_SECRET_RANGE_DATA",
    )

    # Guest with Range header
    res_guest = client.get(
        f"/api/v1/documents/{doc_pending.id}/view",
        headers={"Range": "bytes=0-4"},
    )
    assert res_guest.status_code == 401

    # Authenticated user on pending document with Range header
    res_pend = client.get(
        f"/api/v1/documents/{doc_pending.id}/view",
        headers={"Range": "bytes=0-4"},
        cookies={settings.session_cookie_name: t},
    )
    assert res_pend.status_code == 404
    assert res_pend.json()["detail"] == "Document not found."

