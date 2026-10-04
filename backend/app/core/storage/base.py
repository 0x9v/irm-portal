from abc import ABC, abstractmethod


class StorageProvider(ABC):
    """
    Abstract base class for document storage.
    Provides the minimum operations needed for document management.
    """

    @abstractmethod
    def save(self, key: str, content: bytes) -> None:
        """Save bytes to the specified storage key."""
        pass

    @abstractmethod
    def read(self, key: str) -> bytes:
        """Read bytes from the specified storage key."""
        pass

    @abstractmethod
    def delete(self, key: str) -> None:
        """
        Delete the object at the specified storage key.
        Implementations should silently succeed if the object does not exist.
        """
        pass

    @abstractmethod
    def exists(self, key: str) -> bool:
        """Check whether an object exists at the specified storage key."""
        pass

    @abstractmethod
    def get_path(self, key: str) -> str:
        """
        Return the physical path to the stored object if supported by the provider.
        Raises ObjectNotFoundError if missing.
        """
        pass
