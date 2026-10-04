import pytest

from app.core.security import hash_password, verify_password


def test_hash_password_produces_hash():
    password = "SuperSecretPassword123!"
    hashed = hash_password(password)
    
    assert hashed != password
    assert hashed.startswith("$argon2id$")


def test_verify_password_success():
    password = "SuperSecretPassword123!"
    hashed = hash_password(password)
    
    assert verify_password(password, hashed) is True


def test_verify_password_failure():
    password = "SuperSecretPassword123!"
    hashed = hash_password(password)
    
    assert verify_password("WrongPassword!", hashed) is False


def test_hashing_same_password_twice_produces_different_hashes():
    password = "SuperSecretPassword123!"
    hashed1 = hash_password(password)
    hashed2 = hash_password(password)
    
    assert hashed1 != hashed2


def test_verify_password_with_malformed_hash():
    password = "SuperSecretPassword123!"
    
    # Invalid hash format
    assert verify_password(password, "not-a-valid-hash") is False
    # Valid-looking but malformed hash
    assert verify_password(password, "$argon2id$v=19$m=65536,t=3,p=4$some_salt$some_hash") is False
