"""Membership application storage migration lifecycle on a guarded disposable schema."""
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.community import Community
from app.models.membership import (
    Membership,
    MembershipApplicantType,
    MembershipIdentifierType,
    MembershipRole,
    MembershipStatus,
)
from app.models.membership_permission import MembershipPermission, PermissionType
from app.models.user import User
from app.services.membership import create_membership_request
from app.services.provisioning import appoint_delegate
from acceptance.isolation import disposable_database, migrate


PREVIOUS_HEAD = "c4d8e9f1a2b3"
NEW_HEAD = "98b4d2a6f731"


def make_user(key: str) -> User:
    return User(username=f"application_{key}", email=f"application_{key}@example.invalid",
                password_hash="synthetic-hash", first_name="Account", family_name="Name")


def test_membership_application_fields_upgrade_compatibility_and_downgrade():
    with disposable_database(upgrade=False) as resource:
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD)
        now = datetime.now(timezone.utc)
        users = {key: make_user(key) for key in ["pending", "rejected", "removed", "student", "laureate", "delegate", "invalid"]}
        communities = [Community(name="Synthetic IRM", slug="synthetic-irm"),
                       Community(name="Synthetic second", slug="synthetic-second")]
        with Session(resource.engine) as db:
            db.add_all([*users.values(), *communities])
            db.commit()
            ids = {key: user.id for key, user in users.items()}
            community_ids = [community.id for community in communities]
            community_slugs = [community.slug for community in communities]

        legacy = [
            ("pending", communities[0], "LEGACY_PENDING", "PENDING", "MEMBER"),
            ("rejected", communities[0], "LEGACY_REJECTED", "REJECTED", "MEMBER"),
            ("removed", communities[0], "LEGACY_REMOVED", "REMOVED", "MEMBER"),
        ]
        legacy_ids = {}
        with resource.engine.begin() as connection:
            for key, community, cne, status, role in legacy:
                membership_id = uuid4()
                legacy_ids[key] = membership_id
                connection.execute(text("""INSERT INTO memberships
                    (id,user_id,community_id,cne,status,role,created_at,updated_at)
                    VALUES (:id,:user,:community,:cne,:status,:role,:created,:updated)"""), {
                    "id": membership_id, "user": ids[key], "community": community.id,
                    "cne": cne, "status": status, "role": role, "created": now, "updated": now,
                })
            connection.execute(text("""INSERT INTO membership_permissions (id,membership_id,permission)
                VALUES (:id,:membership,'CREATE_ANNOUNCEMENTS')"""),
                {"id": uuid4(), "membership": legacy_ids["pending"]})

        migrate(resource.engine, resource.lease, NEW_HEAD)
        columns = {column["name"]: column for column in inspect(resource.engine).get_columns("memberships")}
        assert columns["cne"]["nullable"] is True
        assert columns["applicant_type"]["nullable"] is True and columns["applicant_type"]["type"].length == 20
        assert columns["applicant_first_name"]["nullable"] is True and columns["applicant_first_name"]["type"].length == 100
        assert columns["applicant_family_name"]["nullable"] is True and columns["applicant_family_name"]["type"].length == 100
        assert columns["identifier_type"]["nullable"] is True and columns["identifier_type"]["type"].length == 20
        assert columns["promotion"]["nullable"] is True and columns["promotion"]["type"].length == 20
        constraints = {item["name"]: item["sqltext"] for item in inspect(resource.engine).get_check_constraints("memberships")}
        assert "membership_applicant_type" in constraints
        constraint_sql = constraints["membership_applicant_type"]
        assert "'STUDENT'" in constraint_sql and "'LAUREATE'" in constraint_sql
        assert "membership_identifier_type" in constraints
        assert "'MASSAR'" in constraints["membership_identifier_type"]
        assert "'FOREIGN'" in constraints["membership_identifier_type"]

        with Session(resource.engine) as db:
            for key, _, original_cne, original_status, original_role in legacy:
                row = db.get(Membership, legacy_ids[key])
                assert row.cne == original_cne
                assert row.status.value == original_status and row.role.value == original_role
                assert row.user_id == ids[key] and row.community_id == community_ids[0]
                assert row.created_at == now and row.updated_at == now
                assert row.applicant_type is None and row.applicant_first_name is None
                assert row.applicant_family_name is None and row.identifier_type is None and row.promotion is None
            assert db.query(MembershipPermission).filter_by(
                membership_id=legacy_ids["pending"],
                permission=PermissionType.CREATE_ANNOUNCEMENTS).count() == 1

            student = Membership(user_id=ids["student"], community_id=community_ids[0],
                                 cne="R123456789", status=MembershipStatus.PENDING,
                                 applicant_type=MembershipApplicantType.STUDENT,
                                 identifier_type=MembershipIdentifierType.MASSAR,
                                 applicant_first_name="Student", applicant_family_name="Applicant")
            laureate = Membership(user_id=ids["laureate"], community_id=community_ids[0],
                                  cne=None, status=MembershipStatus.PENDING,
                                  applicant_type=MembershipApplicantType.LAUREATE,
                                  applicant_first_name="Laureate", applicant_family_name="Applicant",
                                  promotion="2023/2024")
            db.add_all([student, laureate])
            db.commit()
            db.refresh(student); db.refresh(laureate)
            student_id, laureate_id = student.id, laureate.id
            assert student.cne == "R123456789" and student.applicant_type is MembershipApplicantType.STUDENT
            assert student.identifier_type is MembershipIdentifierType.MASSAR
            assert laureate.cne is None and laureate.applicant_type is MembershipApplicantType.LAUREATE
            assert laureate.promotion == "2023/2024"

            invalid = text("""INSERT INTO memberships
                (id,user_id,community_id,cne,status,role,created_at,updated_at,applicant_type)
                VALUES (:id,:user,:community,'INVALID','PENDING','MEMBER',:now,:now,'VISITOR')""")
            with pytest.raises(IntegrityError):
                db.execute(invalid, {"id": uuid4(), "user": ids["invalid"],
                                     "community": community_ids[0], "now": now})
                db.commit()
            db.rollback()

            with pytest.raises(IntegrityError):
                db.add(Membership(user_id=ids["student"], community_id=community_ids[1],
                                  cne="SECOND_PENDING", status=MembershipStatus.PENDING))
                db.commit()
            db.rollback()

            # Existing service paths keep their prior application and appointment behavior;
            # neither path fabricates applicant details.
            reapplication = create_membership_request(db, db.get(User, ids["rejected"]), community_slugs[0], "REAPPLIED_CNE")
            assert reapplication.id == legacy_ids["rejected"]
            assert reapplication.status is MembershipStatus.PENDING and reapplication.cne == "REAPPLIED_CNE"
            assert reapplication.applicant_type is None and reapplication.applicant_first_name is None
            success, _ = appoint_delegate(db, community_slugs[1], str(ids["delegate"]), cne="DELEGATE_CNE", apply=True)
            assert success
            delegate = db.query(Membership).filter_by(user_id=ids["delegate"], community_id=community_ids[1]).one()
            assert delegate.role is MembershipRole.DELEGATE and delegate.applicant_type is None
            db.commit()

        # NULL identifiers are valid in the new schema, so downgrade must refuse
        # before dropping any column or changing the Alembic version.
        with pytest.raises(RuntimeError, match=r"1 membership row\(s\) have NULL cne"):
            migrate(resource.engine, resource.lease, PREVIOUS_HEAD, downgrade=True)
        assert "applicant_type" in {column["name"] for column in inspect(resource.engine).get_columns("memberships")}

        with Session(resource.engine) as db:
            db.delete(db.get(Membership, laureate_id))
            db.commit()
        migrate(resource.engine, resource.lease, PREVIOUS_HEAD, downgrade=True)
        old_columns = {column["name"] for column in inspect(resource.engine).get_columns("memberships")}
        assert "cne" in old_columns and "applicant_type" not in old_columns
        with Session(resource.engine) as db:
            assert db.get(Membership, student_id).cne == "R123456789"

        migrate(resource.engine, resource.lease, NEW_HEAD)
        with Session(resource.engine) as db:
            old_student = db.get(Membership, student_id)
            assert old_student.cne == "R123456789" and old_student.applicant_type is None
            assert old_student.applicant_first_name is None and old_student.promotion is None
