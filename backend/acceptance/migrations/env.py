"""Standard Alembic commands on a caller-supplied, verified test connection."""
from alembic import context
from acceptance.isolation import SCHEMA_PATTERN, SafetyError, verify

config = context.config
connection = config.attributes.get("connection")
schema = config.attributes.get("schema", "")
if connection is None or not SCHEMA_PATTERN.fullmatch(schema):
    raise SafetyError("Acceptance Alembic requires an explicit isolated connection")
verify(connection, schema)
context.configure(connection=connection, version_table_schema=schema)
with context.begin_transaction():
    context.run_migrations()
