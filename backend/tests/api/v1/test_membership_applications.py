from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.sessions import create_session
from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models.community import Community
from app.models.membership import (
    Membership,
    MembershipApplicantType,
    MembershipIdentifierType,
    MembershipRole,
    MembershipStatus,
)
from app.models.user import User
from app.schemas.membership import MembershipCreate, normalize_promotion, promotion_options


engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(autoflush=False, bind=engine)


def override_get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_db():
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.clear()


@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def client():
    return TestClient(app)


def make_user(db, username):
    user = User(username=username, email=f"{username}@example.invalid", password_hash="synthetic",
                first_name="Account", family_name="Holder")
    db.add(user)
    db.commit()
    db.refresh(user)
    token, _ = create_session(db, user.id, timedelta(days=1))
    return user, token


def make_community(db, slug="membership-app"):
    community = Community(name="Synthetic Community", slug=slug)
    db.add(community)
    db.commit()
    db.refresh(community)
    return community


def student_payload(**updates):
    payload = {
        "applicant_type": "STUDENT",
        "applicant_first_name": "Élodie O'Neil-Smith",
        "applicant_family_name": "Ben Ali",
        "identifier_type": "MASSAR",
        "cne": "r123456789",
    }
    payload.update(updates)
    return payload


def laureate_payload(**updates):
    payload = {
        "applicant_type": "LAUREATE",
        "applicant_first_name": "José",
        "applicant_family_name": "D'Arcy",
        "promotion": "23/24",
    }
    payload.update(updates)
    return payload


def test_legacy_and_new_contract_selection_and_unknown_fields():
    legacy = MembershipCreate.model_validate({"cne": "00123"})
    assert legacy.applicant_type is None and legacy.cne == "00123"
    for payload in (
        {"applicant_first_name": "Only a partial field", "cne": "123"},
        {"applicant_type": "STUDENT", "applicant_first_name": "Only"},
        student_payload(extra_data="no"),
        {"cne": "123", "promotion": None},
    ):
        with pytest.raises(ValueError):
            MembershipCreate.model_validate(payload)


@pytest.mark.parametrize("payload", [
    student_payload(applicant_type="UNKNOWN"),
    student_payload(identifier_type="PASSPORT"),
    student_payload(promotion="2023"),
    laureate_payload(cne="123"),
    laureate_payload(identifier_type="FOREIGN"),
    laureate_payload(promotion=None),
])
def test_unsupported_or_contradictory_application_fields_rejected(payload):
    with pytest.raises(ValueError):
        MembershipCreate.model_validate(payload)


@pytest.mark.parametrize("name", ["  Amélie O'Connor-Smith  ", "  بن علي ", "李 小龍"])
def test_unicode_names_are_trimmed_and_preserved(name):
    validated = MembershipCreate.model_validate(student_payload(applicant_first_name=name))
    assert validated.applicant_first_name == name.strip()


@pytest.mark.parametrize("name", ["", "   ", "A\nB", "A\rB", "A\tB", "x" * 101])
def test_invalid_names_are_rejected(name):
    with pytest.raises(ValueError):
        MembershipCreate.model_validate(student_payload(applicant_first_name=name))


def test_name_length_is_code_points_and_control_free():
    assert len(MembershipCreate.model_validate(student_payload(applicant_first_name="é" * 100)).applicant_first_name) == 100
    with pytest.raises(ValueError):
        MembershipCreate.model_validate(student_payload(applicant_family_name="é" * 101))


@pytest.mark.parametrize("value,normalized", [("r123456789", "R123456789"), ("Z000000001", "Z000000001")])
def test_massar_identifier_normalization(value, normalized):
    validated = MembershipCreate.model_validate(student_payload(cne=value))
    assert validated.cne == normalized


@pytest.mark.parametrize("value", ["1234567890", "R12345678", "R1234567890", "R123456789\n", "ℝ123456789", "R１２３４５６７８９", "R1234 6789", "R123-56789"])
def test_invalid_massar_identifier_rejected(value):
    with pytest.raises(ValueError):
        MembershipCreate.model_validate(student_payload(cne=value))


@pytest.mark.parametrize("value", ["000012345", "abc123", "A" * 50])
def test_foreign_identifiers_preserve_digits_case_and_length(value):
    validated = MembershipCreate.model_validate(student_payload(identifier_type="FOREIGN", cne=f" {value} "))
    assert validated.cne == value


@pytest.mark.parametrize("value", ["", " " , "A" * 51, "A B", "A-B", "é123", "A\nB"])
def test_invalid_foreign_identifier_rejected(value):
    with pytest.raises(ValueError):
        MembershipCreate.model_validate(student_payload(identifier_type="FOREIGN", cne=value))


def test_promotion_options_and_all_supported_year_shapes(monkeypatch):
    assert promotion_options(2026) == ["2025/2026", "2024/2025", "2023/2024", "2022/2023", "2021/2022", "2020/2021"]
    assert [normalize_promotion(value, 2026) for value in promotion_options(2026)] == promotion_options(2026)
    assert [normalize_promotion(value, 2026) for value in ["2025/2026", "24/25", "2023", "23"]] == [
        "2025/2026", "2024/2025", "2023", "2023"
    ]
    assert normalize_promotion("1998/1999", 2026) == "1998/1999"
    monkeypatch.setattr(settings, "membership_current_academic_year_start", 2028)
    assert promotion_options(settings.membership_current_academic_year_start)[0] == "2027/2028"
    assert MembershipCreate.model_validate(laureate_payload(promotion="27/28")).promotion == "2027/2028"


@pytest.mark.parametrize("value", [
    "", "2026/2027", "26/27", "2027", "2023/2025", "23/2024", "2023/24",
    "graduated 2023", "２０２３", "Older", "Other",
])
def test_invalid_promotion_rejected(value, monkeypatch):
    monkeypatch.setattr(settings, "membership_current_academic_year_start", 2026)
    with pytest.raises(ValueError):
        MembershipCreate.model_validate(laureate_payload(promotion=value))


def test_application_persisted_and_available_only_on_private_surfaces(client, db_session):
    community = make_community(db_session)
    foreign_community = make_community(db_session, "other-membership-app")
    delegate, delegate_token = make_user(db_session, "application-delegate")
    db_session.add(Membership(user_id=delegate.id, community_id=community.id, cne="D1",
                              status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE))
    applicant, applicant_token = make_user(db_session, "application-student")
    db_session.commit()

    submitted = client.post(f"/api/v1/communities/{community.slug}/membership", json=student_payload(),
                            cookies={settings.session_cookie_name: applicant_token})
    assert submitted.status_code == 201
    row = db_session.query(Membership).filter_by(user_id=applicant.id, community_id=community.id).one()
    assert row.applicant_type is MembershipApplicantType.STUDENT
    assert row.applicant_first_name == "Élodie O'Neil-Smith" and row.applicant_family_name == "Ben Ali"
    assert row.identifier_type is MembershipIdentifierType.MASSAR and row.cne == "R123456789"
    assert row.promotion is None
    assert applicant.first_name == "Account" and applicant.family_name == "Holder"

    own = client.get(f"/api/v1/communities/{community.slug}/membership/me",
                     cookies={settings.session_cookie_name: applicant_token})
    assert own.status_code == 200 and own.headers["cache-control"] == "private, no-store"
    assert own.json()["membership"]["applicant_first_name"] == "Élodie O'Neil-Smith"
    assert own.json()["membership"]["cne"] == "R123456789"

    review = client.get(f"/api/v1/communities/{community.slug}/membership/pending",
                        cookies={settings.session_cookie_name: delegate_token})
    assert review.status_code == 200 and review.headers["cache-control"] == "private, no-store"
    detail = next(item for item in review.json() if item["username"] == applicant.username)
    assert detail["first_name"] == "Account" and detail["applicant_first_name"] == "Élodie O'Neil-Smith"
    assert detail["identifier_type"] == "MASSAR" and detail["cne"] == "R123456789"
    assert detail["promotion"] is None

    other, other_token = make_user(db_session, "application-other")
    denied = client.get(f"/api/v1/communities/{community.slug}/membership/pending",
                        cookies={settings.session_cookie_name: other_token})
    assert denied.status_code == 403
    other_own_response = client.get(
        f"/api/v1/communities/{community.slug}/membership/me",
        cookies={settings.session_cookie_name: other_token},
    )
    assert other_own_response.status_code == 200
    assert other_own_response.json()["membership"] is None

    foreign_delegate, foreign_delegate_token = make_user(db_session, "application-foreign-delegate")
    db_session.add(Membership(user_id=foreign_delegate.id, community_id=foreign_community.id, cne="D2",
                              status=MembershipStatus.ACTIVE, role=MembershipRole.DELEGATE))
    db_session.commit()
    cross_community = client.get(
        f"/api/v1/communities/{community.slug}/membership/pending",
        cookies={settings.session_cookie_name: foreign_delegate_token},
    )
    assert cross_community.status_code == 403

    directory = client.get(
        f"/api/v1/communities/{community.slug}/memberships?status=PENDING",
        cookies={settings.session_cookie_name: delegate_token},
    )
    assert directory.status_code == 200
    directory_member = next(item for item in directory.json()["items"] if item["id"] == str(row.id))
    assert not ({"cne", "applicant_type", "applicant_first_name", "applicant_family_name",
                 "identifier_type", "promotion"} & set(directory_member))

    active_response = client.get(
        f"/api/v1/communities/{community.slug}/membership/active",
        cookies={settings.session_cookie_name: delegate_token},
    )
    assert active_response.status_code == 200
    assert all(not ({"cne", "applicant_type", "applicant_first_name", "applicant_family_name",
                    "identifier_type", "promotion"} & set(item)) for item in active_response.json())


def test_laureate_persistence_and_reapplication_replaces_or_clears_old_fields(client, db_session):
    community = make_community(db_session, "membership-reapply")
    applicant, token = make_user(db_session, "membership-reapply-user")
    first = client.post(f"/api/v1/communities/{community.slug}/membership", json=student_payload(),
                        cookies={settings.session_cookie_name: token})
    assert first.status_code == 201
    row = db_session.query(Membership).filter_by(user_id=applicant.id).one()
    membership_id = row.id
    row.status = MembershipStatus.REJECTED
    db_session.commit()

    second = client.post(f"/api/v1/communities/{community.slug}/membership", json=laureate_payload(),
                         cookies={settings.session_cookie_name: token})
    assert second.status_code == 201
    db_session.refresh(row)
    assert row.id == membership_id and row.status is MembershipStatus.PENDING
    assert row.cne is None and row.identifier_type is None
    assert row.applicant_type is MembershipApplicantType.LAUREATE and row.promotion == "2023/2024"

    row.status = MembershipStatus.REJECTED
    db_session.commit()
    third = client.post(
        f"/api/v1/communities/{community.slug}/membership",
        json=student_payload(identifier_type="FOREIGN", cne="00123"),
        cookies={settings.session_cookie_name: token},
    )
    assert third.status_code == 201
    db_session.refresh(row)
    assert row.id == membership_id and row.cne == "00123"
    assert row.applicant_type is MembershipApplicantType.STUDENT
    assert row.identifier_type is MembershipIdentifierType.FOREIGN and row.promotion is None

    row.status = MembershipStatus.REMOVED
    db_session.commit()
    legacy = client.post(f"/api/v1/communities/{community.slug}/membership", json={"cne": "legacy raw"},
                         cookies={settings.session_cookie_name: token})
    assert legacy.status_code == 201
    db_session.refresh(row)
    assert row.cne == "legacy raw"
    assert row.applicant_type is None and row.applicant_first_name is None
    assert row.applicant_family_name is None and row.identifier_type is None and row.promotion is None


def test_application_options_are_authenticated_and_use_configured_policy(client, db_session, monkeypatch):
    community = make_community(db_session, "membership-options")
    user, token = make_user(db_session, "membership-options-user")
    monkeypatch.setattr(settings, "membership_current_academic_year_start", 2026)
    response = client.get(f"/api/v1/communities/{community.slug}/membership/application-options",
                          cookies={settings.session_cookie_name: token})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    data = response.json()
    assert data["current_academic_year_start"] == 2026
    assert data["promotion_options"] == promotion_options(2026)
    assert data["custom_promotion_formats"] == ["YYYY", "YY", "YYYY/YYYY", "YY/YY"]
    assert "applicant_first_name" not in data and "cne" not in data
    assert client.get(f"/api/v1/communities/{community.slug}/membership/application-options").status_code == 401
