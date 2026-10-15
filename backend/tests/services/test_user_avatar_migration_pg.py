"""Avatar-key migration lifecycle on a lease-owned PostgreSQL schema."""

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from acceptance.isolation import disposable_database, migrate
from app.models.user import User


PREVIOUS_HEAD = "f4b8c1d2e390"
NEW_HEAD = "c96b4731ea20"


def test_avatar_key_migration_preserves_rows_and_guards_downgrade():
    with disposable_database(upgrade=False) as resource:
        assert resource.server_identity["database"] == "irm_integration_test"
        assert resource.server_identity["role"] == "irm_test"
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD)

        user_id = uuid4()
        created_at = datetime(2024, 4, 5, 6, 7, 8, tzinfo=timezone.utc)
        updated_at = datetime(2025, 8, 9, 10, 11, 12, tzinfo=timezone.utc)
        with resource.engine.begin() as connection:
            connection.execute(text("""INSERT INTO users
                (id, username, email, password_hash, first_name, family_name, created_at, updated_at)
                VALUES (:id, :username, :email, :password_hash, :first_name, :family_name, :created, :updated)"""), {
                "id": user_id, "username": "avatar_migration_user", "email": "avatar-migration@example.invalid",
                "password_hash": "opaque-test-hash", "first_name": "Legacy", "family_name": "Account",
                "created": created_at, "updated": updated_at,
            })

        migrate(resource.engine, resource.lease, NEW_HEAD)
        column = {item["name"]: item for item in inspect(resource.engine).get_columns("users")}[
            "avatar_storage_key"
        ]
        assert column["type"].length == 255 and column["nullable"] is True
        assert User.__table__.columns["avatar_storage_key"].type.length == 255
        assert User.__table__.columns["avatar_storage_key"].nullable is True

        with Session(resource.engine) as session:
            user = session.get(User, user_id)
            assert user is not None
            assert (user.username, user.email, user.password_hash, user.first_name, user.family_name) == (
                "avatar_migration_user", "avatar-migration@example.invalid", "opaque-test-hash", "Legacy", "Account"
            )
            assert user.created_at == created_at and user.updated_at == updated_at
            assert user.avatar_storage_key is None and user.avatar_url is None

        key = f"avatars/{user_id}/{uuid4()}.jpg"
        with resource.engine.begin() as connection:
            connection.execute(text("UPDATE users SET avatar_storage_key=:key WHERE id=:id"),
                               {"key": key, "id": user_id})
        with pytest.raises(RuntimeError, match=r"Cannot remove users\.avatar_storage_key: 1 avatar reference\(s\) remain"):
            migrate(resource.engine, resource.lease, PREVIOUS_HEAD, downgrade=True)
        assert "avatar_storage_key" in {item["name"] for item in inspect(resource.engine).get_columns("users")}
        with resource.engine.connect() as connection:
            assert connection.execute(text("SELECT avatar_storage_key FROM users WHERE id=:id"),
                                      {"id": user_id}).scalar_one() == key

        with resource.engine.begin() as connection:
            connection.execute(text("UPDATE users SET avatar_storage_key=NULL WHERE id=:id"), {"id": user_id})
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD, downgrade=True)
        assert "avatar_storage_key" not in {item["name"] for item in inspect(resource.engine).get_columns("users")}
        with resource.engine.connect() as connection:
            assert connection.execute(text("SELECT username, email FROM users WHERE id=:id"),
                                      {"id": user_id}).one() == ("avatar_migration_user", "avatar-migration@example.invalid")

        migrate(resource.engine, resource.lease, NEW_HEAD)
        with Session(resource.engine) as session:
            user = session.get(User, user_id)
            assert user.avatar_storage_key is None and user.avatar_url is None
