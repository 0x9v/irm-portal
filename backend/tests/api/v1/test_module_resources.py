from datetime import timedelta
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
        data={"kind": "IMAGE", "title": "Student image", "type": "COURSE"},
        files={"file": ("one.png", _png(), "image/png")}, cookies={"session": token},
    )
    assert typed_image.status_code == 422
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
              "url": "https://example.com"}, cookies={"session": token},
    )
    assert allowed.status_code == 201
    assert allowed.json()["status"] == "APPROVED"


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
        Document(module_id=module.id, uploader_id=uploader.id, title="Image", type=None,
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
