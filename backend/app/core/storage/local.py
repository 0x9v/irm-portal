import os
import tempfile
from pathlib import Path

from app.core.config import settings
from app.core.storage.base import StorageProvider
from app.core.storage.exceptions import InvalidPathError, ObjectNotFoundError, StorageError


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
