"""Authenticated avatar routes, privacy, processing and file lifecycle."""

from datetime import datetime, timedelta, timezone
from io import BytesIO
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import account_mutation_route
from app.core import avatars as avatar_helpers
from app.core.config import settings
from app.core.sessions import create_session
from app.core.storage.exceptions import AvatarStorageError
from app.core.storage.local import LocalFileSystemStorage
from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models.announcement import Announcement
from app.models.community import Community
from app.models.membership import (
    Membership,
    MembershipApplicantType,
    MembershipIdentifierType,
    MembershipStatus,
)
from app.models.session import Session as AccountSession
from app.models.user import User
from app.services import avatar as avatar_service


engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Factory = sessionmaker(bind=engine, autoflush=False)


def override_get_db():
    with Factory() as db:
        yield db


@pytest.fixture(autouse=True)
def isolated_api(tmp_path, monkeypatch):
    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(account_mutation_route, "SessionLocal", Factory)
    monkeypatch.setattr(avatar_service, "SessionLocal", Factory)
    monkeypatch.setattr(settings, "storage_root", tmp_path / "avatar-storage")
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)


@pytest.fixture
def client():
    with TestClient(app) as instance:
        yield instance


def png_bytes(size=(64, 48), color=(220, 30, 40, 255)):
    stream = BytesIO()
    Image.new("RGBA", size, color).save(stream, format="PNG")
    return stream.getvalue()


def make_user(username=None):
    with Factory() as db:
        user = User(
            username=username or f"avatar_{uuid4().hex}",
            email=f"{uuid4().hex}@example.test",
            password_hash="opaque-test-hash",
            first_name="Account",
            family_name="Owner",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user.id


def token_for(user_id):
    with Factory() as db:
        return create_session(db, user_id, timedelta(days=1))[0]


def upload(client, token, payload=None, media_type="image/png", *, filename="ignored.svg", headers=None):
    req_headers = {"Origin": settings.frontend_url}
    req_headers.update(headers or {})
    return client.put(
        "/api/v1/auth/me/avatar",
        files={"file": (filename, png_bytes() if payload is None else payload, media_type)},
        headers=req_headers,
        cookies={settings.session_cookie_name: token} if token else None,
    )


def assert_private(response):
    assert response.headers["cache-control"] == "private, no-store"


def current_key(user_id):
    with Factory() as db:
        return db.get(User, user_id).avatar_storage_key


def test_upload_replace_remove_and_authenticated_cross_account_read(client):
    owner_id, viewer_id = make_user(), make_user()
    owner_token, viewer_token = token_for(owner_id), token_for(viewer_id)

    first = upload(client, owner_token)
    assert first.status_code == 200
    assert first.json().keys() == {"avatar_url"}
    assert first.json()["avatar_url"].startswith(f"/api/v1/users/{owner_id}/avatar/")
    assert_private(first)
    first_key = current_key(owner_id)
    first_file = settings.storage_root / first_key
    assert first_file.is_file()

    # URL knowledge grants authenticated viewing across accounts, with no
    # membership relation or private account fields in the image response.
    read = client.get(first.json()["avatar_url"], cookies={settings.session_cookie_name: viewer_token})
    assert read.status_code == 200 and read.content[:2] == b"\xff\xd8"
    assert read.headers["content-type"] == "image/jpeg"
    assert read.headers["content-disposition"] == "inline"
    assert read.headers["cache-control"] == "private, no-store"
    assert "Cookie" in read.headers["vary"]
    assert read.headers["x-content-type-options"] == "nosniff"

    second = upload(client, owner_token, png_bytes(color=(10, 80, 220, 255)))
    assert second.status_code == 200 and second.json()["avatar_url"] != first.json()["avatar_url"]
    assert_private(second)
    assert not first_file.exists()
    stale = client.get(first.json()["avatar_url"], cookies={settings.session_cookie_name: viewer_token})
    assert stale.status_code == 404 and stale.json() == {"detail": "Avatar not found"}
    assert_private(stale)

    with Factory() as db:
        user = db.get(User, owner_id)
        assert user.avatar_url == second.json()["avatar_url"]
    removed = client.delete(
        "/api/v1/auth/me/avatar",
        headers={"Origin": settings.frontend_url},
        cookies={settings.session_cookie_name: owner_token},
    )
    assert removed.status_code == 200 and removed.json() == {"avatar_url": None}
    assert_private(removed)
    assert current_key(owner_id) is None
    missing = client.get(second.json()["avatar_url"], cookies={settings.session_cookie_name: viewer_token})
    assert missing.status_code == 404 and missing.json() == {"detail": "Avatar not found"}
    repeated = client.delete(
        "/api/v1/auth/me/avatar",
        headers={"Origin": settings.frontend_url},
        cookies={settings.session_cookie_name: owner_token},
    )
    assert repeated.status_code == 200 and repeated.json() == {"avatar_url": None}
    assert_private(repeated)


def test_removing_absent_avatar_does_not_advance_updated_at(client):
    user_id = make_user()
    token = token_for(user_id)
    with Factory() as db:
        before = db.get(User, user_id).updated_at
    response = client.delete(
        "/api/v1/auth/me/avatar", headers={"Origin": settings.frontend_url},
        cookies={settings.session_cookie_name: token},
    )
    assert response.status_code == 200
    with Factory() as db:
        assert db.get(User, user_id).updated_at == before


@pytest.mark.parametrize("origin", [None, "null", "https://evil.invalid", "http://localhost:3000.attacker.invalid"])
def test_origin_denial_precedes_body_and_auth(client, origin):
    headers = {"Content-Type": "multipart/form-data; boundary=x"}
    if origin is not None:
        headers["Origin"] = origin
    response = client.put("/api/v1/auth/me/avatar", content=b"broken", headers=headers)
    assert response.status_code == 403
    assert response.json() == {"detail": "Untrusted request origin"}
    assert_private(response)


def test_mutation_auth_media_boundary_and_empty_delete_errors_are_private(client):
    no_auth = client.put(
        "/api/v1/auth/me/avatar", content=b"bad",
        headers={"Origin": settings.frontend_url, "Content-Type": "multipart/form-data; boundary=x"},
    )
    assert no_auth.status_code == 401
    assert_private(no_auth)

    wrong_type = client.put(
        "/api/v1/auth/me/avatar", content=b"anything",
        headers={"Origin": settings.frontend_url, "Content-Type": "application/json"},
    )
    assert wrong_type.status_code == 415
    assert_private(wrong_type)

    malformed = client.put(
        "/api/v1/auth/me/avatar", content=b"not multipart",
        headers={"Origin": settings.frontend_url, "Content-Type": "multipart/form-data"},
    )
    assert malformed.status_code == 400
    assert_private(malformed)

    malformed_user = make_user()
    malformed_token = token_for(malformed_user)
    malformed_body = client.put(
        "/api/v1/auth/me/avatar", content=b"not a multipart body",
        headers={"Origin": settings.frontend_url,
                 "Content-Type": "multipart/form-data; boundary=valid-boundary"},
        cookies={settings.session_cookie_name: malformed_token},
    )
    assert malformed_body.status_code == 400
    assert_private(malformed_body)

    user_id, token = make_user(), None
    token = token_for(user_id)
    nonempty = client.request(
        "DELETE",
        "/api/v1/auth/me/avatar", content=b"x", headers={"Origin": settings.frontend_url},
        cookies={settings.session_cookie_name: token},
    )
    assert nonempty.status_code == 400
    assert_private(nonempty)


def test_multipart_parts_media_mismatch_and_size_limits(client):
    user_id = make_user()
    token = token_for(user_id)
    headers = {"Origin": settings.frontend_url}

    missing = client.put(
        "/api/v1/auth/me/avatar", files={"other": (None, "value")}, headers=headers,
        cookies={settings.session_cookie_name: token},
    )
    assert missing.status_code == 422
    assert_private(missing)

    extra = client.put(
        "/api/v1/auth/me/avatar", data={"extra": "value"},
        files={"file": ("x.png", png_bytes(), "image/png")}, headers=headers,
        cookies={settings.session_cookie_name: token},
    )
    assert extra.status_code == 422
    assert_private(extra)

    duplicate = client.put(
        "/api/v1/auth/me/avatar",
        files=[("file", ("a.png", png_bytes(), "image/png")),
               ("file", ("b.png", png_bytes(), "image/png"))],
        headers=headers, cookies={settings.session_cookie_name: token},
    )
    assert duplicate.status_code == 422
    assert_private(duplicate)

    unsupported = upload(client, token, media_type="image/gif")
    assert unsupported.status_code == 415
    assert_private(unsupported)

    spoofed = upload(client, token, payload=png_bytes(), media_type="image/jpeg")
    assert spoofed.status_code == 422
    assert_private(spoofed)

    file_too_large = upload(client, token, payload=b"x" * (2_097_152 + 1))
    assert file_too_large.status_code == 413
    assert_private(file_too_large)

    declared_too_large = client.put(
        "/api/v1/auth/me/avatar", content=b"",
        headers={"Origin": settings.frontend_url,
                 "Content-Type": "multipart/form-data; boundary=x",
                 "Content-Length": "2162689"},
        cookies={settings.session_cookie_name: token},
    )
    assert declared_too_large.status_code == 413
    assert_private(declared_too_large)

    def oversized_stream():
        yield b"--x\r\n"
        yield b"a" * (2_162_688 + 1)

    streamed_too_large = client.put(
        "/api/v1/auth/me/avatar", content=oversized_stream(),
        headers={"Origin": settings.frontend_url,
                 "Content-Type": "multipart/form-data; boundary=x"},
        cookies={settings.session_cookie_name: token},
    )
    assert streamed_too_large.status_code == 413
    assert_private(streamed_too_large)


def test_authenticated_unknown_malformed_stale_and_revoked_targets_are_concealed(client):
    user_id = make_user()
    token = token_for(user_id)
    viewer_id = make_user()
    viewer_token = token_for(viewer_id)

    guest = client.get(f"/api/v1/users/{user_id}/avatar/not-a-version")
    assert guest.status_code == 401
    assert_private(guest)

    malformed = client.get(
        f"/api/v1/users/not-a-user/avatar/not-a-version",
        cookies={settings.session_cookie_name: viewer_token},
    )
    assert malformed.status_code == 404 and malformed.json() == {"detail": "Avatar not found"}
    assert_private(malformed)

    unknown = client.get(
        f"/api/v1/users/{uuid4()}/avatar/{uuid4()}",
        cookies={settings.session_cookie_name: viewer_token},
    )
    assert unknown.status_code == 404 and unknown.json() == {"detail": "Avatar not found"}
    assert_private(unknown)

    with Factory() as db:
        session = db.query(AccountSession).filter_by(user_id=viewer_id).one()
        session.is_revoked = True
        db.commit()
    revoked = client.get(
        f"/api/v1/users/{user_id}/avatar/{uuid4()}",
        cookies={settings.session_cookie_name: viewer_token},
    )
    assert revoked.status_code == 401
    assert_private(revoked)

    expired_id = make_user()
    expired_token = token_for(expired_id)
    with Factory() as db:
        session = db.query(AccountSession).filter_by(user_id=expired_id).one()
        session.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
    expired = client.get(
        f"/api/v1/users/{user_id}/avatar/{uuid4()}",
        cookies={settings.session_cookie_name: expired_token},
    )
    assert expired.status_code == 401
    assert_private(expired)


def test_avatar_operation_preserves_account_session_membership_and_content_identity(client):
    user_id = make_user()
    token = token_for(user_id)
    with Factory() as db:
        user = db.get(User, user_id)
        community = Community(name="Avatar test", slug=f"avatar-{uuid4().hex[:10]}")
        db.add(community)
        db.flush()
        membership = Membership(
            user_id=user_id, community_id=community.id, cne="CNE-KEEP",
            applicant_type=MembershipApplicantType.STUDENT,
            identifier_type=MembershipIdentifierType.MASSAR,
            applicant_first_name="Submitted", applicant_family_name="Snapshot",
            promotion="2025/2026", status=MembershipStatus.PENDING,
        )
        announcement = Announcement(
            community_id=community.id, author_id=user_id,
            title="Keep identity", content="Original content",
        )
        db.add_all([membership, announcement])
        db.commit()
        membership_id, announcement_id = membership.id, announcement.id
        account_snapshot = (user.id, user.email, user.username, user.first_name, user.family_name)
        session = db.query(AccountSession).filter_by(user_id=user_id).one()
        session_snapshot = (session.id, session.is_revoked, session.token_hash)

    response = upload(client, token)
    assert response.status_code == 200
    with Factory() as db:
        user = db.get(User, user_id)
        membership = db.get(Membership, membership_id)
        announcement = db.get(Announcement, announcement_id)
        session = db.query(AccountSession).filter_by(user_id=user_id).one()
        assert (user.id, user.email, user.username, user.first_name, user.family_name) == account_snapshot
        assert (membership.cne, membership.applicant_type, membership.identifier_type,
                membership.applicant_first_name, membership.applicant_family_name,
                membership.promotion, membership.status) == (
                    "CNE-KEEP", MembershipApplicantType.STUDENT, MembershipIdentifierType.MASSAR,
                    "Submitted", "Snapshot", "2025/2026", MembershipStatus.PENDING)
        assert announcement.author_id == user_id and announcement.content == "Original content"
        assert (session.id, session.is_revoked, session.token_hash) == session_snapshot


def test_commit_failure_rolls_back_pointer_and_removes_only_new_file(client, monkeypatch):
    user_id = make_user()
    token = token_for(user_id)
    storage = LocalFileSystemStorage(settings.storage_root)
    old_key = avatar_helpers.store_avatar_jpeg(storage, user_id, b"\xff\xd8old\xff\xd9")
    with Factory() as db:
        db.get(User, user_id).avatar_storage_key = old_key
        db.commit()

    class FailingCommitFactory:
        def __call__(self):
            db = Factory()
            db.commit = lambda: (_ for _ in ()).throw(RuntimeError("injected commit failure"))
            return db

    monkeypatch.setattr(avatar_service, "SessionLocal", FailingCommitFactory())
    failed = upload(client, token)
    assert failed.status_code == 500
    assert failed.json() == {"detail": "Avatar operation failed"}
    assert_private(failed)
    assert current_key(user_id) == old_key
    assert (settings.storage_root / old_key).exists()
    files = [path for path in (settings.storage_root / "avatars" / str(user_id)).glob("*.jpg")]
    assert files == [settings.storage_root / old_key]


def test_postcommit_cleanup_failure_returns_success_and_logs_no_retry_claim(client, monkeypatch, caplog):
    user_id = make_user()
    token = token_for(user_id)
    storage = LocalFileSystemStorage(settings.storage_root)
    old_key = avatar_helpers.store_avatar_jpeg(storage, user_id, b"\xff\xd8old\xff\xd9")
    with Factory() as db:
        db.get(User, user_id).avatar_storage_key = old_key
        db.commit()
    original_delete = LocalFileSystemStorage.delete_avatar

    def fail_old_delete(local_storage, key):
        if key == old_key:
            raise AvatarStorageError("delete_failed")
        return original_delete(local_storage, key)

    monkeypatch.setattr(LocalFileSystemStorage, "delete_avatar", fail_old_delete)
    response = upload(client, token)
    assert response.status_code == 200
    assert_private(response)
    assert current_key(user_id) != old_key
    assert (settings.storage_root / old_key).exists()
    assert "avatar_cleanup_failed phase=postcommit_replacement" in caplog.text
    assert "no automatic retry is configured" in caplog.text


def test_profile_patch_still_rejects_avatar_fields(client):
    user_id = make_user()
    token = token_for(user_id)
    response = client.patch(
        "/api/v1/auth/me", json={"avatar_url": "/somewhere"},
        headers={"Origin": settings.frontend_url},
        cookies={settings.session_cookie_name: token},
    )
    assert response.status_code == 422
    assert_private(response)
