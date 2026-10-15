from datetime import timedelta

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
from app.models.membership import Membership, MembershipApplicantType, MembershipStatus
from app.models.module import Module
from app.models.programme import Programme
from app.models.user import User


engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autoflush=False, bind=engine)


def override_get_db():
    with TestingSessionLocal() as db:
        yield db


def test_existing_module_and_self_membership_api_shapes_do_not_expose_programme():
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.create_all(bind=engine)
    try:
        with TestingSessionLocal() as db:
            user = User(
                username="programme_api_user",
                email="programme_api_user@example.invalid",
                password_hash="hash",
                first_name="Applicant",
                family_name="User",
            )
            programme = Programme(
                slug="irm", name="IRM", institution_slug="fst-mohammedia",
                institution_name="FST Mohammedia",
            )
            db.add(user)
            db.flush()
            community = Community(name="FST Mohammedia — IRM", slug="irm", programme=programme)
            sibling = Community(name="IRM annual community", slug="irm-next", programme=programme)
            db.add_all([community, sibling])
            db.flush()
            module = Module(community_id=community.id, name="Signals", slug="signals")
            sibling_module = Module(community_id=sibling.id, name="Signals next year", slug="signals")
            module.programme_id = programme.id
            sibling_module.programme_id = programme.id
            membership = Membership(
                user_id=user.id,
                community_id=community.id,
                cne="LEGACY-CNE",
                applicant_type=MembershipApplicantType.STUDENT,
                applicant_first_name="Applicant",
                applicant_family_name="User",
                status=MembershipStatus.PENDING,
            )
            db.add_all([module, sibling_module, membership])
            db.commit()
            raw_token, _ = create_session(db, user.id, timedelta(days=1))

        client = TestClient(app)
        cookies = {settings.session_cookie_name: raw_token}
        module_response = client.get("/api/v1/communities/irm/modules/signals", cookies=cookies)
        assert module_response.status_code == 200
        assert set(module_response.json()) == {
            "id", "community_id", "name", "slug", "created_at", "updated_at"
        }
        sibling_response = client.get("/api/v1/communities/irm-next/modules/signals", cookies=cookies)
        assert sibling_response.status_code == 200
        assert sibling_response.json()["community_id"] != module_response.json()["community_id"]
        assert sibling_response.json()["id"] != module_response.json()["id"]
        assert "programme_id" not in sibling_response.json()

        membership_response = client.get("/api/v1/communities/irm/membership/me", cookies=cookies)
        assert membership_response.status_code == 200
        body = membership_response.json()
        assert set(body) == {"membership", "capabilities"}
        assert set(body["membership"]) == {
            "id", "status", "role", "cne", "applicant_type", "applicant_first_name",
            "applicant_family_name", "identifier_type", "promotion",
        }
        assert "programme" not in str(body).lower()
    finally:
        Base.metadata.drop_all(bind=engine)
        app.dependency_overrides.clear()
        engine.dispose()
