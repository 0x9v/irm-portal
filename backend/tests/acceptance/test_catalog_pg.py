"""Live proof of internal TOAST classification and external dependency refusal."""
import pytest
from sqlalchemy import text

from acceptance.isolation import (disposable_database, drop_owned, EXTERNAL_SQL,
                                  EXTERNAL_DETAILS_SQL, SafetyError)


def test_toast_is_internal_but_owned_cross_schema_view_and_fk_block_cleanup():
    with disposable_database(upgrade=False) as target, disposable_database(upgrade=False) as dependent:
        with target.engine.begin() as connection:
            connection.execute(text('CREATE TABLE sample (id integer PRIMARY KEY, body text)'))
            # The original query counted this internal dependency as external.
            internal = connection.execute(text("""SELECT t.relname FROM pg_class c
                JOIN pg_class t ON t.oid=c.reltoastrelid
                JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=t.oid
                    AND d.refclassid='pg_class'::regclass AND d.refobjid=c.oid
                WHERE c.relnamespace=to_regnamespace(:schema) AND d.deptype='i'"""),
                {'schema': target.lease.schema}).all()
            assert len(internal) == 1
            assert connection.execute(text(EXTERNAL_SQL), {'schema': target.lease.schema}).scalar_one() == 0
        try:
            with dependent.engine.begin() as connection:
                connection.execute(text(f'CREATE VIEW sample_view AS SELECT * FROM "{target.lease.schema}".sample'))
                connection.execute(text(f'CREATE TABLE sample_fk (id integer REFERENCES "{target.lease.schema}".sample(id))'))
            with target.engine.connect() as connection:
                objects = connection.execute(text(EXTERNAL_DETAILS_SQL), {'schema': target.lease.schema}).all()
                assert objects and all(row.object_schema == dependent.lease.schema for row in objects)
                assert any('sample_view' in row.object_identity for row in objects)
                assert any('sample_fk' in row.object_identity for row in objects)
            with pytest.raises(SafetyError, match=dependent.lease.schema):
                drop_owned(target.config, target.lease, target.run_id)
        finally:
            # Explicitly remove only this test's known objects before guarded drops.
            with dependent.engine.begin() as connection:
                connection.execute(text('DROP VIEW IF EXISTS sample_view'))
                connection.execute(text('DROP TABLE IF EXISTS sample_fk'))
        with target.engine.connect() as connection:
            assert connection.execute(text(EXTERNAL_SQL), {'schema': target.lease.schema}).scalar_one() == 0
