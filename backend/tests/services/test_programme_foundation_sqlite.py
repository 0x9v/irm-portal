"""SQLite migration and ORM checks; PostgreSQL coverage lives beside this file."""
import importlib.util
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import MetaData, create_engine, delete, event, inspect, select
from sqlalchemy.exc import IntegrityError

from app.database import Base
from app.models.community import Community
from app.models.programme import Programme


def _revision():
    path = Path(__file__).resolve().parents[2] / "alembic/versions/d9a1f3c7b205_add_programmes_and_link_irm.py"
    spec = importlib.util.spec_from_file_location("programme_foundation_revision", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _previous_metadata() -> MetaData:
    old = MetaData()
    for table in Base.metadata.sorted_tables:
        if table.name == "programmes":
            continue
        copied = table.to_metadata(old)
        if table.name not in {"communities", "modules"}:
            continue
        programme_column = copied.c.programme_id
        for constraint in list(copied.constraints):
            if any(column.name == "programme_id" for column in getattr(constraint, "columns", ())):
                copied.constraints.remove(constraint)
        for foreign_key in list(programme_column.foreign_keys):
            copied.foreign_keys.remove(foreign_key)
        for index in list(copied.indexes):
            if any(column.name == "programme_id" for column in index.columns):
                copied.indexes.remove(index)
        copied._columns.remove(programme_column)
    # Table.to_metadata() materializes a referenced-table stub. The prior
    # revision has no Programme table, so remove that stub after its FK column.
    if "programmes" in old.tables:
        old.remove(old.tables["programmes"])
    return old


def _upgrade(revision, connection, operation: str):
    context = MigrationContext.configure(connection)
    with Operations.context(context):
        getattr(revision, operation)()


def test_programme_model_and_sqlite_migration_preserve_irm_and_other_communities(tmp_path):
    assert Programme.__tablename__ == "programmes"
    assert Programme.__table__.c.slug.unique is not True
    assert any(
        constraint.name == "uq_programmes_slug"
        and [column.name for column in constraint.columns] == ["slug"]
        for constraint in Programme.__table__.constraints
    )
    assert Community.__table__.c.programme_id.nullable is True

    engine = create_engine(f"sqlite:///{tmp_path / 'programme-foundation.sqlite'}")
    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    old = _previous_metadata()
    old.create_all(engine)
    now = datetime.now(timezone.utc)
    user_id, irm_id, other_id, module_id, document_id = (uuid4() for _ in range(5))
    with engine.begin() as connection:
        connection.execute(old.tables["users"].insert().values(
            id=user_id, username="legacy", email="legacy@example.invalid", password_hash="hash",
            first_name="Legacy", family_name="User",
        ))
        connection.execute(old.tables["communities"].insert(), [
            {"id": irm_id, "name": "FST Mohammedia — IRM", "slug": "irm", "created_at": now, "updated_at": now},
            {"id": other_id, "name": "Unclassified", "slug": "unclassified", "created_at": now, "updated_at": now},
        ])
        connection.execute(old.tables["memberships"].insert().values(
            id=uuid4(), user_id=user_id, community_id=irm_id, cne="LEGACY-CNE", status="PENDING",
            role="MEMBER", created_at=now, updated_at=now,
        ))
        connection.execute(old.tables["modules"].insert().values(
            id=module_id, community_id=irm_id, name="Legacy module", slug="legacy-module",
            created_at=now, updated_at=now,
        ))
        connection.execute(old.tables["documents"].insert().values(
            id=document_id, module_id=module_id, uploader_id=user_id, title="Legacy file",
            type="COURSE", source="OFFICIAL", status="APPROVED",
            storage_path="existing/path/legacy.pdf", created_at=now, updated_at=now,
        ))

    revision = _revision()
    assert revision.down_revision == "c7e4a9d213f6"
    with engine.begin() as connection:
        _upgrade(revision, connection, "upgrade")
        community = connection.execute(
            select(Community.__table__.c.programme_id).where(Community.__table__.c.id == irm_id)
        ).scalar_one()
        assert community == revision.IRM_PROGRAMME_ID
        assert connection.execute(
            select(Community.__table__.c.programme_id).where(Community.__table__.c.id == other_id)
        ).scalar_one() is None
        assert connection.execute(select(old.tables["memberships"].c.cne)).scalar_one() == "LEGACY-CNE"
        assert connection.execute(select(old.tables["documents"].c.storage_path)).scalar_one() == "existing/path/legacy.pdf"
        foreign_keys = inspect(connection).get_foreign_keys("communities")
        programme_fk = next(item for item in foreign_keys if item["constrained_columns"] == ["programme_id"])
        assert programme_fk["referred_table"] == "programmes"
        assert any(
            row[2] == "programmes" and row[3] == "programme_id" and row[6] == "RESTRICT"
            for row in connection.exec_driver_sql("PRAGMA foreign_key_list(communities)").all()
        )
        try:
            connection.execute(delete(Programme.__table__).where(Programme.__table__.c.id == revision.IRM_PROGRAMME_ID))
        except IntegrityError:
            pass
        else:
            raise AssertionError("Programme FK should prevent deleting a referenced Programme")

    columns = {item["name"] for item in inspect(engine).get_columns("programmes")}
    assert columns == {"id", "slug", "name", "institution_slug", "institution_name", "created_at", "updated_at"}
    assert "ix_communities_programme_id" in {item["name"] for item in inspect(engine).get_indexes("communities")}
    with engine.begin() as connection:
        try:
            connection.execute(Community.__table__.insert().values(
                id=uuid4(), name="Bad reference", slug="bad-reference",
                document_vote_threshold=10, programme_id=uuid4(),
                created_at=now, updated_at=now,
            ))
        except IntegrityError:
            pass
        else:
            raise AssertionError("Programme foreign key should reject an unknown Programme")

    with engine.begin() as connection:
        try:
            _upgrade(revision, connection, "downgrade")
        except RuntimeError as error:
            assert "communities reference a Programme" in str(error)
        else:
            raise AssertionError("Downgrade should refuse linked communities")
    assert "programmes" in inspect(engine).get_table_names()
    engine.dispose()


def test_programme_migration_without_irm_creates_programme_only(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'programme-no-irm.sqlite'}")
    old = _previous_metadata()
    old.create_all(engine)
    now = datetime.now(timezone.utc)
    other_id = uuid4()
    with engine.begin() as connection:
        connection.execute(old.tables["communities"].insert().values(
            id=other_id, name="Unclassified", slug="unclassified", created_at=now, updated_at=now,
        ))

    revision = _revision()
    with engine.begin() as connection:
        _upgrade(revision, connection, "upgrade")
        assert connection.execute(select(Community.__table__.c.id).where(Community.__table__.c.slug == "irm")).first() is None
        assert connection.execute(select(Community.__table__.c.programme_id)).scalar_one() is None
        assert connection.execute(select(Programme.__table__.c.slug)).scalar_one() == "irm"

    # No community references the Programme, so this downgrade is safe.
    with engine.begin() as connection:
        _upgrade(revision, connection, "downgrade")
    assert "programmes" not in inspect(engine).get_table_names()
    assert "communities" in inspect(engine).get_table_names()
    engine.dispose()
