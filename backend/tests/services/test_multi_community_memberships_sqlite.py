"""Fast SQLite model/migration checks; these do not replace PostgreSQL acceptance."""
import importlib.util
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from app.database import Base
from app.models.community import Community
from app.models.membership import Membership, MembershipStatus
from app.models.user import User


def revision_module():
    path = Path(__file__).resolve().parents[2] / "alembic/versions/e4b6c8d0f219_scope_membership_lifecycle_to_community.py"
    spec = importlib.util.spec_from_file_location("community_membership_revision", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_revision(connection, module, name):
    context = MigrationContext.configure(connection)
    with Operations.context(context):
        getattr(module, name)()


def test_sqlite_membership_index_migration_and_model_constraints(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'multi-membership.sqlite'}")
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text("CREATE UNIQUE INDEX uq_memberships_global_active_pending "
                                "ON memberships (user_id) WHERE status IN ('PENDING', 'ACTIVE')"))

    with Session(engine) as db:
        user = User(username="multi", email="multi@example.invalid", password_hash="synthetic",
                    first_name="Multi", family_name="Community")
        communities = [Community(name="A", slug="sqlite-a"), Community(name="B", slug="sqlite-b")]
        db.add_all([user, *communities])
        db.flush()
        first = Membership(user_id=user.id, community_id=communities[0].id, cne="A", status=MembershipStatus.ACTIVE)
        db.add(first)
        db.commit()
        first_id, user_id = first.id, user.id
        community_ids = [community.id for community in communities]

    module = revision_module()
    with engine.begin() as connection:
        run_revision(connection, module, "upgrade")
    assert "uq_memberships_global_active_pending" not in {
        index["name"] for index in inspect(engine).get_indexes("memberships")
    }

    with Session(engine) as db:
        second = Membership(user_id=user_id, community_id=community_ids[1], cne="B",
                            status=MembershipStatus.PENDING)
        db.add(second)
        db.commit()
        second_id = second.id
        with pytest.raises(Exception, match="Cannot restore global PENDING/ACTIVE membership exclusivity"):
            run_revision(db.connection(), module, "downgrade")
        db.rollback()

    assert "uq_memberships_global_active_pending" not in {
        index["name"] for index in inspect(engine).get_indexes("memberships")
    }
    with Session(engine) as db:
        assert db.get(Membership, first_id).status is MembershipStatus.ACTIVE
        second = db.get(Membership, second_id)
        second.status = MembershipStatus.REJECTED
        db.commit()

    with engine.begin() as connection:
        run_revision(connection, module, "downgrade")
    assert "uq_memberships_global_active_pending" in {
        index["name"] for index in inspect(engine).get_indexes("memberships")
    }
    engine.dispose()
