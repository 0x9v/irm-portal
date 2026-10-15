"""Opt-in verified PostgreSQL acceptance resource; ordinary SQLite tests unchanged."""
import pytest
from acceptance.isolation import AttachedDatabase


@pytest.fixture(scope="session")
def isolated_pg():
    resource = AttachedDatabase()
    try:
        yield resource
    finally:
        resource.close()
