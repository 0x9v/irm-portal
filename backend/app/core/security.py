"""Security utilities for the application."""

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

# Argon2id is the default hasher in argon2-cffi, configured with secure defaults
# for modern applications (Type ID, memory cost, time cost, parallelism).
_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    """Hash a plain-text password using Argon2id.

    Args:
        password: The plain-text password to hash.

    Returns:
        The resulting password hash string.
    """
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a plain-text password against a given hash.

    Args:
        password: The plain-text password to verify.
        password_hash: The previously stored hash to check against.

    Returns:
        True if the password matches the hash, False otherwise.
    """
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False
