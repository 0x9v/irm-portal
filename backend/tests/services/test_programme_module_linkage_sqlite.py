"""SQLite migration smoke checks; PostgreSQL acceptance is in the guarded PG suite."""
import importlib.util
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import MetaData, create_engine, event, inspect, select
from sqlalchemy.exc import IntegrityError

from app.database import Base
from app.models.module import Module


def _revision():
    path = Path(__file__).resolve().parents[2] / "alembic/versions/f4b8c1d2e390_link_modules_to_programmes.py"
    spec = importlib.util.spec_from_file_location("programme_module_linkage_revision", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _previous_metadata() -> MetaData:
    old = MetaData()
    for table in Base.metadata.sorted_tables:
        copied = table.to_metadata(old)
        if table.name != "modules":
            continue
        programme_column = copied.c.programme_id
        for constraint in list(copied.constraints):
            if any(column.name == "programme_id" for column in getattr(constraint, "columns", ())):
                copied.constraints.remove(constraint)
        for foreign_key in list(programme_column.foreign_keys):
            programme_column.foreign_keys.remove(foreign_key)
        for index in list(copied.indexes):
            if any(column.name == "programme_id" for column in index.columns):
                copied.indexes.remove(index)
        copied._columns.remove(programme_column)
    return old


def _run(revision, connection, operation):
    context = MigrationContext.configure(connection)
    with Operations.context(context):
        getattr(revision, operation)()


def test_module_programme_migration_links_only_linked_communities_and_downgrades_safely(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'module-programme.sqlite'}")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    old = _previous_metadata()
    old.create_all(engine)
    revision = _revision()
    now = datetime.now(timezone.utc)
    programme_id = uuid4()
    community_ids = [uuid4(), uuid4(), uuid4()]
    module_ids = [uuid4(), uuid4(), uuid4()]
    with engine.begin() as connection:
        connection.execute(old.tables["programmes"].insert().values(
            id=programme_id, slug="irm", name="IRM", institution_slug="fst-mohammedia",
            institution_name="FST Mohammedia", created_at=now, updated_at=now,
        ))
        connection.execute(old.tables["communities"].insert(), [
            {"id": community_ids[0], "name": "IRM", "slug": "irm", "programme_id": programme_id,
             "created_at": now, "updated_at": now},
            {"id": community_ids[1], "name": "IRM annual", "slug": "irm-annual", "programme_id": programme_id,
             "created_at": now, "updated_at": now},
            {"id": community_ids[2], "name": "Unlinked", "slug": "unlinked", "programme_id": None,
             "created_at": now, "updated_at": now},
        ])
        connection.execute(old.tables["modules"].insert(), [
            {"id": module_ids[0], "community_id": community_ids[0], "name": "Signals", "slug": "signals",
             "created_at": now, "updated_at": now},
            {"id": module_ids[1], "community_id": community_ids[1], "name": "Signals", "slug": "signals",
             "created_at": now, "updated_at": now},
            {"id": module_ids[2], "community_id": community_ids[2], "name": "Independent", "slug": "independent",
             "created_at": now, "updated_at": now},
        ])
        _run(revision, connection, "upgrade")
        module_rows = connection.execute(select(Module.__table__)).mappings().all()
        programme_by_id = {row["id"]: row["programme_id"] for row in module_rows}
        assert programme_by_id == {
            module_ids[0]: programme_id,
            module_ids[1]: programme_id,
            module_ids[2]: None,
        }

    assert Module.__table__.c.programme_id.nullable is True
    assert "ix_modules_programme_id" in {index["name"] for index in inspect(engine).get_indexes("modules")}
    assert any(constraint.name == "uq_modules_community_slug" for constraint in Module.__table__.constraints)
    assert not any(
        constraint["name"] == "uq_modules_programme_slug"
        for constraint in inspect(engine).get_unique_constraints("modules")
    )
    with engine.begin() as connection:
        foreign_keys = inspect(connection).get_foreign_keys("modules")
        programme_fk = next(item for item in foreign_keys if item["constrained_columns"] == ["programme_id"])
        assert programme_fk["referred_table"] == "programmes"
        try:
            connection.execute(Module.__table__.insert().values(
                id=uuid4(), community_id=community_ids[0], programme_id=uuid4(),
                name="Invalid", slug="invalid", created_at=now, updated_at=now,
            ))
        except IntegrityError:
            pass
        else:
            raise AssertionError("Module Programme FK should reject an unknown Programme")

    # Null the two links to exercise a safe schema-only downgrade; rows retain their IDs.
    with engine.begin() as connection:
        connection.execute(Module.__table__.update().values(programme_id=None))
        _run(revision, connection, "downgrade")
    assert "programme_id" not in {column["name"] for column in inspect(engine).get_columns("modules")}
    with engine.connect() as connection:
        assert {row[0] for row in connection.execute(select(old.tables["modules"].c.id)).all()} == set(module_ids)
    engine.dispose()
