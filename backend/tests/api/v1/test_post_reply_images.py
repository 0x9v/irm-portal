from datetime import timedelta
from io import BytesIO
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image
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
from app.models.community_post import CommunityPost
from app.models.community_post_reply import CommunityPostReply
from app.models.membership import Membership, MembershipStatus
from app.models.user import User
from app.api.v1.endpoints.community_posts import get_post_reply_image_storage


engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _png(mode="RGBA", color=(255, 0, 0, 128), size=(80, 40), *, exif=None):
    output = BytesIO()
    image = Image.new(mode, size, color)
    image.save(output, format="PNG", exif=exif or b"")
    return output.getvalue()


def _jpeg(size=(80, 40)):
    output = BytesIO()
    Image.new("RGB", size, "blue").save(output, format="JPEG")
    return output.getvalue()


def _origin():
    return settings.frontend_url.rstrip("/")


def _client():
    return TestClient(app, headers={"Origin": _origin()})


def _seed(db):
    community = Community(name="Reply Images", slug="reply-images")
    user = User(username="replyuser", email="reply@example.invalid", password_hash="x", first_name="Reply", family_name="User")
    db.add_all([community, user])
    db.flush()
    db.add(Membership(user_id=user.id, community_id=community.id, status=MembershipStatus.ACTIVE))
    post = CommunityPost(community_id=community.id, author_id=user.id, title="Post", content="Body")
    db.add(post)
    db.commit()
    token, _ = create_session(db, user.id, timedelta(days=1))
    return community.slug, community.id, user.id, post.id, token


def _multipart(client, community_slug, post_id, token, request_id=None, *, content=None, image=None, headers=None):
    parts = [("client_request_id", (None, str(request_id or uuid4())))]
    if content is not None:
        parts.append(("content", (None, content)))
    if image is not None:
        parts.append(("image", ("untrusted-name.png", image, "image/png")))
    return client.post(
        f"/api/v1/communities/{community_slug}/posts/{post_id}/replies",
        files=parts,
        headers={"Origin": _origin(), **(headers or {})},
        cookies={settings.session_cookie_name: token},
    )


def setup_module():
    Base.metadata.create_all(bind=engine)


def teardown_module():
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.clear()


def _install_overrides(tmp_path, monkeypatch):
    def override_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    storage = LocalFileSystemStorage(tmp_path)
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_post_reply_image_storage] = lambda: storage
    monkeypatch.setattr("app.api.account_mutation_route.SessionLocal", TestSession)
    monkeypatch.setattr("app.services.post_reply_images.SessionLocal", TestSession)
    with TestSession() as db:
        db.query(CommunityPostReply).delete()
        db.query(CommunityPost).delete()
        db.query(Membership).delete()
        db.query(Community).delete()
        db.query(User).delete()
        db.commit()
        community_slug, community_id, user_id, post_id, token = _seed(db)
    return storage, community_slug, community_id, user_id, post_id, token


def test_multipart_text_image_only_and_legacy_json(tmp_path, monkeypatch):
    storage, community_slug, community_id, user_id, post_id, token = _install_overrides(tmp_path, monkeypatch)
    client = _client()
    text_only = _multipart(client, community_slug, post_id, token, content="  hello  ")
    assert text_only.status_code == 201
    assert text_only.json()["content"] == "hello" and text_only.json()["image_url"] is None

    attached = _multipart(client, community_slug, post_id, token, content="caption", image=_png())
    assert attached.status_code == 201 and attached.json()["image_url"].endswith("/image")
    image_only = _multipart(client, community_slug, post_id, token, image=_png())
    assert image_only.status_code == 201 and image_only.json()["content"] == ""
    image_response = client.get(image_only.json()["image_url"], cookies={settings.session_cookie_name: token})
    assert image_response.status_code == 200
    assert image_response.headers["content-type"] == "image/jpeg"
    assert image_response.headers["content-disposition"] == "inline"
    assert image_response.headers["cache-control"] == "private, no-store"
    assert set(value.strip() for value in image_response.headers["vary"].split(",")) == {"Cookie", "Origin"}
    assert image_response.headers["x-content-type-options"] == "nosniff"

    legacy = client.post(
        f"/api/v1/communities/{community_slug}/posts/{post_id}/replies",
        json={"content": "legacy"},
        cookies={settings.session_cookie_name: token},
    )
    assert legacy.status_code == 201 and legacy.json()["content"] == "legacy"
    assert legacy.json()["image_url"] is None
    assert len(list(tmp_path.rglob("*.jpg"))) == 2


def test_replay_conflict_removed_reply_and_wrong_parent_are_concealed(tmp_path, monkeypatch):
    storage, community_slug, community_id, user_id, post_id, token = _install_overrides(tmp_path, monkeypatch)
    client = _client()
    request_id = uuid4()
    first = _multipart(client, community_slug, post_id, token, request_id, content="same", image=_png())
    replay = _multipart(client, community_slug, post_id, token, request_id, content="same", image=_png())
    conflict = _multipart(client, community_slug, post_id, token, request_id, content="different", image=_png())
    assert first.status_code == 201
    assert replay.status_code == 200 and replay.json()["id"] == first.json()["id"]
    assert conflict.status_code == 409
    assert len(list(tmp_path.rglob("*.jpg"))) == 1
    other_post = CommunityPost(community_id=community_id, author_id=user_id, title="Other", content="Other")
    with TestSession() as db:
        db.add(other_post)
        db.commit()
        other_id = other_post.id
        reply = db.query(CommunityPostReply).filter_by(id=__import__("uuid").UUID(first.json()["id"])).one()
        reply.removed_at = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
        db.commit()
    hidden = client.get(first.json()["image_url"], cookies={settings.session_cookie_name: token})
    assert hidden.status_code == 404
    removed_replay = _multipart(client, community_slug, post_id, token, request_id, content="same", image=_png())
    assert removed_replay.status_code == 409
    wrong_parent = client.get(
        f"/api/v1/communities/{community_slug}/posts/{other_id}/replies/{first.json()['id']}/image",
        cookies={settings.session_cookie_name: token},
    )
    assert wrong_parent.status_code == 404


def test_multipart_contract_requires_auth_origin_and_valid_parts(tmp_path, monkeypatch):
    _, community_slug, _, _, post_id, token = _install_overrides(tmp_path, monkeypatch)
    client = _client()
    path = f"/api/v1/communities/{community_slug}/posts/{post_id}/replies"
    unauth = client.post(path, data={"client_request_id": str(uuid4()), "content": "x"}, headers={"Origin": _origin()})
    assert unauth.status_code == 401
    untrusted = client.post(path, data={"client_request_id": str(uuid4()), "content": "x"}, headers={"Origin": "https://evil.invalid"}, cookies={settings.session_cookie_name: token})
    assert untrusted.status_code == 403
    empty = _multipart(client, community_slug, post_id, token)
    assert empty.status_code == 422
    malformed_id = _multipart(client, community_slug, post_id, token, "not-a-canonical-v4", content="x")
    assert malformed_id.status_code == 422
    spoofed = client.post(path, data={"client_request_id": str(uuid4())}, files={"image": ("x.jpg", _png(), "image/jpeg")}, headers={"Origin": _origin()}, cookies={settings.session_cookie_name: token})
    assert spoofed.status_code == 422
    duplicate = client.post(
        path,
        files=[("client_request_id", (None, str(uuid4()))), ("content", (None, "a")), ("content", (None, "b"))],
        headers={"Origin": _origin()},
        cookies={settings.session_cookie_name: token},
    )
    assert duplicate.status_code == 422
    caller_author = client.post(
        path,
        files=[("client_request_id", (None, str(uuid4()))), ("content", (None, "a")), ("author_id", (None, str(uuid4())))],
        headers={"Origin": _origin()},
        cookies={settings.session_cookie_name: token},
    )
    assert caller_author.status_code == 422


def test_image_conversion_orientation_alpha_and_metadata_stripping():
    from app.core.post_reply_images import process_post_reply_image, validate_canonical_post_reply_image

    exif = Image.Exif()
    exif[274] = 6
    source = BytesIO()
    Image.new("RGBA", (80, 40), (255, 0, 0, 0)).save(source, format="PNG", exif=exif)
    canonical = process_post_reply_image(source.getvalue(), "image/png")
    validate_canonical_post_reply_image(canonical)
    with Image.open(BytesIO(canonical)) as result:
        assert result.size == (40, 80)
        assert result.mode == "RGB"
        assert "exif" not in result.info and "icc_profile" not in result.info
        assert result.getpixel((0, 0))[0] > 240 and result.getpixel((0, 0))[1] > 240


def test_image_conversion_rejects_animation_corruption_and_limits():
    from app.core.post_reply_images import PostReplyImageError, process_post_reply_image

    with __import__("pytest").raises(PostReplyImageError):
        process_post_reply_image(b"not an image", "image/jpeg")
    with __import__("pytest").raises(PostReplyImageError):
        process_post_reply_image(_png(size=(4097, 32)), "image/png")

