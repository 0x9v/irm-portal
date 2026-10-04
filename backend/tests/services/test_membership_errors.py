import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from app.services.membership import _handle_integrity_error

# --- Mock fixtures for structured PostgreSQL driver exceptions ---

class MockDiag:
    def __init__(self, constraint_name):
        self.constraint_name = constraint_name

class MockPsycopg2Error(Exception):
    def __init__(self, msg, constraint_name=None):
        super().__init__(msg)
        if constraint_name:
            self.diag = MockDiag(constraint_name)

def make_integrity_error(orig):
    return IntegrityError("statement", "params", orig)


# --- Tests for PostgreSQL classification ---

def test_pg_global_constraint_becomes_409():
    """A. The global membership unique constraint becomes 409."""
    orig = MockPsycopg2Error("duplicate key", constraint_name="uq_memberships_global_active_pending")
    e = make_integrity_error(orig)
    
    with pytest.raises(HTTPException) as exc:
        _handle_integrity_error(e)
    assert exc.value.status_code == 409


def test_pg_user_community_constraint_becomes_409():
    """B. The user/community unique constraint becomes 409."""
    orig = MockPsycopg2Error("duplicate key", constraint_name="uq_memberships_user_community")
    e = make_integrity_error(orig)
    
    with pytest.raises(HTTPException) as exc:
        _handle_integrity_error(e)
    assert exc.value.status_code == 409


def test_pg_unrelated_constraint_is_not_translated():
    """C. An unrelated PostgreSQL unique constraint is not translated to a membership conflict."""
    orig = MockPsycopg2Error("duplicate key", constraint_name="users_email_key")
    e = make_integrity_error(orig)
    
    with pytest.raises(IntegrityError):
        _handle_integrity_error(e)


def test_pg_foreign_key_violation_is_not_translated():
    """D. A foreign-key violation is not translated to a membership conflict."""
    orig = MockPsycopg2Error("foreign key violation", constraint_name="fk_memberships_user_id_users")
    e = make_integrity_error(orig)
    
    with pytest.raises(IntegrityError):
        _handle_integrity_error(e)


def test_pg_unidentified_error_is_not_translated():
    """E. An unidentified IntegrityError is not translated to a membership conflict."""
    # A generic DB exception with no diag constraint name
    orig = MockPsycopg2Error("some unidentified DB error")
    e = make_integrity_error(orig)
    
    with pytest.raises(IntegrityError):
        _handle_integrity_error(e)


# --- Tests for SQLite classification ---

def test_sqlite_user_id_uniqueness_failure():
    """F. SQLite's exact user_id uniqueness failure is recognized."""
    orig = Exception("UNIQUE constraint failed: memberships.user_id")
    e = make_integrity_error(orig)
    
    with pytest.raises(HTTPException) as exc:
        _handle_integrity_error(e)
    assert exc.value.status_code == 409


def test_sqlite_user_community_uniqueness_failure():
    """G. SQLite's exact user_id/community_id uniqueness failure is recognized."""
    orig = Exception("UNIQUE constraint failed: memberships.user_id, memberships.community_id")
    e = make_integrity_error(orig)
    
    with pytest.raises(HTTPException) as exc:
        _handle_integrity_error(e)
    assert exc.value.status_code == 409


def test_sqlite_unrelated_uniqueness_failure():
    """H. An unrelated SQLite uniqueness failure is not recognized."""
    orig = Exception("UNIQUE constraint failed: users.email")
    e = make_integrity_error(orig)
    
    with pytest.raises(IntegrityError):
        _handle_integrity_error(e)

