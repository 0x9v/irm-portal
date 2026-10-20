from datetime import datetime, timedelta, timezone
from io import BytesIO
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.sessions import create_session
from app.core.storage.local import LocalFileSystemStorage
from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models.community import Community
from app.models.document import Document, DocumentStatus, DocumentSource, DocumentType, ResourceKind
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.membership_permission import MembershipPermission, PermissionType
from app.models.document_vote import DocumentVote, VoteValue
from app.models.saved_document import SavedDocument
from app.models.document_reading import DocumentReading
from app.models.management_event import ManagementEvent
from app.models.module import Module
from app.models.user import User


engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_db():
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.clear()


@pytest.fixture
def db_session():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def client():
    return TestClient(app, headers={"Origin": "http://localhost:3000"})


@pytest.fixture
def storage(tmp_path, monkeypatch):
    value = LocalFileSystemStorage(tmp_path)
    import app.services.module_resource as module_resource_service

    monkeypatch.setattr(module_resource_service, "storage", value)
    return value


def _user(db, name):
    value = User(username=name, email=f"{name}@example.test", password_hash="hash",
                 first_name="Test", family_name="User")
    db.add(value)
    db.commit()
    db.refresh(value)
    return value


def _community(db, slug="irm"):
    value = Community(name=slug, slug=slug, document_vote_threshold=2)
    db.add(value)
    db.commit()
    db.refresh(value)
    return value


def _module(db, community, slug="algebra"):
    value = Module(community_id=community.id, name="Algebra", slug=slug)
    db.add(value)
    db.commit()
    db.refresh(value)
    return value


def _token(db, user):
    token, _session = create_session(db, user.id, timedelta(days=1))
    return token


def _membership(db, user, community, role=MembershipRole.MEMBER, state=MembershipStatus.ACTIVE):
    value = Membership(user_id=user.id, community_id=community.id, cne=f"{user.username}-id",
                       status=state, role=role)
    db.add(value)
    db.commit()
    db.refresh(value)
    return value


def _png():
    output = BytesIO()
    Image.new("RGBA", (32, 20), (30, 80, 120, 90)).save(output, format="PNG")
    return output.getvalue()


def _seed_removable(db, module, uploader, kind, state):
    from uuid import uuid4
    payload = {
        ResourceKind.PDF: {"type": DocumentType.TD, "storage_path": f"retained/{uuid4()}.pdf"},
        ResourceKind.IMAGE: {"type": DocumentType.TD, "storage_path": f"retained/{uuid4()}.png"},
        ResourceKind.YOUTUBE: {"type": DocumentType.TD, "youtube_video_id": "dQw4w9WgXcQ"},
        ResourceKind.LINK: {"type": DocumentType.TD, "external_url": "https://example.org/notes"},
    }[kind]
    row = Document(module_id=module.id, uploader_id=uploader.id, title=f"{kind.value} resource",
                   resource_kind=kind, source=DocumentSource.STUDENT, status=state,
                   vote_threshold_snapshot=2, **payload)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@pytest.mark.parametrize("kind", list(ResourceKind))
@pytest.mark.parametrize("state", [DocumentStatus.PENDING, DocumentStatus.REJECTED])
def test_resource_removal_policy_retains_identity_and_relationships(client, db_session, storage, kind, state):
    community = _community(db_session)
    module = _module(db_session, community)
    owner = _user(db_session, f"delete_owner_{kind.value}_{state.value}")
    other = _user(db_session, f"delete_other_{kind.value}_{state.value}")
    moderator = _user(db_session, f"delete_moderator_{kind.value}_{state.value}")
    delegate = _user(db_session, f"delete_delegate_{kind.value}_{state.value}")
    _membership(db_session, owner, community)
    _membership(db_session, other, community)
    _membership(db_session, moderator, community, MembershipRole.MODERATOR)
    _membership(db_session, delegate, community, MembershipRole.DELEGATE)
    row = _seed_removable(db_session, module, owner, kind, state)
    if row.storage_path:
        storage.save(row.storage_path, b"retained-file-bytes")
    db_session.add_all([
        DocumentVote(document_id=row.id, voter_id=other.id, vote=VoteValue.YES),
        SavedDocument(user_id=other.id, document_id=row.id),
        DocumentReading(user_id=owner.id, document_id=row.id, last_page=3),
    ])
    db_session.commit()
    saved_id = db_session.query(SavedDocument.id).filter_by(document_id=row.id).scalar()
    reading_id = db_session.query(DocumentReading.id).filter_by(document_id=row.id).scalar()
    original = (row.id, row.type, row.storage_path, row.image_storage_key, row.source, row.status)
    path = f"/api/v1/communities/irm/resources/{row.id}"
    for actor in (other, moderator):
        assert client.delete(path, cookies={"session": _token(db_session, actor)}).status_code == 403
    winner = owner if kind in (ResourceKind.PDF, ResourceKind.YOUTUBE) else delegate
    reply = client.delete(path, cookies={"session": _token(db_session, winner)})
    assert reply.status_code == 204, reply.text
    assert client.delete(path, cookies={"session": _token(db_session, winner)}).status_code == 404
    db_session.expire_all()
    retained = db_session.get(Document, row.id)
    assert retained is not None and retained.removed_at is not None and retained.removed_by_id == winner.id
    assert (retained.id, retained.type, retained.storage_path, retained.image_storage_key,
            retained.source, retained.status) == original
    if retained.storage_path:
        assert storage.read(retained.storage_path) == b"retained-file-bytes"
    assert db_session.query(DocumentVote).filter_by(document_id=row.id).count() == 1
    assert db_session.get(SavedDocument, saved_id) is not None
    assert db_session.get(DocumentReading, reading_id) is not None
    assert db_session.query(ManagementEvent).filter_by(target_type="module_resource",
        target_id=row.id, action="remove").count() == 1
    assert client.get(f"/api/v1/communities/irm/resources/mine", cookies={"session": _token(db_session, owner)}).json()["items"] == []
    assert client.get(f"/api/v1/communities/irm/resources/pending", cookies={"session": _token(db_session, owner)}).json()["items"] == []
    assert client.get(f"{path}/preview", cookies={"session": _token(db_session, owner)}).status_code == 404
    assert client.post(f"{path}/vote", json={"vote": "NO"}, cookies={"session": _token(db_session, moderator)}).status_code == 404
    assert client.post(f"{path}/approve", json={}, cookies={"session": _token(db_session, moderator)}).status_code == 404
    if kind in (ResourceKind.PDF, ResourceKind.IMAGE):
        assert client.get(f"/api/v1/documents/{row.id}/download", cookies={"session": _token(db_session, owner)}).status_code == 404
        assert client.get(f"/api/v1/documents/{row.id}/preview", cookies={"session": _token(db_session, owner)}).status_code == 404
        assert client.get("/api/v1/communities/irm/modules/algebra/documents", cookies={"session": _token(db_session, owner)}).json() == []


@pytest.mark.parametrize("kind", list(ResourceKind))
def test_approved_resource_cannot_be_removed_and_mine_capability_is_false(client, db_session, kind):
    community = _community(db_session)
    module = _module(db_session, community)
    owner = _user(db_session, "approved_delete_owner")
    delegate = _user(db_session, "approved_delete_delegate")
    moderator = _user(db_session, "approved_delete_moderator")
    _membership(db_session, owner, community)
    _membership(db_session, delegate, community, MembershipRole.DELEGATE)
    _membership(db_session, moderator, community, MembershipRole.MODERATOR)
    row = _seed_removable(db_session, module, owner, kind, DocumentStatus.APPROVED)
    path = f"/api/v1/communities/irm/resources/{row.id}"
    for actor, expected in ((owner, 409), (delegate, 409), (moderator, 403)):
        assert client.delete(path, cookies={"session": _token(db_session, actor)}).status_code == expected
    assert client.get("/api/v1/communities/irm/resources/mine", cookies={"session": _token(db_session, owner)}).json()["items"][0]["can_delete"] is False
    db_session.expire_all()
    assert db_session.get(Document, row.id).removed_at is None
    assert db_session.query(ManagementEvent).filter_by(target_id=row.id, action="remove").count() == 0


def test_moderator_may_remove_only_own_unapproved_resource(client, db_session):
    community = _community(db_session)
    module = _module(db_session, community)
    moderator = _user(db_session, "delete_moderator_owner")
    _membership(db_session, moderator, community, MembershipRole.MODERATOR)
    row = _seed_removable(db_session, module, moderator, ResourceKind.IMAGE, DocumentStatus.REJECTED)
    reply = client.delete(f"/api/v1/communities/irm/resources/{row.id}",
                          cookies={"session": _token(db_session, moderator)})
    assert reply.status_code == 204
    approved = _seed_removable(db_session, module, moderator, ResourceKind.PDF,
                               DocumentStatus.APPROVED)
    assert client.delete(f"/api/v1/communities/irm/resources/{approved.id}",
                         cookies={"session": _token(db_session, moderator)}).status_code == 409


def test_canonical_image_removal_retains_stored_bytes(client, db_session, storage):
    from uuid import uuid4
    community = _community(db_session)
    module = _module(db_session, community)
    owner = _user(db_session, "canonical_delete_owner")
    _membership(db_session, owner, community)
    resource_id = uuid4()
    output = BytesIO()
    Image.new("RGB", (2, 2), (12, 34, 56)).save(output, format="WEBP")
    content = output.getvalue()
    key = storage.save_module_resource_image(community.id, module.id, resource_id, content)
    row = Document(id=resource_id, module_id=module.id, uploader_id=owner.id, title="Image",
                   resource_kind=ResourceKind.IMAGE, type=DocumentType.TP,
                   source=DocumentSource.STUDENT, status=DocumentStatus.PENDING,
                   vote_threshold_snapshot=2, image_storage_key=key)
    db_session.add(row)
    db_session.commit()
    assert client.delete(f"/api/v1/communities/irm/resources/{resource_id}",
                         cookies={"session": _token(db_session, owner)}).status_code == 204
    assert storage.read_module_resource_image_bounded(key, community.id, module.id,
                                                       resource_id, len(content) + 1) == content
    db_session.expire_all()
    assert db_session.get(Document, resource_id).image_storage_key == key


@pytest.mark.parametrize("inactive", [MembershipStatus.PENDING, MembershipStatus.REMOVED,
                                      MembershipStatus.BANNED])
def test_resource_removal_requires_active_owning_community_membership_and_origin(client, db_session, inactive):
    community = _community(db_session)
    module = _module(db_session, community)
    owner = _user(db_session, "scoped_delete_owner")
    foreign_delegate = _user(db_session, "foreign_delete_delegate")
    _membership(db_session, owner, community, state=inactive)
    foreign = _community(db_session, "foreign")
    _membership(db_session, foreign_delegate, foreign, MembershipRole.DELEGATE)
    row = _seed_removable(db_session, module, owner, ResourceKind.YOUTUBE, DocumentStatus.PENDING)
    path = f"/api/v1/communities/irm/resources/{row.id}"
    assert client.delete(path).status_code == 401
    assert client.delete(path, cookies={"session": _token(db_session, owner)}).status_code == 403
    assert client.delete(path, cookies={"session": _token(db_session, foreign_delegate)}).status_code == 404
    assert client.delete(path.replace("/irm/", "/foreign/"), cookies={"session": _token(db_session, foreign_delegate)}).status_code == 404
    _membership(db_session, foreign_delegate, community, MembershipRole.MODERATOR)
    assert client.delete(path, cookies={"session": _token(db_session, foreign_delegate)},
                         headers={"Origin": "https://evil.test"}).status_code == 403
    assert client.request("DELETE", path, json={},
                          cookies={"session": _token(db_session, foreign_delegate)}).status_code == 422
    db_session.expire_all()
    assert db_session.get(Document, row.id).removed_at is None


def test_typed_mine_and_pending_capability_cover_all_kinds(client, db_session):
    community = _community(db_session)
    module = _module(db_session, community)
    owner = _user(db_session, "mine_resource_owner")
    delegate = _user(db_session, "mine_resource_delegate")
    member = _user(db_session, "mine_resource_member")
    _membership(db_session, owner, community)
    _membership(db_session, delegate, community, MembershipRole.DELEGATE)
    _membership(db_session, member, community)
    rows = [_seed_removable(db_session, module, owner, kind, DocumentStatus.PENDING)
            for kind in ResourceKind]
    rows.append(_seed_removable(db_session, module, owner, ResourceKind.LINK, DocumentStatus.REJECTED))
    rows.append(_seed_removable(db_session, module, owner, ResourceKind.PDF, DocumentStatus.APPROVED))
    mine = client.get("/api/v1/communities/irm/resources/mine", cookies={"session": _token(db_session, owner)})
    assert mine.status_code == 200
    assert {item["kind"] for item in mine.json()["items"]} == {kind.value for kind in ResourceKind}
    assert all(item["can_delete"] == (item["status"] != "APPROVED") for item in mine.json()["items"])
    pending = client.get("/api/v1/communities/irm/resources/pending", cookies={"session": _token(db_session, delegate)})
    assert pending.status_code == 200
    assert len(pending.json()["items"]) == 4
    assert all(item["can_delete"] for item in pending.json()["items"])
    member_feed = client.get("/api/v1/communities/irm/resources/pending", cookies={"session": _token(db_session, member)})
    assert all(not item["can_delete"] for item in member_feed.json()["items"])
    assert client.get("/api/v1/communities/irm/resources/mine?status=REJECTED",
                      cookies={"session": _token(db_session, owner)}).json()["items"][0]["id"] == str(rows[4].id)
    first = client.get("/api/v1/communities/irm/resources/mine?limit=2",
                       cookies={"session": _token(db_session, owner)}).json()
    assert len(first["items"]) == 2 and first["next_cursor"]
    second = client.get(f"/api/v1/communities/irm/resources/mine?limit=2&after={first['next_cursor']}",
                        cookies={"session": _token(db_session, owner)}).json()
    assert len(second["items"]) == 2
    assert not set(item["id"] for item in first["items"]) & set(item["id"] for item in second["items"])
    assert client.get(f"/api/v1/communities/irm/resources/mine?status=REJECTED&after={rows[0].id}",
                      cookies={"session": _token(db_session, owner)}).status_code == 404
    assert client.get(f"/api/v1/communities/irm/resources/mine?after={first['next_cursor']}",
                      cookies={"session": _token(db_session, member)}).status_code == 404
    assert client.get("/api/v1/communities/irm/documents/mine",
                      cookies={"session": _token(db_session, owner)}).json()["items"]


def test_resource_removal_audit_failure_rolls_back(client, db_session):
    from sqlalchemy import event
    from sqlalchemy.orm import Session
    community = _community(db_session)
    module = _module(db_session, community)
    owner = _user(db_session, "delete_audit_owner")
    _membership(db_session, owner, community)
    row = _seed_removable(db_session, module, owner, ResourceKind.LINK, DocumentStatus.PENDING)

    def fail_audit(session, *_args):
        if any(isinstance(item, ManagementEvent) and item.action == "remove" for item in session.new):
            raise RuntimeError("injected removal audit failure")

    event.listen(Session, "before_flush", fail_audit)
    try:
        reply = client.delete(f"/api/v1/communities/irm/resources/{row.id}",
                              cookies={"session": _token(db_session, owner)})
        assert reply.status_code == 500
    finally:
        event.remove(Session, "before_flush", fail_audit)
    db_session.expire_all()
    assert db_session.get(Document, row.id).removed_at is None
    assert db_session.query(ManagementEvent).filter_by(target_id=row.id, action="remove").count() == 0


def test_removed_marker_conceals_legacy_saved_recent_and_media_reads(client, db_session):
    community = _community(db_session)
    module = _module(db_session, community)
    owner = _user(db_session, "removed_visibility_owner")
    _membership(db_session, owner, community)
    row = _seed_removable(db_session, module, owner, ResourceKind.PDF, DocumentStatus.APPROVED)
    db_session.add_all([
        SavedDocument(user_id=owner.id, document_id=row.id),
        DocumentReading(user_id=owner.id, document_id=row.id, last_page=2),
    ])
    row.removed_at = datetime.now(timezone.utc)
    row.removed_by_id = owner.id
    db_session.commit()
    token = _token(db_session, owner)
    assert client.get("/api/v1/communities/irm/modules/algebra/resources",
                      cookies={"session": token}).json()["items"] == []
    assert client.get("/api/v1/communities/irm/modules/algebra/documents",
                      cookies={"session": token}).json() == []
    assert client.get("/api/v1/communities/irm/documents/saved",
                      cookies={"session": token}).json()["items"] == []
    assert client.get("/api/v1/communities/irm/documents/recent",
                      cookies={"session": token}).json()["items"] == []
    assert client.delete(f"/api/v1/communities/irm/documents/{row.id}/saved",
                         cookies={"session": token}).status_code == 200
    assert db_session.query(SavedDocument).filter_by(document_id=row.id).count() == 1
    assert client.get(f"/api/v1/communities/irm/modules/algebra/documents/{row.id}",
                      cookies={"session": token}).status_code == 404
    for suffix in ("preview", "download", "view"):
        assert client.get(f"/api/v1/documents/{row.id}/{suffix}",
                          cookies={"session": token}).status_code == 404
    assert client.get(f"/api/v1/communities/irm/resources/{row.id}/preview",
                      cookies={"session": token}).status_code == 404
    assert client.post(f"/api/v1/communities/irm/documents/{row.id}/reading/open",
                       cookies={"session": token}).status_code == 404


def test_image_resource_creation_preview_membership_and_legacy_list_isolation(
    client, db_session, storage
):
    community, uploader = _community(db_session), _user(db_session, "resource_image_uploader")
    module = _module(db_session, community)
    _membership(db_session, uploader, community)
    token = _token(db_session, uploader)
    response = client.post(
        "/api/v1/communities/irm/modules/algebra/resources",
        data={"kind": "IMAGE", "title": "  Diagram  ", "description": " ", "source": "STUDENT"},
        files={"file": ("user-name.png", _png(), "image/png")},
        cookies={"session": token},
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["kind"] == "IMAGE" and payload["title"] == "Diagram"
    assert payload["category"] is None
    assert payload["description"] is None and payload["status"] == "PENDING"
    resource_id = UUID(payload["id"])
    row = db_session.get(Document, resource_id)
    assert row.resource_kind == ResourceKind.IMAGE
    assert row.type is None
    assert row.storage_path is None and row.preview_path is None
    assert row.image_storage_key and row.vote_threshold_snapshot == 2
    assert storage.exists(row.image_storage_key)

    # New image and URL resources do not enter legacy file lists.
    assert client.get("/api/v1/communities/irm/modules/algebra/documents",
                      cookies={"session": token}).json() == []
    pending_response = client.get("/api/v1/communities/irm/modules/algebra/resources",
                                  cookies={"session": token})
    assert pending_response.status_code == 200
    assert pending_response.json() == {"items": [], "next_cursor": None}

    preview_path = f"/api/v1/communities/irm/resources/{resource_id}/preview"
    guest_preview = client.get(preview_path)
    assert guest_preview.status_code == 401
    outsider = _user(db_session, "resource_image_outsider")
    outsider_token = _token(db_session, outsider)
    assert client.get(preview_path, cookies={"session": outsider_token}).status_code == 404
    preview = client.get(preview_path, cookies={"session": token})
    assert preview.status_code == 200
    assert preview.headers["content-type"].startswith("image/webp")
    assert preview.headers["cache-control"] == "private, no-store"
    assert preview.headers["x-content-type-options"] == "nosniff"
    assert "Cookie" in preview.headers["vary"]

    # URL resources cannot use legacy document file endpoints or the old vote route.
    link = client.post(
        "/api/v1/communities/irm/modules/algebra/resources",
        json={"kind": "LINK", "title": "Study guide", "url": "https://example.com/guide"},
        cookies={"session": token},
    )
    assert link.status_code == 201
    link_id = link.json()["id"]
    assert link.json()["status"] == "PENDING"
    assert db_session.get(Document, UUID(link_id)).type is None
    assert client.get(f"/api/v1/documents/{link_id}/download", cookies={"session": token}).status_code == 404
    assert client.get(f"/api/v1/documents/{link_id}/preview", cookies={"session": token}).status_code == 404
    assert client.post(f"/api/v1/documents/{link_id}/vote", json={"vote": "YES"},
                       cookies={"session": token}).status_code == 409


def test_url_resources_are_validated_and_approved_listing_is_filterable_and_paged(
    client, db_session
):
    community = _community(db_session)
    module = _module(db_session, community)
    delegate = _user(db_session, "resource_url_delegate")
    _membership(db_session, delegate, community, role=MembershipRole.DELEGATE)
    token = _token(db_session, delegate)
    yt = client.post(
        "/api/v1/communities/irm/modules/algebra/resources",
        json={"kind": "YOUTUBE", "title": "Video", "source": "OFFICIAL",
              "url": "https://youtu.be/dQw4w9WgXcQ"},
        cookies={"session": token},
    )
    assert yt.status_code == 201, yt.text
    assert yt.json()["video_id"] == "dQw4w9WgXcQ"
    assert yt.json()["url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert yt.json()["status"] == "APPROVED"

    second = client.post(
        "/api/v1/communities/irm/modules/algebra/resources",
        json={"kind": "LINK", "title": "Notes", "source": "OFFICIAL",
              "url": "https://Example.com/notes"},
        cookies={"session": token},
    )
    assert second.status_code == 201, second.text
    assert second.json()["url"] == "https://example.com/notes"
    first_page = client.get("/api/v1/communities/irm/modules/algebra/resources?limit=1",
                            cookies={"session": token})
    assert first_page.status_code == 200
    assert len(first_page.json()["items"]) == 1
    assert first_page.json()["next_cursor"] is not None
    # Cursor is scoped to its active kind filter, so a YouTube cursor is hidden
    # when used under LINK.
    mismatched_cursor = client.get(
        "/api/v1/communities/irm/modules/algebra/resources?kind=LINK&after="
        + yt.json()["id"], cookies={"session": token},
    )
    assert mismatched_cursor.status_code == 404
    filtered = client.get("/api/v1/communities/irm/modules/algebra/resources?kind=YOUTUBE&q=Video",
                          cookies={"session": token})
    assert [item["id"] for item in filtered.json()["items"]] == [yt.json()["id"]]

    preview = client.get(f"/api/v1/communities/irm/resources/{yt.json()['id']}/preview",
                         cookies={"session": token})
    assert preview.status_code == 200
    assert preview.json() == {"kind": "YOUTUBE", "title": "Video", "description": None,
                              "video_id": "dQw4w9WgXcQ",
                              "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
    viewer = _user(db_session, "resource_approved_viewer")
    viewer_token = _token(db_session, viewer)
    assert client.get(f"/api/v1/communities/irm/resources/{yt.json()['id']}/preview",
                      cookies={"session": viewer_token}).status_code == 200

    for bad_url in (
        "http://example.com", "https://user@example.com", "https://evil.local",
        "https://youtube.com.evil/watch?v=dQw4w9WgXcQ",
    ):
        bad = client.post(
            "/api/v1/communities/irm/modules/algebra/resources",
            json={"kind": "LINK", "title": "Bad", "url": bad_url},
            cookies={"session": token},
        )
        assert bad.status_code == 422


def test_resource_upload_role_source_rules_and_kind_fields(client, db_session, monkeypatch):
    community = _community(db_session)
    _module(db_session, community)
    moderator = _user(db_session, "resource_moderator")
    _membership(db_session, moderator, community, role=MembershipRole.MODERATOR)
    token = _token(db_session, moderator)
    official = client.post(
        "/api/v1/communities/irm/modules/algebra/resources",
        data={"kind": "IMAGE", "title": "Official image", "source": "OFFICIAL"},
        files={"file": ("one.png", _png(), "image/png")}, cookies={"session": token},
    )
    assert official.status_code == 403

    typed_image = client.post(
        "/api/v1/communities/irm/modules/algebra/resources",
        data={"kind": "IMAGE", "title": "Student image", "type": "COURSE", "source": "STUDENT"},
        files={"file": ("one.png", _png(), "image/png")}, cookies={"session": token},
    )
    assert typed_image.status_code == 201
    assert typed_image.json()["category"] == "COURSE"
    assert typed_image.json()["status"] == "PENDING"
    missing_source = client.post(
        "/api/v1/communities/irm/modules/algebra/resources",
        json={"kind": "LINK", "title": "Staff link", "url": "https://example.com"},
        cookies={"session": token},
    )
    assert missing_source.status_code == 422

    db_session.add(MembershipPermission(
        membership_id=db_session.query(Membership).filter_by(user_id=moderator.id).one().id,
        permission=PermissionType.UPLOAD_OFFICIAL_DOCUMENTS,
    ))
    db_session.commit()
    allowed = client.post(
        "/api/v1/communities/irm/modules/algebra/resources",
        json={"kind": "LINK", "title": "Staff link", "source": "OFFICIAL",
              "url": "https://example.com", "type": "TD"}, cookies={"session": token},
    )
    assert allowed.status_code == 201
    assert allowed.json()["status"] == "APPROVED"
    assert allowed.json()["category"] == "TD" and allowed.json()["source"] == "OFFICIAL"


@pytest.mark.parametrize("kind", ["PDF", "IMAGE", "YOUTUBE", "LINK"])
@pytest.mark.parametrize("source", ["STUDENT", "OFFICIAL"])
def test_delegate_creation_publishes_without_changing_source_or_review_history(
    client, db_session, storage, monkeypatch, kind, source,
):
    import fitz
    import app.services.document as document_service

    monkeypatch.setattr(document_service, "storage", storage)
    community = _community(db_session)
    _module(db_session, community)
    delegate = _user(db_session, f"publish_{kind}_{source}")
    _membership(db_session, delegate, community, MembershipRole.DELEGATE)
    token = _token(db_session, delegate)
    path = "/api/v1/communities/irm/modules/algebra/resources"
    values = {"kind": kind, "title": f"{kind} notes", "type": "TD", "source": source}
    if kind == "PDF":
        pdf = fitz.open()
        pdf.new_page()
        content = pdf.write()
        pdf.close()
        result = client.post(path, data=values,
                             files={"file": ("notes.pdf", content, "application/pdf")},
                             cookies={"session": token})
    elif kind == "IMAGE":
        result = client.post(path, data=values,
                             files={"file": ("notes.png", _png(), "image/png")},
                             cookies={"session": token})
    else:
        url = "https://youtu.be/dQw4w9WgXcQ" if kind == "YOUTUBE" else "https://example.com/notes"
        result = client.post(path, json={**values, "url": url}, cookies={"session": token})
    assert result.status_code == 201, result.text
    body = result.json()
    assert (body["kind"], body["category"], body["source"], body["status"]) == (
        kind, "TD", source, "APPROVED")
    if kind == "PDF":
        assert body["document_type"] == "TD"
    resource_id = UUID(body["id"])
    row = db_session.get(Document, resource_id)
    assert row.status == DocumentStatus.APPROVED and row.removed_at is None
    assert db_session.query(DocumentVote).filter_by(document_id=resource_id).count() == 0
    assert db_session.query(ManagementEvent).filter_by(target_id=resource_id).count() == 0
    approved = client.get(path, cookies={"session": token})
    assert approved.status_code == 200
    assert body["id"] in {item["id"] for item in approved.json()["items"]}
    pending = client.get("/api/v1/communities/irm/resources/pending", cookies={"session": token})
    assert pending.status_code == 200
    assert body["id"] not in {item["id"] for item in pending.json()["items"]}
    own = client.get("/api/v1/communities/irm/resources/mine", cookies={"session": token})
    assert own.status_code == 200
    assert next(item for item in own.json()["items"] if item["id"] == body["id"])["can_delete"] is False
    delete = client.delete(f"/api/v1/communities/irm/resources/{resource_id}", cookies={"session": token})
    assert delete.status_code == 409
    vote = client.post(f"/api/v1/communities/irm/resources/{resource_id}/vote",
                       json={"vote": "YES"}, cookies={"session": token})
    assert vote.status_code == 409


def test_delegate_creation_rechecks_current_membership_and_rejects_status_fields(client, db_session):
    community = _community(db_session)
    _module(db_session, community)
    actor = _user(db_session, "creation_demoted_delegate")
    membership = _membership(db_session, actor, community, MembershipRole.DELEGATE)
    token = _token(db_session, actor)
    path = "/api/v1/communities/irm/modules/algebra/resources"
    values = {"kind": "LINK", "title": "Notes", "type": "TD", "source": "STUDENT",
              "url": "https://example.org/notes"}
    for field in ("status", "role", "approved_by_id"):
        result = client.post(path, json={**values, field: "APPROVED"}, cookies={"session": token})
        assert result.status_code == 422
    membership.role = MembershipRole.MODERATOR
    db_session.commit()
    demoted = client.post(path, json=values, cookies={"session": token})
    assert demoted.status_code == 201 and demoted.json()["status"] == "PENDING"
    membership.status = MembershipStatus.REJECTED
    db_session.commit()
    inactive = client.post(path, json=values, cookies={"session": token})
    assert inactive.status_code == 403


@pytest.mark.parametrize("kind", ["PDF", "IMAGE", "YOUTUBE", "LINK"])
@pytest.mark.parametrize("role", [MembershipRole.MEMBER, MembershipRole.MODERATOR])
def test_non_delegate_student_creation_keeps_review_policy(
    client, db_session, storage, monkeypatch, kind, role,
):
    import fitz
    import app.services.document as document_service

    monkeypatch.setattr(document_service, "storage", storage)
    community = _community(db_session)
    _module(db_session, community)
    foreign = _community(db_session, "foreign")
    actor = _user(db_session, f"review_{role.value}_{kind}")
    _membership(db_session, actor, community, role)
    if role == MembershipRole.MEMBER:
        _membership(db_session, actor, foreign, MembershipRole.DELEGATE)
    token = _token(db_session, actor)
    path = "/api/v1/communities/irm/modules/algebra/resources"
    values = {"kind": kind, "title": f"{kind} review", "type": "TP", "source": "STUDENT"}
    if kind == "PDF":
        pdf = fitz.open()
        pdf.new_page()
        content = pdf.write()
        pdf.close()
        result = client.post(path, data=values,
                             files={"file": ("review.pdf", content, "application/pdf")},
                             cookies={"session": token})
    elif kind == "IMAGE":
        result = client.post(path, data=values,
                             files={"file": ("review.png", _png(), "image/png")},
                             cookies={"session": token})
    else:
        url = "https://youtu.be/dQw4w9WgXcQ" if kind == "YOUTUBE" else "https://example.org/notes"
        result = client.post(path, json={**values, "url": url}, cookies={"session": token})
    assert result.status_code == 201, result.text
    assert (result.json()["source"], result.json()["status"], result.json()["category"]) == (
        "STUDENT", "PENDING", "TP")
    row = db_session.get(Document, UUID(result.json()["id"]))
    assert row.vote_threshold_snapshot == community.document_vote_threshold


def test_academic_category_creation_for_all_kinds_and_validation(client, db_session, storage):
    import fitz

    community = _community(db_session)
    _module(db_session, community)
    student = _user(db_session, "category_student")
    _membership(db_session, student, community)
    token = _token(db_session, student)
    path = "/api/v1/communities/irm/modules/algebra/resources"
    pdf = fitz.open()
    pdf.new_page()
    pdf_bytes = pdf.write()
    pdf.close()

    for kind, content, mime in (("PDF", pdf_bytes, "application/pdf"),
                                ("IMAGE", _png(), "image/png")):
        result = client.post(path, data={"kind": kind, "title": f"{kind} TD", "type": "TD"},
                             files={"file": (f"asset.{kind.lower()}", content, mime)},
                             cookies={"session": token})
        assert result.status_code == 201, result.text
        assert result.json()["category"] == "TD"
        assert result.json()["kind"] == kind
        assert result.json()["source"] == "STUDENT" and result.json()["status"] == "PENDING"
        assert db_session.get(Document, UUID(result.json()["id"])).type == DocumentType.TD
        if kind == "PDF":
            assert result.json()["document_type"] == "TD"

    for kind, url in (("YOUTUBE", "https://youtu.be/dQw4w9WgXcQ"),
                      ("LINK", "https://example.com/td")):
        result = client.post(path, json={"kind": kind, "title": f"{kind} TD",
                                         "url": url, "type": "TD"}, cookies={"session": token})
        assert result.status_code == 201, result.text
        assert result.json()["category"] == "TD"
        assert result.json()["source"] == "STUDENT" and result.json()["status"] == "PENDING"
        assert db_session.get(Document, UUID(result.json()["id"])).type == DocumentType.TD

    for kind, url in (("YOUTUBE", "https://youtu.be/dQw4w9WgXcQ"),
                      ("LINK", "https://example.com/notes")):
        result = client.post(path, json={"kind": kind, "title": "Unclassified", "url": url,
                                         "type": None}, cookies={"session": token})
        assert result.status_code == 201 and result.json()["category"] is None

    bad_pdf = client.post(path, data={"kind": "PDF", "title": "Missing"},
                          files={"file": ("a.pdf", pdf_bytes, "application/pdf")},
                          cookies={"session": token})
    assert bad_pdf.status_code == 422
    invalid_pdf = client.post(path, data={"kind": "PDF", "title": "Invalid", "type": "UNKNOWN"},
                              files={"file": ("a.pdf", pdf_bytes, "application/pdf")},
                              cookies={"session": token})
    assert invalid_pdf.status_code == 422
    for value in ("", "UNKNOWN"):
        bad_json = client.post(path, json={"kind": "LINK", "title": "Invalid",
                                           "url": "https://example.com", "type": value},
                               cookies={"session": token})
        bad_file = client.post(path, data={"kind": "IMAGE", "title": "Invalid", "type": value},
                               files={"file": ("a.png", _png(), "image/png")},
                               cookies={"session": token})
        assert bad_json.status_code == bad_file.status_code == 422
    duplicate = client.post(path, files=[("kind", (None, "IMAGE")),
                                         ("title", (None, "Duplicate")),
                                         ("type", (None, "TD")), ("type", (None, "TP")),
                                         ("file", ("a.png", _png(), "image/png"))],
                            cookies={"session": token})
    assert duplicate.status_code == 422
    invalid_null_text = client.post(path, data={"kind": "IMAGE", "title": "Invalid", "type": "null"},
                                    files={"file": ("a.png", _png(), "image/png")},
                                    cookies={"session": token})
    assert invalid_null_text.status_code == 422


def test_category_filter_intersects_kind_search_source_and_cursor(client, db_session):
    community = _community(db_session)
    module = _module(db_session, community)
    other_module = _module(db_session, community, "other")
    other_community = _community(db_session, "another")
    foreign_module = _module(db_session, other_community, "algebra")
    user = _user(db_session, "category_browser")
    token = _token(db_session, user)
    rows = []
    for index, (kind, category, source, status, title, owner_module) in enumerate((
        (ResourceKind.PDF, DocumentType.TD, DocumentSource.OFFICIAL, DocumentStatus.APPROVED, "TD waves", module),
        (ResourceKind.IMAGE, DocumentType.TD, DocumentSource.STUDENT, DocumentStatus.APPROVED, "TD waves", module),
        (ResourceKind.YOUTUBE, DocumentType.TD, DocumentSource.STUDENT, DocumentStatus.APPROVED, "TD waves", module),
        (ResourceKind.LINK, DocumentType.TD, DocumentSource.STUDENT, DocumentStatus.APPROVED, "TD waves", module),
        (ResourceKind.LINK, None, DocumentSource.OFFICIAL, DocumentStatus.APPROVED, "Unclassified", module),
        (ResourceKind.LINK, DocumentType.TP, DocumentSource.OFFICIAL, DocumentStatus.APPROVED, "TP waves", module),
        (ResourceKind.LINK, DocumentType.TD, DocumentSource.STUDENT, DocumentStatus.PENDING, "TD hidden", module),
        (ResourceKind.LINK, DocumentType.TD, DocumentSource.STUDENT, DocumentStatus.REJECTED, "TD removed", module),
        (ResourceKind.LINK, DocumentType.TD, DocumentSource.STUDENT, DocumentStatus.APPROVED, "TD other", other_module),
        (ResourceKind.LINK, DocumentType.TD, DocumentSource.STUDENT, DocumentStatus.APPROVED, "TD foreign", foreign_module),
    )):
        row = Document(module_id=owner_module.id, uploader_id=user.id, title=title,
                       type=category, source=source, status=status, resource_kind=kind,
                       storage_path="test.pdf" if kind == ResourceKind.PDF else None,
                       image_storage_key=f"image-{index}" if kind == ResourceKind.IMAGE else None,
                       youtube_video_id="dQw4w9WgXcQ" if kind == ResourceKind.YOUTUBE else None,
                       external_url="https://example.com" if kind == ResourceKind.LINK else None,
                       vote_threshold_snapshot=2 if status == DocumentStatus.PENDING else None)
        rows.append(row)
    db_session.add_all(rows)
    db_session.commit()
    path = "/api/v1/communities/irm/modules/algebra/resources"
    get = lambda query="": client.get(path + query, cookies={"session": token})
    unfiltered = get().json()["items"]
    assert len(unfiltered) == 6
    assert any(item["category"] is None for item in unfiltered)
    expected_td = {str(row.id) for row in rows[:4]}
    td = get("?category=TD")
    assert td.status_code == 200
    assert {item["id"] for item in td.json()["items"]} == expected_td
    assert {item["kind"] for item in td.json()["items"]} == {"PDF", "IMAGE", "YOUTUBE", "LINK"}
    assert {item["id"] for item in get("?kind=LINK").json()["items"]} == {str(rows[3].id), str(rows[4].id), str(rows[5].id)}
    assert [item["id"] for item in get("?category=TD&kind=LINK").json()["items"]] == [str(rows[3].id)]
    assert {item["id"] for item in get("?category=TD&q=waves&source=STUDENT").json()["items"]} == {str(row.id) for row in rows[1:4]}
    page = get("?category=TD&limit=2").json()
    following = get(f"?category=TD&limit=2&after={page['next_cursor']}").json()
    assert len(page["items"]) == len(following["items"]) == 2
    assert {item["id"] for item in page["items"] + following["items"]} == expected_td
    assert following["next_cursor"] is None
    assert get(f"?category=TP&after={page['next_cursor']}").status_code == 404
    assert get(f"?category=TD&kind=LINK&after={page['next_cursor']}").status_code == 404
    assert client.get(f"/api/v1/communities/irm/modules/other/resources?category=TD&after={page['next_cursor']}",
                      cookies={"session": token}).status_code == 404
    assert get("?category=INVALID").status_code == 422


@pytest.mark.parametrize("kind,extra", [
    (ResourceKind.PDF, {"storage_path": None}),
    (ResourceKind.IMAGE, {"storage_path": None, "image_storage_key": None}),
    (ResourceKind.YOUTUBE, {"youtube_video_id": None}),
    (ResourceKind.LINK, {"external_url": None}),
])
def test_model_rejects_missing_kind_payload(db_session, kind, extra):
    community = _community(db_session)
    module = _module(db_session, community)
    user = _user(db_session, f"resource_constraint_{kind.value.lower()}")
    values = dict(
        module_id=module.id, uploader_id=user.id, title="Invalid payload",
        type=DocumentType.OTHER, source=DocumentSource.OFFICIAL,
        status=DocumentStatus.APPROVED, resource_kind=kind,
        storage_path="legacy/file.pdf",
    )
    values.update(extra)
    db_session.add(Document(**values))
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()


@pytest.mark.parametrize("uncertain,expected_status,expect_file", [(False, 500, False), (True, 503, True)])
def test_image_resource_commit_failure_cleans_only_confirmed_rollback(
    client, db_session, storage, tmp_path, monkeypatch,
    uncertain, expected_status, expect_file,
):
    community = _community(db_session)
    _module(db_session, community)
    user = _user(db_session, f"resource_commit_{uncertain}")
    _membership(db_session, user, community)
    token = _token(db_session, user)

    def failing_db():
        db = TestingSessionLocal()
        def fail_commit():
            raise RuntimeError("commit response lost")
        db.commit = fail_commit
        if uncertain:
            def fail_rollback():
                raise RuntimeError("rollback outcome unknown")
            db.rollback = fail_rollback
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = failing_db
    response = client.post(
        "/api/v1/communities/irm/modules/algebra/resources",
        data={"kind": "IMAGE", "title": "Failure case"},
        files={"file": ("asset.png", _png(), "image/png")},
        cookies={"session": token},
    )
    assert response.status_code == expected_status
    stored = list(tmp_path.rglob("*.webp"))
    assert bool(stored) is expect_file


def test_pending_feed_vote_approval_and_legacy_boundary(client, db_session):
    community = _community(db_session)
    module = _module(db_session, community)
    uploader = _user(db_session, "review_uploader")
    voter_a = _user(db_session, "review_voter_a")
    voter_b = _user(db_session, "review_voter_b")
    voter_c = _user(db_session, "review_voter_c")
    staff = _user(db_session, "review_moderator")
    for actor, role in ((uploader, MembershipRole.MEMBER),
                        (voter_a, MembershipRole.MEMBER),
                        (voter_b, MembershipRole.MEMBER),
                        (voter_c, MembershipRole.MEMBER),
                        (staff, MembershipRole.MODERATOR)):
        _membership(db_session, actor, community, role=role)
    tokens = {actor.username: _token(db_session, actor)
              for actor in (uploader, voter_a, voter_b, voter_c, staff)}

    rows = [
        Document(module_id=module.id, uploader_id=uploader.id, title="PDF", type=DocumentType.COURSE,
                 source=DocumentSource.STUDENT, status=DocumentStatus.PENDING,
                 resource_kind=ResourceKind.PDF, storage_path=f"{community.id}/{module.id}/sample.pdf",
                 vote_threshold_snapshot=2),
        Document(module_id=module.id, uploader_id=uploader.id, title="Image", type=DocumentType.TD,
                 source=DocumentSource.STUDENT, status=DocumentStatus.PENDING,
                 resource_kind=ResourceKind.IMAGE, image_storage_key=(
                     f"module-resources/{community.id}/{module.id}/{UUID(int=4)}/{UUID(int=5)}.webp"),
                 vote_threshold_snapshot=2),
        Document(module_id=module.id, uploader_id=uploader.id, title="Video", type=None,
                 source=DocumentSource.STUDENT, status=DocumentStatus.PENDING,
                 resource_kind=ResourceKind.YOUTUBE, youtube_video_id="dQw4w9WgXcQ",
                 vote_threshold_snapshot=2),
        Document(module_id=module.id, uploader_id=uploader.id, title="Link", type=None,
                 source=DocumentSource.STUDENT, status=DocumentStatus.PENDING,
                 resource_kind=ResourceKind.LINK, external_url="https://example.com/notes",
                 vote_threshold_snapshot=2),
    ]
    db_session.add_all(rows)
    db_session.commit()
    pdf, image, youtube, link = rows
    base = "/api/v1/communities/irm/resources"
    queue = client.get(f"{base}/pending?limit=2", cookies={"session": tokens[voter_a.username]})
    assert queue.status_code == 200, queue.text
    assert len(queue.json()["items"]) == 2 and queue.json()["next_cursor"]
    second = client.get(f"{base}/pending?limit=2&after={queue.json()['next_cursor']}",
                        cookies={"session": tokens[voter_a.username]})
    items = queue.json()["items"] + second.json()["items"]
    assert {item["kind"] for item in items} == {"PDF", "IMAGE", "YOUTUBE", "LINK"}
    assert {item["kind"]: item["category"] for item in items} == {
        "PDF": "COURSE", "IMAGE": "TD", "YOUTUBE": None, "LINK": None,
    }
    assert next(item for item in items if item["kind"] == "PDF")["document_type"] == "COURSE"
    assert all(item["can_vote"] and not item["can_approve"] and item["my_vote"] is None
               for item in items)
    assert all("storage_path" not in item and "vote_threshold_snapshot" not in item
               for item in items)
    assert next(item for item in items if item["kind"] == "IMAGE")["preview"]["media_type"] == "image/webp"
    assert next(item for item in items if item["kind"] == "PDF")["full_resource_access"] is False
    uploader_queue = client.get(f"{base}/pending", cookies={"session": tokens[uploader.username]})
    assert all(not item["can_vote"] and item["is_uploader"] for item in uploader_queue.json()["items"])
    staff_queue = client.get(f"{base}/pending", cookies={"session": tokens[staff.username]})
    assert all(item["can_approve"] for item in staff_queue.json()["items"])

    def vote(actor, resource, value):
        return client.post(f"{base}/{resource.id}/vote", json={"vote": value},
                           cookies={"session": tokens[actor.username]})

    assert vote(uploader, pdf, "YES").status_code == 403
    first_vote = vote(voter_a, pdf, "YES")
    assert first_vote.status_code == 200 and first_vote.json() == {
        "vote": "YES", "full_resource_access": True,
    }
    assert vote(voter_a, pdf, "NO").status_code == 409
    assert vote(voter_b, pdf, "NO").status_code == 200
    assert db_session.get(Document, pdf.id).status == DocumentStatus.PENDING
    after_tie = client.get(f"{base}/pending", cookies={"session": tokens[voter_a.username]})
    pdf_state = next(item for item in after_tie.json()["items"] if item["id"] == str(pdf.id))
    assert pdf_state["my_vote"] == "YES" and pdf_state["can_vote"] is False
    assert pdf_state["full_resource_access"] is True
    decisive = vote(voter_c, pdf, "YES")
    assert decisive.status_code == 200
    db_session.refresh(pdf)
    assert pdf.status == DocumentStatus.APPROVED and pdf.vote_threshold_snapshot == 2
    assert vote(staff, pdf, "YES").status_code == 409
    assert client.post(f"{base}/{pdf.id}/approve", json={},
                       cookies={"session": tokens[staff.username]}).status_code == 409

    denied = client.post(f"{base}/{link.id}/approve", json={},
                         cookies={"session": tokens[voter_a.username]})
    assert denied.status_code == 403
    approved = client.post(f"{base}/{link.id}/approve", json={},
                           cookies={"session": tokens[staff.username]})
    assert approved.status_code == 200 and approved.json() == {"id": str(link.id), "status": "APPROVED"}
    assert client.post(f"{base}/{link.id}/approve", json={},
                       cookies={"session": tokens[staff.username]}).status_code == 409
    assert vote(voter_a, link, "YES").status_code == 409
    db_session.refresh(link)
    assert link.vote_threshold_snapshot == 2 and link.status == DocumentStatus.APPROVED
    events = db_session.query(ManagementEvent).filter_by(target_type="module_resource", target_id=link.id).all()
    assert len(events) == 1 and events[0].action == "approve" and events[0].actor_id == staff.id
    assert db_session.query(DocumentVote).filter_by(document_id=link.id).count() == 0
    image_vote = vote(voter_a, image, "YES")
    assert image_vote.status_code == 200 and image_vote.json()["full_resource_access"] is True
    assert vote(voter_b, image, "YES").status_code == 200
    youtube_vote = vote(voter_a, youtube, "NO")
    assert youtube_vote.status_code == 200 and youtube_vote.json()["full_resource_access"] is True
    assert vote(voter_b, youtube, "NO").status_code == 200
    db_session.refresh(image)
    db_session.refresh(youtube)
    assert image.status == DocumentStatus.APPROVED and youtube.status == DocumentStatus.REJECTED
    legacy = client.get("/api/v1/communities/irm/modules/algebra/documents",
                        cookies={"session": tokens[voter_a.username]})
    assert legacy.status_code == 200 and [item["id"] for item in legacy.json()] == [str(pdf.id)]


@pytest.mark.parametrize("description", ["", " ", " leading", "trailing ", "x" * 2001])
def test_metadata_schema_rejects_invalid_descriptions(db_session, description):
    community = _community(db_session)
    module = _module(db_session, community)
    user = _user(db_session, "description_owner")
    db_session.add(Document(module_id=module.id, uploader_id=user.id, title="Description parity",
                            description=description, type=None, source=DocumentSource.OFFICIAL,
                            status=DocumentStatus.APPROVED, resource_kind=ResourceKind.LINK,
                            external_url="https://example.com"))
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()


def test_image_processing_operational_failure_is_sanitized_5xx(client, db_session, monkeypatch):
    from app.core.module_resources import ModuleResourceInputError
    from app.api.v1.endpoints import module_resources

    community = _community(db_session)
    _module(db_session, community)
    user = _user(db_session, "processing_failure_owner")
    _membership(db_session, user, community)
    token = _token(db_session, user)

    def fail_processing(*_args, **_kwargs):
        raise ModuleResourceInputError("image_processing_failed")

    monkeypatch.setattr(module_resources, "process_module_resource_image", fail_processing)
    response = client.post(
        "/api/v1/communities/irm/modules/algebra/resources",
        data={"kind": "IMAGE", "title": "Image"},
        files={"file": ("file.png", _png(), "image/png")},
        cookies={"session": token},
    )
    assert response.status_code == 500
    assert response.json() == {"detail": "Image processing unavailable"}
    assert response.headers["cache-control"] == "private, no-store"


def test_review_mutations_reject_untrusted_origin_and_oversized_body(client, db_session):
    community = _community(db_session)
    module = _module(db_session, community)
    actor = _user(db_session, "review_origin_actor")
    _membership(db_session, actor, community, role=MembershipRole.MODERATOR)
    token = _token(db_session, actor)
    row = Document(module_id=module.id, uploader_id=actor.id, title="Pending",
                   resource_kind=ResourceKind.LINK, external_url="https://example.com",
                   source=DocumentSource.STUDENT, status=DocumentStatus.PENDING,
                   vote_threshold_snapshot=2)
    db_session.add(row)
    db_session.commit()
    target = f"/api/v1/communities/irm/resources/{row.id}/approve"
    bad_origin = client.post(target, json={}, headers={"Origin": "https://evil.example"},
                             cookies={"session": token})
    assert bad_origin.status_code == 403
    assert bad_origin.headers["cache-control"] == "private, no-store"
    too_large = client.post(target, json={"padding": "x" * 17_000}, cookies={"session": token})
    assert too_large.status_code == 413
    invalid = client.post(target, json={"unexpected": True}, cookies={"session": token})
    assert invalid.status_code == 422
    assert db_session.query(ManagementEvent).filter_by(target_id=row.id).count() == 0
