"""Private account sticker upload, listing, removal and preview API."""

from datetime import timedelta
from io import BytesIO
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.exc import OperationalError

from app.api import account_mutation_route
from app.api.deps import get_current_user
from app.core.config import settings
from app.core.sessions import create_session
from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models.community import Community
from app.models.discussion_message import DiscussionMessage
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.session import Session as AccountSession
from app.models.sticker_asset import StickerAsset
from app.models.user import User
from app.services import sticker_library as sticker_service
from app.services.sticker_library import MAX_USER_STICKER_BYTES


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
    monkeypatch.setattr(sticker_service, "SessionLocal", Factory)
    monkeypatch.setattr(settings, "storage_root", tmp_path / "sticker-storage")
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)


@pytest.fixture
def client():
    with TestClient(app) as instance:
        yield instance


def image_bytes(color=(255, 20, 30, 255), size=(80, 40)):
    stream = BytesIO()
    Image.new("RGBA", size, color).save(stream, format="PNG")
    return stream.getvalue()


def create_user(name=None, membership_status=None):
    with Factory() as db:
        user = User(username=name or f"sticker_{uuid4().hex}", email=f"{uuid4().hex}@example.test",
                    password_hash="opaque-test-hash", first_name="Test", family_name="Owner")
        db.add(user)
        if membership_status is not None:
            community = db.query(Community).filter_by(slug="stickers").one_or_none()
            if community is None:
                community = Community(name="Stickers", slug="stickers")
                db.add(community)
                db.flush()
            db.add(Membership(user_id=user.id, community_id=community.id, status=membership_status,
                              role=MembershipRole.MEMBER))
        db.commit()
        db.refresh(user)
        return user.id


def token_for(user_id):
    with Factory() as db:
        return create_session(db, user_id, timedelta(days=1))[0]


def upload(client, token, payload=None, media_type="image/png", *, filename="ignored.svg", headers=None):
    request_headers = {"Origin": settings.frontend_url}
    request_headers.update(headers or {})
    return client.post(
        "/api/v1/auth/me/stickers",
        files={"file": (filename, image_bytes() if payload is None else payload, media_type)},
        headers=request_headers,
        cookies={settings.session_cookie_name: token} if token else None,
    )


def test_upload_preview_without_membership_has_exact_private_contract(client):
    owner_id = create_user()
    token = token_for(owner_id)
    response = upload(client, token)
    assert response.status_code == 201
    item = response.json()
    assert set(item) == {"id", "preview_url", "width", "height", "media_type", "byte_size", "created_at"}
    assert item["preview_url"] == f"/api/v1/auth/me/stickers/{item['id']}/image"
    assert (item["width"], item["height"], item["media_type"]) == (256, 256, "image/webp")
    assert 0 < item["byte_size"] <= 262144
    assert response.headers["cache-control"] == "private, no-store"

    image = client.get(item["preview_url"], cookies={settings.session_cookie_name: token})
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/webp"
    assert image.headers["content-disposition"] == "inline"
    assert image.headers["cache-control"] == "private, no-store"
    assert "Cookie" in image.headers["vary"]
    assert image.headers["x-content-type-options"] == "nosniff"
    with Image.open(BytesIO(image.content)) as canonical:
        canonical.load()
        assert canonical.size == (256, 256) and canonical.getpixel((128, 0))[3] == 0


def test_no_membership_and_banned_membership_can_manage_private_library(client):
    user_id = create_user(membership_status=MembershipStatus.BANNED)
    token = token_for(user_id)
    response = upload(client, token)
    assert response.status_code == 201
    assert client.get("/api/v1/auth/me/stickers", cookies={settings.session_cookie_name: token}).status_code == 200


def test_foreign_preview_and_removal_are_concealed_and_remove_retains_referenced_file(client):
    owner_id, other_id = create_user(), create_user()
    owner_token, other_token = token_for(owner_id), token_for(other_id)
    created = upload(client, owner_token)
    asset_id = created.json()["id"]
    with Factory() as db:
        key = db.query(StickerAsset).filter_by(id=UUID(asset_id)).one().storage_key
    file_path = settings.storage_root / key
    assert file_path.is_file()

    assert client.get(f"/api/v1/auth/me/stickers/{asset_id}/image",
                      cookies={settings.session_cookie_name: other_token}).status_code == 404
    assert client.delete(f"/api/v1/auth/me/stickers/{asset_id}",
                         headers={"Origin": settings.frontend_url},
                         cookies={settings.session_cookie_name: other_token}).status_code == 404
    assert client.get("/api/v1/auth/me/stickers", cookies={settings.session_cookie_name: other_token}).json() == {
        "items": [], "next_cursor": None
    }

    with Factory() as db:
        community = Community(name="Content", slug="content")
        db.add(community)
        db.flush()
        message = DiscussionMessage(community_id=community.id, author_id=other_id,
                                    kind="CUSTOM_STICKER", custom_sticker_id=UUID(asset_id),
                                    client_message_id=uuid4())
        db.add(message)
        db.commit()
        message_id = message.id

    removed = client.delete(f"/api/v1/auth/me/stickers/{asset_id}",
                            headers={"Origin": settings.frontend_url},
                            cookies={settings.session_cookie_name: owner_token})
    assert removed.status_code == 204 and removed.content == b""
    assert removed.headers["cache-control"] == "private, no-store"
    repeated = client.delete(f"/api/v1/auth/me/stickers/{asset_id}",
                             headers={"Origin": settings.frontend_url},
                             cookies={settings.session_cookie_name: owner_token})
    assert repeated.status_code == 204
    assert client.get(f"/api/v1/auth/me/stickers/{asset_id}/image",
                      cookies={settings.session_cookie_name: owner_token}).status_code == 404
    assert file_path.is_file()
    with Factory() as db:
        assert db.get(DiscussionMessage, message_id).custom_sticker_id == UUID(asset_id)
        assert db.get(StickerAsset, UUID(asset_id)).removed_at is not None


def test_cursor_ordering_and_removed_cursor_still_pages(client):
    user_id = create_user()
    token = token_for(user_id)
    ids = [upload(client, token).json()["id"] for _ in range(3)]
    first = client.get("/api/v1/auth/me/stickers?limit=2", cookies={settings.session_cookie_name: token})
    assert first.status_code == 200
    assert [item["id"] for item in first.json()["items"]] == list(reversed(ids[1:]))
    cursor = first.json()["next_cursor"]
    changed_cursor = cursor[:-1] + ("A" if cursor[-1] != "A" else "B")
    tampered = client.get(f"/api/v1/auth/me/stickers?before={changed_cursor}",
                          cookies={settings.session_cookie_name: token})
    assert tampered.status_code == 422
    assert tampered.json()["detail"]["code"] == "invalid_sticker_cursor"
    removed_id = first.json()["items"][-1]["id"]
    assert client.delete(f"/api/v1/auth/me/stickers/{removed_id}", headers={"Origin": settings.frontend_url},
                         cookies={settings.session_cookie_name: token}).status_code == 204
    second = client.get(f"/api/v1/auth/me/stickers?limit=2&before={cursor}",
                        cookies={settings.session_cookie_name: token})
    assert second.status_code == 200, second.text
    assert [item["id"] for item in second.json()["items"]] == [ids[0]]
    assert second.json()["next_cursor"] is None
    assert client.get("/api/v1/auth/me/stickers?before=not-a-cursor",
                      cookies={settings.session_cookie_name: token}).json()["detail"]["code"] == "invalid_sticker_cursor"
    foreign_id = create_user()
    foreign_token = token_for(foreign_id)
    upload(client, foreign_token)
    upload(client, foreign_token)
    foreign_cursor = client.get("/api/v1/auth/me/stickers?limit=1", cookies={
        settings.session_cookie_name: foreign_token
    }).json()["next_cursor"]
    foreign_page = client.get(f"/api/v1/auth/me/stickers?before={foreign_cursor}",
                              cookies={settings.session_cookie_name: token})
    assert foreign_page.status_code == 422
    assert foreign_page.json()["detail"]["code"] == "invalid_sticker_cursor"


def test_multipart_origin_session_and_quota_errors(client, monkeypatch):
    user_id = create_user()
    token = token_for(user_id)
    assert upload(client, None).status_code == 401
    assert client.get("/api/v1/auth/me/stickers").status_code == 401
    assert upload(client, token, headers={"Origin": "https://evil.invalid"}).status_code == 403
    assert client.post("/api/v1/auth/me/stickers", data="x", headers={
        "Origin": settings.frontend_url, "Content-Type": "multipart/form-data; boundary=bad"
    }, cookies={settings.session_cookie_name: token}).status_code == 400

    with Factory() as db:
        account_session = db.query(AccountSession).one()
        account_session.is_revoked = True
        db.commit()
    assert client.get("/api/v1/auth/me/stickers", cookies={settings.session_cookie_name: token}).status_code == 401

    token = token_for(user_id)
    monkeypatch.setattr(sticker_service, "MAX_USER_STICKERS", 1)
    monkeypatch.setattr(sticker_service, "MAX_USER_STICKER_BYTES", MAX_USER_STICKER_BYTES)
    assert upload(client, token).status_code == 201
    over_count = upload(client, token)
    assert over_count.status_code == 409
    assert over_count.json() == {"detail": {"code": "sticker_quota_exceeded"}}
    assert "ignored.svg" not in over_count.text
    asset = client.get("/api/v1/auth/me/stickers", cookies={settings.session_cookie_name: token}).json()["items"][0]
    assert client.delete(f"/api/v1/auth/me/stickers/{asset['id']}", headers={"Origin": settings.frontend_url},
                         cookies={settings.session_cookie_name: token}).status_code == 204
    assert upload(client, token).status_code == 201


def test_upload_body_and_file_limits_and_extra_parts(client):
    user_id = create_user()
    token = token_for(user_id)
    oversize = client.post("/api/v1/auth/me/stickers", content=b"x", headers={
        "Origin": settings.frontend_url, "Content-Type": "multipart/form-data; boundary=x",
        "Content-Length": "2228225",
    }, cookies={settings.session_cookie_name: token})
    assert oversize.status_code == 413
    extra = client.post("/api/v1/auth/me/stickers", files=[
        ("file", ("a.png", image_bytes(), "image/png")), ("other", (None, "no", "text/plain"))
    ], headers={"Origin": settings.frontend_url}, cookies={settings.session_cookie_name: token})
    assert extra.status_code == 422
    duplicate = client.post("/api/v1/auth/me/stickers", files=[
        ("file", ("a.png", image_bytes(), "image/png")),
        ("file", ("b.png", image_bytes(), "image/png")),
    ], headers={"Origin": settings.frontend_url}, cookies={settings.session_cookie_name: token})
    assert duplicate.status_code == 422
    too_large_file = upload(client, token, b"x" * (2_097_153), "image/png")
    assert too_large_file.status_code == 413

    streamed = client.post("/api/v1/auth/me/stickers", content=iter([b"x" * 1_200_000, b"y" * 1_100_000]),
                           headers={"Origin": settings.frontend_url,
                                    "Content-Type": "multipart/form-data; boundary=bounded"},
                           cookies={settings.session_cookie_name: token})
    assert streamed.status_code == 413


def test_ownerless_rows_are_not_listed_or_previewed(client):
    owner_id = create_user()
    token = token_for(owner_id)
    created = upload(client, token)
    asset_id = UUID(created.json()["id"])
    with Factory() as db:
        asset = db.get(StickerAsset, asset_id)
        asset.owner_id = None
        db.commit()
    listed = client.get("/api/v1/auth/me/stickers", cookies={settings.session_cookie_name: token})
    assert listed.status_code == 200 and listed.json() == {"items": [], "next_cursor": None}
    preview = client.get(f"/api/v1/auth/me/stickers/{asset_id}/image",
                         cookies={settings.session_cookie_name: token})
    assert preview.status_code == 404
    assert preview.headers["cache-control"] == "private, no-store"


def test_byte_quota_boundary_and_removed_rows_do_not_count(client, monkeypatch):
    from app.core.stickers import process_sticker_image

    user_id = create_user()
    token = token_for(user_id)
    canonical_size = len(process_sticker_image(image_bytes(), "image/png"))
    monkeypatch.setattr(sticker_service, "MAX_USER_STICKERS", 100)
    monkeypatch.setattr(sticker_service, "MAX_USER_STICKER_BYTES", canonical_size)
    first = upload(client, token)
    assert first.status_code == 201 and first.json()["byte_size"] == canonical_size
    assert upload(client, token).status_code == 409
    asset_id = first.json()["id"]
    assert client.delete(f"/api/v1/auth/me/stickers/{asset_id}", headers={"Origin": settings.frontend_url},
                         cookies={settings.session_cookie_name: token}).status_code == 204
    assert upload(client, token).status_code == 201


def test_known_commit_rollback_cleans_just_created_blob(client, monkeypatch):
    user_id = create_user()
    token = token_for(user_id)
    real_factory = Factory
    calls = 0

    def failing_factory():
        nonlocal calls
        calls += 1
        db = real_factory()
        if calls == 1:
            def fail_commit():
                raise RuntimeError("synthetic commit failure")
            db.commit = fail_commit
        return db

    monkeypatch.setattr(sticker_service, "SessionLocal", failing_factory)
    response = upload(client, token)
    assert response.status_code == 500
    assert list(settings.storage_root.rglob("*.webp")) == []
    with Factory() as db:
        assert db.query(StickerAsset).count() == 0


def test_commit_outcome_resolved_and_unknown_preserve_safety(client, monkeypatch):
    user_id = create_user()
    token = token_for(user_id)
    real_factory = Factory
    calls = 0

    def committed_then_raised_factory():
        nonlocal calls
        calls += 1
        db = real_factory()
        if calls == 1:
            real_commit = db.commit
            def commit_then_raise():
                real_commit()
                raise RuntimeError("synthetic uncertain commit")
            db.commit = commit_then_raise
        return db

    monkeypatch.setattr(sticker_service, "SessionLocal", committed_then_raised_factory)
    resolved = upload(client, token)
    assert resolved.status_code == 201
    assert len(list(settings.storage_root.rglob("*.webp"))) == 1
    monkeypatch.setattr(sticker_service, "SessionLocal", Factory)

    other_id = create_user()
    other_token = token_for(other_id)
    calls = 0

    def unresolved_factory():
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OperationalError("fresh read unavailable", {}, RuntimeError("offline"))
        db = real_factory()
        if calls == 1:
            def fail_commit():
                raise RuntimeError("synthetic unknown commit")
            db.commit = fail_commit
        return db

    monkeypatch.setattr(sticker_service, "SessionLocal", unresolved_factory)
    unknown = upload(client, other_token)
    assert unknown.status_code == 500
    assert len(list(settings.storage_root.rglob("*.webp"))) == 2
    monkeypatch.setattr(sticker_service, "SessionLocal", Factory)
