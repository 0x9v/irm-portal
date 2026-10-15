import os
import re
import stat
import tempfile
from pathlib import Path
from uuid import UUID

from app.core.config import settings
from app.core.storage.base import StorageProvider
from app.core.storage.exceptions import (
    AvatarStorageError,
    InvalidPathError,
    ModuleResourceStorageError,
    ObjectNotFoundError,
    PostReplyImageStorageError,
    StickerStorageError,
    StorageError,
)


_AVATAR_KEY = re.compile(
    r"avatars/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/"
    r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpg\Z"
)


class LocalFileSystemStorage(StorageProvider):
    def __init__(self, storage_root: Path | str | None = None):
        if storage_root is None:
            self.root = Path(settings.storage_root).resolve()
        else:
            self.root = Path(storage_root).resolve()

    def _resolve_path(self, key: str) -> Path:
        """
        Safely resolve the storage key to an absolute path inside the storage root.
        Rejects absolute paths and path traversal attempts.
        """
        if os.path.isabs(key):
            raise InvalidPathError("Storage key must be a relative path.")
            
        key_path = Path(key)
        if ".." in key_path.parts:
            raise InvalidPathError("Invalid storage path: traversal detected.")

        target_path = (self.root / key_path).resolve()

        # Check for path traversal (ensure target_path is inside self.root)
        try:
            target_path.relative_to(self.root)
        except ValueError:
            raise InvalidPathError("Invalid storage path: traversal detected.")
            
        if target_path == self.root:
            raise InvalidPathError("Cannot use the storage root as a file target.")

        return target_path

    def save(self, key: str, content: bytes) -> None:
        target_path = self._resolve_path(key)
        try:
            target_path.parent.mkdir(parents=True, exist_ok=True)
            
            fd, tmp_path = tempfile.mkstemp(dir=target_path.parent, prefix=".tmp_")
            try:
                with os.fdopen(fd, 'wb') as f:
                    f.write(content)
                os.replace(tmp_path, target_path)
            except Exception:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                raise
        except Exception as e:
            raise StorageError(f"Failed to save file: {e}") from e

    def read(self, key: str) -> bytes:
        target_path = self._resolve_path(key)
        if not target_path.exists():
            raise ObjectNotFoundError(f"Object not found: {key}")
        
        try:
            return target_path.read_bytes()
        except Exception as e:
            raise StorageError(f"Failed to read file: {e}") from e

    def delete(self, key: str) -> None:
        target_path = self._resolve_path(key)
        if not target_path.exists():
            return  # Silently succeed if missing

        try:
            target_path.unlink()
        except Exception as e:
            raise StorageError(f"Failed to delete file: {e}") from e

    def exists(self, key: str) -> bool:
        target_path = self._resolve_path(key)
        return target_path.exists() and target_path.is_file()

    def get_path(self, key: str) -> str:
        target_path = self._resolve_path(key)
        if not target_path.exists():
            raise ObjectNotFoundError(f"Object not found: {key}")
        return str(target_path)

    @staticmethod
    def _fsync_directory(path: Path) -> None:
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        descriptor = os.open(path, flags)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def _avatar_target(self, key: str, *, create_parent: bool = False) -> Path:
        match = _AVATAR_KEY.fullmatch(key) if isinstance(key, str) else None
        if match is None:
            raise AvatarStorageError("unsafe_path")
        target = self.root / "avatars" / match.group(1) / f"{match.group(2)}.jpg"

        # The configured root is trusted. Below it, reject every existing
        # symlink component instead of resolving a link to another stored file.
        if create_parent:
            missing_root_parts = []
            current_root = self.root
            while not current_root.exists():
                missing_root_parts.append(current_root)
                if current_root.parent == current_root:
                    break
                current_root = current_root.parent
            try:
                for directory in reversed(missing_root_parts):
                    directory.mkdir(mode=0o700)
                    self._fsync_directory(directory.parent)
            except OSError as error:
                raise AvatarStorageError("write_failed", storage_key=key) from error
        current = self.root
        for segment in ("avatars", match.group(1)):
            current = current / segment
            try:
                current.lstat()
            except FileNotFoundError:
                if not create_parent:
                    raise ObjectNotFoundError("Avatar file is unavailable")
                try:
                    current.mkdir(mode=0o700)
                    self._fsync_directory(current.parent)
                except FileExistsError:
                    pass
                except OSError as error:
                    raise AvatarStorageError("write_failed", storage_key=key) from error
            try:
                info = current.lstat()
            except OSError as error:
                raise AvatarStorageError("unsafe_path", storage_key=key) from error
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
                raise AvatarStorageError("unsafe_path", storage_key=key)
            try:
                current.resolve(strict=True).relative_to(self.root)
            except (OSError, ValueError) as error:
                raise AvatarStorageError("unsafe_path", storage_key=key) from error
        return target

    def save_avatar_immutable(self, owner_id, content: bytes) -> str:
        """Generate and durably publish a new immutable avatar version."""
        from app.core.avatars import MAX_STORED_AVATAR_BYTES, generate_avatar_storage_key

        if (not isinstance(content, bytes) or not content.startswith(b"\xff\xd8")
                or not content.endswith(b"\xff\xd9")):
            raise AvatarStorageError("write_failed")
        if len(content) > MAX_STORED_AVATAR_BYTES:
            raise AvatarStorageError("too_large")
        for _attempt in range(3):
            key = generate_avatar_storage_key(owner_id)
            try:
                self._publish_avatar_immutable(key, content)
                return key
            except AvatarStorageError as error:
                if error.outcome != "immutable_exists":
                    raise
        raise AvatarStorageError("immutable_exists")

    def _publish_avatar_immutable(self, key: str, content: bytes) -> None:
        """Publish only an internally generated key without replacing a version."""
        target = self._avatar_target(key, create_parent=True)
        temporary_path = None
        published = False
        try:
            descriptor, temporary_name = tempfile.mkstemp(dir=target.parent, prefix=".avatar-tmp-")
            temporary_path = Path(temporary_name)
            try:
                with os.fdopen(descriptor, "wb") as stream:
                    stream.write(content)
                    stream.flush()
            except Exception as error:
                raise AvatarStorageError("write_failed", storage_key=key) from error
            try:
                with temporary_path.open("rb") as staged:
                    os.fsync(staged.fileno())
            except Exception as error:
                raise AvatarStorageError("durability_failed", storage_key=key) from error
            try:
                # Same-directory hard-link publication is atomic and fails if
                # the immutable destination already exists (unlike os.replace).
                os.link(temporary_path, target, follow_symlinks=False)
                published = True
            except FileExistsError as error:
                raise AvatarStorageError("immutable_exists", storage_key=key) from error
            except Exception as error:
                raise AvatarStorageError("publication_failed", storage_key=key) from error
            try:
                temporary_path.unlink()
                temporary_path = None
                self._fsync_directory(target.parent)
            except Exception as error:
                raise AvatarStorageError("durability_failed", storage_key=key) from error
        except AvatarStorageError:
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass
            if published:
                try:
                    target.unlink(missing_ok=True)
                    self._fsync_directory(target.parent)
                except OSError:
                    # The exception retains only the generated key so a later
                    # transaction coordinator can retry narrowly scoped cleanup.
                    pass
            raise
        except Exception as error:
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass
            raise AvatarStorageError("write_failed", storage_key=key) from error

    def read_avatar_bounded(self, key: str, max_bytes: int) -> bytes:
        """Read at most max_bytes+1 after rejecting links and non-regular files."""
        if not isinstance(max_bytes, int) or max_bytes < 1:
            raise ValueError("max_bytes must be a positive integer")
        target = self._avatar_target(key)
        try:
            info = target.lstat()
        except FileNotFoundError as error:
            raise ObjectNotFoundError("Avatar file is unavailable") from error
        except OSError as error:
            raise AvatarStorageError("unsafe_path") from error
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            raise AvatarStorageError("unsafe_path")
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(target, flags)
            with os.fdopen(descriptor, "rb") as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise AvatarStorageError("unsafe_path")
                content = stream.read(max_bytes + 1)
        except FileNotFoundError as error:
            raise ObjectNotFoundError("Avatar file is unavailable") from error
        except AvatarStorageError:
            raise
        except OSError as error:
            raise AvatarStorageError("read_failed") from error
        if len(content) > max_bytes:
            raise AvatarStorageError("too_large")
        return content

    def delete_avatar(self, key: str) -> bool:
        """Delete exactly one canonical avatar object; absent objects are a no-op."""
        target = self._avatar_target(key)
        try:
            info = target.lstat()
        except FileNotFoundError:
            return False
        except OSError as error:
            raise AvatarStorageError("unsafe_path") from error
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            raise AvatarStorageError("unsafe_path")
        try:
            target.unlink()
            self._fsync_directory(target.parent)
            return True
        except FileNotFoundError:
            return False
        except OSError as error:
            raise AvatarStorageError("delete_failed") from error

    def _sticker_target(self, key: str, *, create_parent: bool = False) -> Path:
        from app.core.stickers import _STICKER_KEY

        match = _STICKER_KEY.fullmatch(key) if isinstance(key, str) else None
        if match is None:
            raise StickerStorageError("unsafe_path")
        target = self.root / "stickers" / match.group(1) / match.group(2) / f"{match.group(3)}.webp"
        current = self.root
        segments = ("stickers", match.group(1), match.group(2))
        if create_parent:
            missing = []
            probe = current
            while not probe.exists():
                missing.append(probe)
                if probe.parent == probe:
                    break
                probe = probe.parent
            try:
                for directory in reversed(missing):
                    directory.mkdir(mode=0o700)
                    self._fsync_directory(directory.parent)
            except OSError as error:
                raise StickerStorageError("write_failed", storage_key=key) from error
        for segment in segments:
            current = current / segment
            try:
                info = current.lstat()
            except FileNotFoundError:
                if not create_parent:
                    raise ObjectNotFoundError("Sticker file is unavailable")
                try:
                    current.mkdir(mode=0o700)
                    self._fsync_directory(current.parent)
                except FileExistsError:
                    pass
                except OSError as error:
                    raise StickerStorageError("write_failed", storage_key=key) from error
                info = current.lstat()
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
                raise StickerStorageError("unsafe_path")
            try:
                current.resolve(strict=True).relative_to(self.root)
            except (OSError, ValueError) as error:
                raise StickerStorageError("unsafe_path") from error
        return target

    def save_sticker_immutable(self, owner_id: UUID, asset_id: UUID, content: bytes) -> str:
        from app.core.stickers import MAX_STORED_STICKER_BYTES, generate_sticker_storage_key

        if not isinstance(content, bytes) or len(content) > MAX_STORED_STICKER_BYTES:
            raise StickerStorageError("too_large")
        for _attempt in range(3):
            key = generate_sticker_storage_key(owner_id, asset_id)
            try:
                self._publish_sticker_immutable(key, content)
                return key
            except StickerStorageError as error:
                if error.outcome != "immutable_exists":
                    raise
        raise StickerStorageError("immutable_exists")

    def _publish_sticker_immutable(self, key: str, content: bytes) -> None:
        target = self._sticker_target(key, create_parent=True)
        temporary = None
        published = False
        try:
            descriptor, name = tempfile.mkstemp(dir=target.parent, prefix=".sticker-tmp-")
            temporary = Path(name)
            try:
                with os.fdopen(descriptor, "wb") as stream:
                    stream.write(content)
                    stream.flush()
                    os.fsync(stream.fileno())
            except Exception as error:
                raise StickerStorageError("write_failed", storage_key=key) from error
            try:
                os.link(temporary, target, follow_symlinks=False)
                published = True
            except FileExistsError as error:
                raise StickerStorageError("immutable_exists") from error
            except Exception as error:
                raise StickerStorageError("publication_failed", storage_key=key) from error
            try:
                temporary.unlink()
                temporary = None
                self._fsync_directory(target.parent)
            except Exception as error:
                raise StickerStorageError("durability_failed", storage_key=key) from error
        except StickerStorageError:
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass
            if published:
                try:
                    target.unlink(missing_ok=True)
                    self._fsync_directory(target.parent)
                except OSError:
                    # Preserve generated key for a later narrowly scoped cleanup attempt.
                    pass
            raise
        except Exception as error:
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass
            raise StickerStorageError("write_failed", storage_key=key) from error

    def read_sticker_bounded(self, key: str, owner_id: UUID, max_bytes: int) -> bytes:
        from app.core.stickers import validate_sticker_storage_key

        try:
            validate_sticker_storage_key(key, owner_id)
        except (TypeError, ValueError) as error:
            raise StickerStorageError("unsafe_path") from error
        if not isinstance(max_bytes, int) or max_bytes < 1:
            raise ValueError("max_bytes must be positive")
        target = self._sticker_target(key)
        try:
            info = target.lstat()
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
                raise StickerStorageError("unsafe_path")
            descriptor = os.open(target, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(descriptor, "rb") as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise StickerStorageError("unsafe_path")
                content = stream.read(max_bytes + 1)
        except FileNotFoundError as error:
            raise ObjectNotFoundError("Sticker file is unavailable") from error
        except StickerStorageError:
            raise
        except OSError as error:
            raise StickerStorageError("read_failed") from error
        if len(content) > max_bytes:
            raise StickerStorageError("too_large")
        return content

    def delete_sticker(self, key: str, owner_id: UUID) -> bool:
        from app.core.stickers import validate_sticker_storage_key

        try:
            validate_sticker_storage_key(key, owner_id)
        except (TypeError, ValueError) as error:
            raise StickerStorageError("unsafe_path") from error
        try:
            target = self._sticker_target(key)
        except ObjectNotFoundError:
            return False
        try:
            info = target.lstat()
        except FileNotFoundError:
            return False
        except OSError as error:
            raise StickerStorageError("unsafe_path") from error
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            raise StickerStorageError("unsafe_path")
        try:
            target.unlink()
            self._fsync_directory(target.parent)
            return True
        except FileNotFoundError:
            return False
        except OSError as error:
            raise StickerStorageError("delete_failed") from error

    def sticker_file_size(self, key: str, owner_id: UUID) -> int | None:
        """Inspect one validated immutable object without reading its bytes."""
        from app.core.stickers import validate_sticker_storage_key

        try:
            validate_sticker_storage_key(key, owner_id)
            target = self._sticker_target(key)
            info = target.lstat()
        except (TypeError, ValueError) as error:
            raise StickerStorageError("unsafe_path") from error
        except (ObjectNotFoundError, FileNotFoundError):
            return None
        except OSError as error:
            raise StickerStorageError("read_failed") from error
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            raise StickerStorageError("unsafe_path")
        return info.st_size

    def _module_resource_image_target(
        self, key: str, community_id: UUID, module_id: UUID, resource_id: UUID,
        *, create_parent: bool = False,
    ) -> Path:
        from app.core.module_resources import validate_module_resource_image_key

        try:
            validate_module_resource_image_key(key, community_id, module_id, resource_id)
        except (TypeError, ValueError) as error:
            raise ModuleResourceStorageError("unsafe_path") from error
        target = (self.root / "module-resources" / str(community_id) / str(module_id)
                  / str(resource_id) / f"{key.rsplit('/', 1)[1]}")
        segments = ("module-resources", str(community_id), str(module_id), str(resource_id))
        current = self.root
        if create_parent:
            missing = []
            probe = current
            while not probe.exists():
                missing.append(probe)
                if probe.parent == probe:
                    break
                probe = probe.parent
            try:
                for directory in reversed(missing):
                    directory.mkdir(mode=0o700)
                    self._fsync_directory(directory.parent)
            except OSError as error:
                raise ModuleResourceStorageError("write_failed", storage_key=key) from error
        for segment in segments:
            current = current / segment
            try:
                info = current.lstat()
            except FileNotFoundError:
                if not create_parent:
                    raise ObjectNotFoundError("Resource image is unavailable")
                try:
                    current.mkdir(mode=0o700)
                    self._fsync_directory(current.parent)
                except FileExistsError:
                    pass
                except OSError as error:
                    raise ModuleResourceStorageError("write_failed", storage_key=key) from error
                info = current.lstat()
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
                raise ModuleResourceStorageError("unsafe_path")
            try:
                current.resolve(strict=True).relative_to(self.root)
            except (OSError, ValueError) as error:
                raise ModuleResourceStorageError("unsafe_path") from error
        return target

    def save_module_resource_image(
        self, community_id: UUID, module_id: UUID, resource_id: UUID, content: bytes
    ) -> str:
        from app.core.module_resources import (
            MAX_RESOURCE_IMAGE_OUTPUT_BYTES,
            generate_module_resource_image_key,
        )

        if (not isinstance(content, bytes) or not content.startswith(b"RIFF")
                or content[8:12] != b"WEBP"):
            raise ModuleResourceStorageError("write_failed")
        if len(content) > MAX_RESOURCE_IMAGE_OUTPUT_BYTES:
            raise ModuleResourceStorageError("too_large")
        for _attempt in range(3):
            key = generate_module_resource_image_key(community_id, module_id, resource_id)
            try:
                self._publish_module_resource_image(key, community_id, module_id, resource_id, content)
                return key
            except ModuleResourceStorageError as error:
                if error.outcome != "immutable_exists":
                    raise
        raise ModuleResourceStorageError("immutable_exists")

    def _publish_module_resource_image(
        self, key: str, community_id: UUID, module_id: UUID, resource_id: UUID, content: bytes
    ) -> None:
        target = self._module_resource_image_target(
            key, community_id, module_id, resource_id, create_parent=True
        )
        temporary = None
        published = False
        try:
            descriptor, name = tempfile.mkstemp(dir=target.parent, prefix=".resource-image-tmp-")
            temporary = Path(name)
            try:
                with os.fdopen(descriptor, "wb") as stream:
                    stream.write(content)
                    stream.flush()
                    os.fsync(stream.fileno())
            except Exception as error:
                raise ModuleResourceStorageError("write_failed", storage_key=key) from error
            try:
                os.link(temporary, target, follow_symlinks=False)
                published = True
            except FileExistsError as error:
                raise ModuleResourceStorageError("immutable_exists") from error
            except Exception as error:
                raise ModuleResourceStorageError("publication_failed", storage_key=key) from error
            try:
                temporary.unlink()
                temporary = None
                self._fsync_directory(target.parent)
            except Exception as error:
                raise ModuleResourceStorageError("durability_failed", storage_key=key) from error
        except ModuleResourceStorageError:
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass
            if published:
                try:
                    target.unlink(missing_ok=True)
                    self._fsync_directory(target.parent)
                except OSError:
                    pass
            raise
        except Exception as error:
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass
            raise ModuleResourceStorageError("write_failed", storage_key=key) from error

    def read_module_resource_image_bounded(
        self, key: str, community_id: UUID, module_id: UUID, resource_id: UUID, max_bytes: int
    ) -> bytes:
        from app.core.module_resources import validate_module_resource_image_key

        try:
            validate_module_resource_image_key(key, community_id, module_id, resource_id)
        except (TypeError, ValueError) as error:
            raise ModuleResourceStorageError("unsafe_path") from error
        if not isinstance(max_bytes, int) or max_bytes < 1:
            raise ValueError("max_bytes must be positive")
        target = self._module_resource_image_target(key, community_id, module_id, resource_id)
        try:
            info = target.lstat()
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
                raise ModuleResourceStorageError("unsafe_path")
            descriptor = os.open(target, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(descriptor, "rb") as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise ModuleResourceStorageError("unsafe_path")
                content = stream.read(max_bytes + 1)
        except FileNotFoundError as error:
            raise ObjectNotFoundError("Resource image is unavailable") from error
        except ModuleResourceStorageError:
            raise
        except OSError as error:
            raise ModuleResourceStorageError("read_failed") from error
        if len(content) > max_bytes:
            raise ModuleResourceStorageError("too_large")
        return content

    def delete_module_resource_image(
        self, key: str, community_id: UUID, module_id: UUID, resource_id: UUID
    ) -> bool:
        target = self._module_resource_image_target(key, community_id, module_id, resource_id)
        try:
            info = target.lstat()
        except FileNotFoundError:
            return False
        except OSError as error:
            raise ModuleResourceStorageError("unsafe_path") from error
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            raise ModuleResourceStorageError("unsafe_path")
        try:
            target.unlink()
            self._fsync_directory(target.parent)
            return True
        except FileNotFoundError:
            return False
        except OSError as error:
            raise ModuleResourceStorageError("delete_failed") from error

    def _post_reply_image_target(self, key: str, reply_id: UUID, *, create_parent: bool = False) -> Path:
        from app.core.post_reply_images import validate_post_reply_image_key

        try:
            valid = validate_post_reply_image_key(key, reply_id)
        except (TypeError, ValueError):
            valid = False
        if not valid:
            raise PostReplyImageStorageError("unsafe_path")
        target = self.root / key
        if create_parent:
            missing = []
            probe = self.root
            while not probe.exists():
                missing.append(probe)
                if probe.parent == probe:
                    break
                probe = probe.parent
            try:
                for directory in reversed(missing):
                    directory.mkdir(mode=0o700)
                    self._fsync_directory(directory.parent)
            except FileExistsError:
                pass
            except OSError as error:
                raise PostReplyImageStorageError("write_failed", storage_key=key) from error
        try:
            root_info = self.root.lstat()
        except OSError as error:
            raise PostReplyImageStorageError("unsafe_path") from error
        if stat.S_ISLNK(root_info.st_mode) or not stat.S_ISDIR(root_info.st_mode):
            raise PostReplyImageStorageError("unsafe_path")
        current = self.root
        for segment in ("post-reply-images", str(reply_id)):
            current = current / segment
            try:
                info = current.lstat()
            except FileNotFoundError:
                if not create_parent:
                    raise ObjectNotFoundError("Reply image is unavailable")
                try:
                    current.mkdir(mode=0o700)
                    self._fsync_directory(current.parent)
                    info = current.lstat()
                except FileExistsError:
                    info = current.lstat()
                except OSError as error:
                    raise PostReplyImageStorageError("write_failed", storage_key=key) from error
            except OSError as error:
                raise PostReplyImageStorageError("unsafe_path") from error
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
                raise PostReplyImageStorageError("unsafe_path")
            try:
                current.resolve(strict=True).relative_to(self.root)
            except (OSError, ValueError) as error:
                raise PostReplyImageStorageError("unsafe_path") from error
        return target

    def save_post_reply_image_immutable(self, reply_id: UUID, content: bytes) -> str:
        from app.core.post_reply_images import MAX_REPLY_IMAGE_OUTPUT_BYTES, generate_post_reply_image_key

        if not isinstance(content, bytes) or not content.startswith(b"\xff\xd8") or not content.endswith(b"\xff\xd9"):
            raise PostReplyImageStorageError("write_failed")
        if len(content) > MAX_REPLY_IMAGE_OUTPUT_BYTES:
            raise PostReplyImageStorageError("too_large")
        for _attempt in range(3):
            key = generate_post_reply_image_key(reply_id)
            target = self._post_reply_image_target(key, reply_id, create_parent=True)
            temporary = None
            published = False
            try:
                descriptor, name = tempfile.mkstemp(dir=target.parent, prefix=".reply-image-tmp-")
                temporary = Path(name)
                with os.fdopen(descriptor, "wb") as stream:
                    stream.write(content)
                    stream.flush()
                    os.fsync(stream.fileno())
                try:
                    os.link(temporary, target, follow_symlinks=False)
                    published = True
                except FileExistsError:
                    temporary.unlink(missing_ok=True)
                    temporary = None
                    continue
                except Exception as error:
                    raise PostReplyImageStorageError("publication_failed", storage_key=key) from error
                temporary.unlink()
                temporary = None
                self._fsync_directory(target.parent)
                return key
            except PostReplyImageStorageError:
                if temporary is not None:
                    try:
                        temporary.unlink(missing_ok=True)
                    except OSError:
                        pass
                if published:
                    try:
                        target.unlink(missing_ok=True)
                        self._fsync_directory(target.parent)
                    except OSError:
                        pass
                raise
            except Exception as error:
                if temporary is not None:
                    try:
                        temporary.unlink(missing_ok=True)
                    except OSError:
                        pass
                raise PostReplyImageStorageError("durability_failed", storage_key=key) from error
        raise PostReplyImageStorageError("immutable_exists")

    def read_post_reply_image_bounded(self, key: str, reply_id: UUID, max_bytes: int) -> bytes:
        if not isinstance(max_bytes, int) or max_bytes < 1:
            raise ValueError("max_bytes must be positive")
        target = self._post_reply_image_target(key, reply_id)
        try:
            info = target.lstat()
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
                raise PostReplyImageStorageError("unsafe_path")
            descriptor = os.open(target, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(descriptor, "rb") as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise PostReplyImageStorageError("unsafe_path")
                content = stream.read(max_bytes + 1)
        except FileNotFoundError as error:
            raise ObjectNotFoundError("Reply image is unavailable") from error
        except PostReplyImageStorageError:
            raise
        except OSError as error:
            raise PostReplyImageStorageError("read_failed") from error
        if len(content) > max_bytes:
            raise PostReplyImageStorageError("too_large")
        return content

    def delete_post_reply_image(self, key: str, reply_id: UUID) -> bool:
        target = self._post_reply_image_target(key, reply_id)
        try:
            info = target.lstat()
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
                raise PostReplyImageStorageError("unsafe_path")
            target.unlink()
            self._fsync_directory(target.parent)
            return True
        except FileNotFoundError:
            return False
        except PostReplyImageStorageError:
            raise
        except OSError as error:
            raise PostReplyImageStorageError("delete_failed") from error
