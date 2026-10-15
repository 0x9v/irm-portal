import os
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from app.core.avatars import (
    InvalidAvatarStorageKey,
    avatar_url_from_storage_key,
    delete_avatar,
    generate_avatar_storage_key,
    parse_avatar_storage_key,
    read_avatar,
    store_avatar_jpeg,
)
from app.core.storage.exceptions import AvatarStorageError
from app.core.storage.local import LocalFileSystemStorage
from app.schemas.user import UserResponse
from app.models.user import User


JPEG = b"\xff\xd8synthetic-canonical-jpeg\xff\xd9"


@pytest.fixture
def storage(tmp_path):
    return LocalFileSystemStorage(storage_root=tmp_path)


def test_generated_key_projection_and_legacy_null(storage):
    owner = uuid4()
    key = generate_avatar_storage_key(owner)
    version = parse_avatar_storage_key(key, owner)
    assert UUID(key.split("/")[-1][:-4]) == version
    assert avatar_url_from_storage_key(owner, None) is None
    assert avatar_url_from_storage_key(owner, key) == f"/api/v1/users/{owner}/avatar/{version}"
    assert key not in avatar_url_from_storage_key(owner, key)


def test_user_response_exposes_only_projected_avatar_url():
    user = User(id=uuid4(), username="avatar_user", email="private@example.invalid", password_hash="hidden",
                first_name="Private", family_name="Name", created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc))
    response = UserResponse.model_validate(user)
    payload = response.model_dump()
    assert payload["avatar_url"] is None
    assert "avatar_storage_key" not in payload and "password_hash" not in payload

    key = generate_avatar_storage_key(user.id)
    user.avatar_storage_key = key
    payload = UserResponse.model_validate(user).model_dump()
    assert payload["avatar_url"] == avatar_url_from_storage_key(user.id, key)
    assert key not in str(payload)


@pytest.mark.parametrize("key", [
    "../avatars/00000000-0000-0000-0000-000000000000/11111111-1111-1111-1111-111111111111.jpg",
    "/avatars/00000000-0000-0000-0000-000000000000/11111111-1111-1111-1111-111111111111.jpg",
    "avatars/00000000-0000-0000-0000-000000000000/11111111-1111-1111-1111-111111111111.png",
    "avatars/00000000-0000-0000-0000-000000000000/11111111-1111-1111-1111-111111111111.jpg/extra",
    "avatars/00000000-0000-0000-0000-000000000000/../11111111-1111-1111-1111-111111111111.jpg",
])
def test_malformed_or_wrong_owner_key_fails_closed_without_io(storage, key):
    owner = uuid4()
    before = list(storage.root.rglob("*")) if storage.root.exists() else []
    assert avatar_url_from_storage_key(owner, key) is None
    with pytest.raises(InvalidAvatarStorageKey):
        read_avatar(storage, owner, key)
    with pytest.raises(InvalidAvatarStorageKey):
        delete_avatar(storage, owner, key)
    assert (list(storage.root.rglob("*")) if storage.root.exists() else []) == before


def test_durable_immutable_write_bounded_read_and_idempotent_delete(storage):
    owner = uuid4()
    key = store_avatar_jpeg(storage, owner, JPEG)
    path = storage.root / key
    assert path.read_bytes() == JPEG
    assert read_avatar(storage, owner, key) == JPEG
    assert delete_avatar(storage, owner, key) is True
    assert delete_avatar(storage, owner, key) is False


def test_immutable_versions_are_never_overwritten(storage):
    owner = uuid4()
    key = storage.save_avatar_immutable(owner, JPEG)
    with pytest.raises(AvatarStorageError) as error:
        # An adapter always generates a new key; directly force the impossible
        # collision at its private publication boundary to prove no overwrite.
        storage._publish_avatar_immutable(key, b"\xff\xd8different\xff\xd9")
    assert error.value.outcome == "immutable_exists"
    assert storage.read_avatar_bounded(key, 1024) == JPEG


def test_read_rejects_oversized_stored_file(storage):
    owner = uuid4()
    key = storage.save_avatar_immutable(owner, JPEG)
    with pytest.raises(AvatarStorageError) as error:
        storage.read_avatar_bounded(key, 8)
    assert error.value.outcome == "too_large"


def test_file_fsync_failure_cleans_only_task_owned_temp_and_published_file(storage, monkeypatch):
    owner = uuid4()
    original_fsync = os.fsync
    calls = 0

    def fail_file_fsync(descriptor):
        nonlocal calls
        calls += 1
        # Two fsyncs persist newly-created directory entries; the third is the file.
        if calls == 3:
            raise OSError("injected fsync failure")
        return original_fsync(descriptor)

    monkeypatch.setattr("app.core.storage.local.os.fsync", fail_file_fsync)
    with pytest.raises(AvatarStorageError) as error:
        storage.save_avatar_immutable(owner, JPEG)
    assert error.value.outcome == "durability_failed"
    assert not (storage.root / error.value.storage_key).exists()
    assert not list(storage.root.rglob(".avatar-tmp-*"))


def test_write_failure_cleans_task_owned_temporary_file(storage, monkeypatch):
    owner = uuid4()
    original_fdopen = os.fdopen

    class FailingStream:
        def __init__(self, descriptor):
            self.stream = original_fdopen(descriptor, "wb")

        def __enter__(self):
            return self

        def write(self, _content):
            raise OSError("injected write failure")

        def __exit__(self, *_args):
            self.stream.close()

    monkeypatch.setattr("app.core.storage.local.os.fdopen", lambda descriptor, _mode: FailingStream(descriptor))
    with pytest.raises(AvatarStorageError) as error:
        storage.save_avatar_immutable(owner, JPEG)
    assert error.value.outcome == "write_failed"
    assert error.value.storage_key is not None
    assert not (storage.root / error.value.storage_key).exists()
    assert not list(storage.root.rglob(".avatar-tmp-*"))


def test_publication_failure_cleans_temporary_file(storage, monkeypatch):
    owner = uuid4()
    monkeypatch.setattr("app.core.storage.local.os.link", lambda *args, **kwargs: (_ for _ in ()).throw(OSError("injected")))
    with pytest.raises(AvatarStorageError) as error:
        storage.save_avatar_immutable(owner, JPEG)
    assert error.value.outcome == "publication_failed"
    assert not (storage.root / error.value.storage_key).exists()
    assert not list(storage.root.rglob(".avatar-tmp-*"))


def test_avatar_delete_cannot_follow_symlink_into_document_namespace(storage):
    owner = uuid4()
    key = generate_avatar_storage_key(owner)
    document = storage.root / "documents" / "keep.pdf"
    document.parent.mkdir(parents=True)
    document.write_bytes(b"document")
    avatar_path = storage.root / key
    avatar_path.parent.mkdir(parents=True)
    avatar_path.symlink_to(document)

    with pytest.raises(AvatarStorageError) as error:
        delete_avatar(storage, owner, key)
    assert error.value.outcome == "unsafe_path"
    assert document.read_bytes() == b"document"


def test_delete_failure_is_sanitized_and_leaves_file_for_narrow_retry(storage, monkeypatch):
    owner = uuid4()
    key = store_avatar_jpeg(storage, owner, JPEG)
    avatar_path = storage.root / key
    original_unlink = type(avatar_path).unlink

    def fail_avatar_unlink(path, *args, **kwargs):
        if path == avatar_path:
            raise OSError("injected deletion failure")
        return original_unlink(path, *args, **kwargs)

    monkeypatch.setattr(type(avatar_path), "unlink", fail_avatar_unlink)
    with pytest.raises(AvatarStorageError) as error:
        delete_avatar(storage, owner, key)
    assert error.value.outcome == "delete_failed"
    assert str(error.value) == "Avatar file could not be deleted"
    assert avatar_path.exists()


def test_document_files_remain_untouched_by_avatar_lifecycle(storage):
    document = storage.root / "documents" / "keep.pdf"
    storage.save("documents/keep.pdf", b"document")
    key = store_avatar_jpeg(storage, uuid4(), JPEG)
    delete_avatar(storage, UUID(key.split("/")[1]), key)
    assert document.read_bytes() == b"document"
