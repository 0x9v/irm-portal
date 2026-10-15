"""Canonical account-avatar identifiers and safe owner-response projection."""

import re
from uuid import UUID, uuid4

from app.core.storage.exceptions import AvatarStorageError, ObjectNotFoundError


_AVATAR_KEY = re.compile(
    r"avatars/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/"
    r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpg\Z"
)
MAX_STORED_AVATAR_BYTES = 256 * 1024


class InvalidAvatarStorageKey(ValueError):
    """An avatar reference is not canonical or does not belong to its owner."""


def generate_avatar_storage_key(user_id: UUID) -> str:
    """Generate an immutable, server-owned storage key with a random version."""
    if not isinstance(user_id, UUID):
        raise TypeError("user_id must be a UUID")
    return f"avatars/{str(user_id)}/{uuid4()}.jpg"


def parse_avatar_storage_key(storage_key: str, owner_id: UUID) -> UUID:
    """Validate the exact key grammar and return its version UUID."""
    if not isinstance(storage_key, str) or not isinstance(owner_id, UUID):
        raise InvalidAvatarStorageKey("Invalid avatar reference")
    match = _AVATAR_KEY.fullmatch(storage_key)
    if match is None or match.group(1) != str(owner_id):
        raise InvalidAvatarStorageKey("Invalid avatar reference")
    try:
        version = UUID(match.group(2))
    except ValueError as error:  # Defensive: the regex already enforces UUID syntax.
        raise InvalidAvatarStorageKey("Invalid avatar reference") from error
    if str(version) != match.group(2):
        raise InvalidAvatarStorageKey("Invalid avatar reference")
    return version


def avatar_url_from_storage_key(owner_id: UUID, storage_key: str | None) -> str | None:
    """Project a canonical key to a relative URL; malformed legacy values fail closed."""
    if storage_key is None:
        return None
    try:
        version = parse_avatar_storage_key(storage_key, owner_id)
    except InvalidAvatarStorageKey:
        return None
    return f"/api/v1/users/{owner_id}/avatar/{version}"


def store_avatar_jpeg(storage, owner_id: UUID, jpeg_bytes: bytes) -> str:
    """Save processed JPEG bytes at a new generated immutable version key.

    Image decoding and canonical re-encoding must have happened before this
    helper is called. This boundary enforces a bounded JPEG envelope only.
    """
    if not isinstance(jpeg_bytes, bytes) or not jpeg_bytes.startswith(b"\xff\xd8") or not jpeg_bytes.endswith(b"\xff\xd9"):
        raise AvatarStorageError("write_failed")
    if len(jpeg_bytes) > MAX_STORED_AVATAR_BYTES:
        raise AvatarStorageError("too_large")
    return storage.save_avatar_immutable(owner_id, jpeg_bytes)


def read_avatar(storage, owner_id: UUID, storage_key: str) -> bytes:
    """Read a validated owner's avatar with a strict stored-byte bound."""
    parse_avatar_storage_key(storage_key, owner_id)
    try:
        return storage.read_avatar_bounded(storage_key, MAX_STORED_AVATAR_BYTES)
    except ObjectNotFoundError as error:
        raise AvatarStorageError("missing") from error


def delete_avatar(storage, owner_id: UUID, storage_key: str) -> bool:
    """Delete only a canonical key owned by owner_id; missing is idempotent."""
    parse_avatar_storage_key(storage_key, owner_id)
    return storage.delete_avatar(storage_key)
