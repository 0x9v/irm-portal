"""Exercise the avatar migration's data and downgrade guard on isolated SQLite."""

import importlib.util
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text


MIGRATION_PATH = Path(__file__).parents[2] / "alembic/versions/c96b4731ea20_add_user_avatar_storage_key.py"
SPEC = importlib.util.spec_from_file_location("user_avatar_storage_key_migration", MIGRATION_PATH)
MIGRATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATION)


def test_avatar_migration_upgrade_downgrade_and_reupgrade_preserve_account():
    engine = create_engine("sqlite:///:memory:")
    user_id = str(uuid4())
    with engine.begin() as connection:
        connection.execute(text("""CREATE TABLE users (
            id CHAR(36) PRIMARY KEY, username VARCHAR(50) NOT NULL, email VARCHAR(320) NOT NULL,
            password_hash VARCHAR(255) NOT NULL, first_name VARCHAR(100) NOT NULL,
            family_name VARCHAR(100) NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
        )"""))
        connection.execute(text("""INSERT INTO users VALUES
            (:id, 'legacy_user', 'legacy@example.invalid', 'opaque-hash', 'Legacy', 'Account',
             '2024-01-02 03:04:05', '2025-06-07 08:09:10')"""), {"id": user_id})
        with Operations.context(MigrationContext.configure(connection)):
            MIGRATION.upgrade()
        columns = {column["name"]: column for column in inspect(connection).get_columns("users")}
        assert columns["avatar_storage_key"]["type"].length == 255
        assert columns["avatar_storage_key"]["nullable"] is True
        row = connection.execute(text("""SELECT username, email, password_hash, first_name, family_name,
            created_at, updated_at, avatar_storage_key FROM users WHERE id=:id"""), {"id": user_id}).one()
        assert row == ("legacy_user", "legacy@example.invalid", "opaque-hash", "Legacy", "Account",
                       "2024-01-02 03:04:05", "2025-06-07 08:09:10", None)

        connection.execute(text("UPDATE users SET avatar_storage_key='avatars/live/reference.jpg' WHERE id=:id"),
                           {"id": user_id})
        with Operations.context(MigrationContext.configure(connection)):
            with pytest.raises(RuntimeError, match=r"Cannot remove users\.avatar_storage_key: 1 avatar reference\(s\) remain"):
                MIGRATION.downgrade()
        assert "avatar_storage_key" in {column["name"] for column in inspect(connection).get_columns("users")}

        connection.execute(text("UPDATE users SET avatar_storage_key=NULL WHERE id=:id"), {"id": user_id})
        with Operations.context(MigrationContext.configure(connection)):
            MIGRATION.downgrade()
        assert "avatar_storage_key" not in {column["name"] for column in inspect(connection).get_columns("users")}
        with Operations.context(MigrationContext.configure(connection)):
            MIGRATION.upgrade()
        assert connection.execute(text("SELECT avatar_storage_key FROM users WHERE id=:id"),
                                  {"id": user_id}).scalar_one() is None
    engine.dispose()
