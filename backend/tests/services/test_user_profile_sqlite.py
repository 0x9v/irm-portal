"""Unit coverage for profile patch persistence without external databases."""
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.api.account_mutation_route import _validation_details
from app.models.user import User
from app.schemas.user import UserProfileUpdate
from app.services.user import update_user_profile


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def create_user(db, username):
    user = User(
        username=username,
        email=f"{uuid4().hex}@example.test",
        password_hash="test-only-hash",
        first_name="Legacy First",
        family_name="Legacy Family",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_partial_and_empty_patches_keep_omitted_legacy_values_and_noop_timestamp(db):
    user = create_user(db, " legacy-user ")
    original_updated_at = user.updated_at

    unchanged = update_user_profile(db, user.id, UserProfileUpdate())
    assert unchanged.username == " legacy-user "
    assert unchanged.updated_at == original_updated_at

    changed = update_user_profile(db, user.id, UserProfileUpdate(first_name="  عائشة  "))
    assert changed.first_name == "عائشة"
    assert changed.username == " legacy-user "
    assert changed.family_name == "Legacy Family"
    assert changed.updated_at >= original_updated_at


def test_exact_username_conflict_rolls_back_all_supplied_fields(db):
    create_user(db, "taken_name")
    caller = create_user(db, "caller_name")
    old = (caller.username, caller.first_name, caller.updated_at)

    with pytest.raises(HTTPException) as raised:
        update_user_profile(
            db,
            caller.id,
            UserProfileUpdate(username="taken_name", first_name="Changed"),
        )

    assert raised.value.status_code == 409
    assert raised.value.detail == "Username is already taken."
    db.refresh(caller)
    assert (caller.username, caller.first_name, caller.updated_at) == old


def test_exact_case_sensitivity_and_normalized_noop(db):
    user = create_user(db, "Sara")
    lower = update_user_profile(db, user.id, UserProfileUpdate(username="sara"))
    assert lower.username == "sara"
    updated_at = lower.updated_at

    same = update_user_profile(db, user.id, UserProfileUpdate(username=" sara "))
    assert same.username == "sara"
    assert same.updated_at == updated_at


def test_profile_schema_strict_unicode_boundaries_null_and_extra_fields():
    profile = UserProfileUpdate(
        username="  Sara  ",
        first_name="عائشة",
        family_name="É" * 100,
    )
    assert profile.model_dump(exclude_unset=True) == {
        "username": "Sara",
        "first_name": "عائشة",
        "family_name": "É" * 100,
    }

    for payload in (
        {"username": None},
        {"username": True},
        {"username": "ab"},
        {"first_name": "\n"},
        {"first_name": "bad\ud800name"},
        {"family_name": "bad\u202ename"},
        {"extra": "not allowed"},
    ):
        with pytest.raises(ValidationError):
            UserProfileUpdate.model_validate(payload)


def test_request_validation_sanitizer_drops_input_context_and_url():
    exc = RequestValidationError([
        {
            "loc": ("body", "password"),
            "type": "value_error",
            "msg": "Invalid value",
            "input": "secret-value",
            "ctx": {"error": RuntimeError("secret-context")},
            "url": "https://errors.pydantic.dev/",
        }
    ])
    safe = _validation_details(exc)
    assert safe == [
        {"loc": ["body", "password"], "type": "value_error", "msg": "Invalid value"}
    ]
    assert "secret" not in str(safe)
