class StorageError(Exception):
    """Base class for storage-related errors."""
    pass


class ObjectNotFoundError(StorageError):
    """Raised when the requested object does not exist in storage."""
    pass


class InvalidPathError(StorageError):
    """Raised when the provided storage path is invalid or insecure."""
    pass
