"""Explicit PostgreSQL identity, schema ownership, and migration guards."""
from contextlib import contextmanager
from dataclasses import dataclass, field
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
from uuid import uuid4

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import URL, create_engine, event, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

BACKEND = Path(__file__).resolve().parents[1]
HEAD = "e3a91c6d2f40"
DATABASE = "irm_integration_test"
ROLE = "irm_test"
SCHEMA_PATTERN = re.compile(r"irm_acceptance_[0-9a-f]{32}\Z")
TABLES = {"management_events", "discussion_reactions", "discussion_messages", "sticker_assets", "community_post_replies",
          "post_modules", "community_posts", "announcement_replies", "announcements", "document_votes",
          "document_reading_records", "saved_documents", "documents", "modules", "membership_permissions",
          "memberships", "sessions", "communities", "programmes", "users"}


class SafetyError(RuntimeError):
    """Messages are deliberately credential-free."""


@dataclass(frozen=True)
class TestConfig:
    host: str = "127.0.0.1"
    port: int = 5432
    database: str = DATABASE
    role: str = ROLE
    password: str | None = field(default=None, repr=False)

    def validate(self):
        try:
            loopback = ipaddress.ip_address(self.host).is_loopback
        except ValueError:
            loopback = False  # No DNS names or socket directories as alternate targets.
        if not loopback or self.database != DATABASE or self.role != ROLE or not 1 <= self.port <= 65535:
            raise SafetyError("Unapproved integration target")

    @classmethod
    def from_env(cls):
        value = cls(host=os.environ.get("IRM_ACCEPTANCE_DB_HOST", "127.0.0.1"),
                    port=int(os.environ.get("IRM_ACCEPTANCE_DB_PORT", "5432")),
                    password=os.environ.get("IRM_ACCEPTANCE_DB_PASSWORD"))
        value.validate()
        return value

    def url(self):
        self.validate()
        return URL.create("postgresql+psycopg", host=self.host, port=self.port,
                          database=self.database, username=self.role, password=self.password)

    def engine(self, schema="pg_catalog"):
        if schema != "pg_catalog" and not SCHEMA_PATTERN.fullmatch(schema):
            raise SafetyError("Invalid isolated schema name")
        return create_engine(self.url(), poolclass=NullPool, hide_parameters=True,
                             connect_args={"connect_timeout": 5, "options": f"-c search_path={schema}"})


def check_identity(row, schema):
    db, role, current, schemas, server_address, server_port = row
    if db != DATABASE or role != ROLE:
        raise SafetyError("Live database or role identity refused")
    if current != schema or list(schemas) != [schema]:
        raise SafetyError("Exclusive schema isolation refused (public fallback is forbidden)")
    # Docker server address/port are recorded separately, not compared to host port.
    if server_address is None or server_port is None:
        raise SafetyError("Expected a TCP PostgreSQL server identity")
    return {"database": db, "role": role, "schema": current,
            "server_address": str(server_address), "server_port": server_port}


IDENTITY_SQL = "SELECT current_database(), current_user, current_schema(), current_schemas(false), inet_server_addr(), inet_server_port()"


def verify(connection, schema, marker=None):
    identity = check_identity(connection.execute(text(IDENTITY_SQL)).one(), schema)
    if marker is not None:
        actual = connection.execute(text("SELECT obj_description(oid, 'pg_namespace') FROM pg_namespace WHERE nspname=:schema"), {"schema": schema}).scalar_one_or_none()
        if actual != marker:
            raise SafetyError("Schema ownership marker refused")
    return identity


@dataclass(frozen=True)
class Lease:
    schema: str
    nonce: str
    run_id: str

    @property
    def marker(self):
        return f"irm-acceptance:{self.run_id}:{self.nonce}"

    def validate(self, run_id):
        if not SCHEMA_PATTERN.fullmatch(self.schema) or self.run_id != run_id or not re.fullmatch(r"[0-9a-f]{32}", run_id) or not re.fullmatch(r"[0-9a-f]{32}", self.nonce):
            raise SafetyError("Cleanup lease refused")


def journal(path, lease):
    # Persist ownership before schema creation, including setup/interruption cases.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(descriptor, "a") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        stream.write(json.dumps(lease.__dict__) + "\n")
        stream.flush()
        os.fsync(stream.fileno())


def leases(path, run_id):
    if not Path(path).exists():
        return []
    result = []
    for line in Path(path).read_text().splitlines():
        lease = Lease(**json.loads(line))
        lease.validate(run_id)
        result.append(lease)
    return result


def migration_config(connection, schema):
    config = Config()
    config.set_main_option("path_separator", "os")
    config.set_main_option("script_location", str(BACKEND / "acceptance/migrations"))
    config.set_main_option("version_locations", str(BACKEND / "alembic/versions"))
    config.attributes.update(connection=connection, schema=schema)
    return config


def check_head():
    script = ScriptDirectory.from_config(migration_config(None, ""))
    if script.get_heads() != [HEAD]:
        raise SafetyError("Migration head changed; inspect before accepting new revisions")
    return HEAD


EXTERNAL_DETAILS_SQL = """SELECT DISTINCT dependent.type AS object_type,
    coalesce(dependent.schema, owner_ns.nspname) AS object_schema,
    dependent.identity AS object_identity, d.deptype
    FROM pg_depend d
    CROSS JOIN LATERAL pg_identify_object(d.refclassid, d.refobjid, d.refobjsubid) referenced
    CROSS JOIN LATERAL pg_identify_object(d.classid, d.objid, d.objsubid) dependent
    LEFT JOIN pg_class dependent_relation ON d.classid='pg_class'::regclass AND dependent_relation.oid=d.objid
    LEFT JOIN pg_rewrite rewrite ON d.classid='pg_rewrite'::regclass AND rewrite.oid=d.objid
    LEFT JOIN pg_constraint constraint_object ON d.classid='pg_constraint'::regclass AND constraint_object.oid=d.objid
    LEFT JOIN pg_trigger trigger_object ON d.classid='pg_trigger'::regclass AND trigger_object.oid=d.objid
    LEFT JOIN pg_attrdef default_object ON d.classid='pg_attrdef'::regclass AND default_object.oid=d.objid
    LEFT JOIN pg_class owner_relation ON owner_relation.oid=coalesce(rewrite.ev_class,
        nullif(constraint_object.conrelid, 0), trigger_object.tgrelid, default_object.adrelid)
    LEFT JOIN pg_namespace owner_ns ON owner_ns.oid=owner_relation.relnamespace
    WHERE referenced.schema = :schema
    AND coalesce(dependent.schema, owner_ns.nspname) IS DISTINCT FROM :schema
    -- Only a table's automatically owned TOAST relation is exempt. Do not
    -- ignore arbitrary internal dependencies or all PostgreSQL namespaces.
    AND NOT coalesce((d.deptype='i' AND dependent.schema='pg_toast'
        AND d.classid='pg_class'::regclass AND dependent_relation.relkind='t'), false)"""

EXTERNAL_SQL = 'SELECT count(*) FROM (' + EXTERNAL_DETAILS_SQL + ') dependencies'


def outside_relations(connection, schema):
    return set(connection.execute(text("""SELECT n.nspname, c.relname, c.relkind FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname <> :schema AND n.nspname NOT LIKE 'pg_%'
        AND n.nspname <> 'information_schema'"""), {"schema": schema}).all())


def migrate(engine, lease, target=HEAD, downgrade=False):
    check_head()
    with engine.begin() as connection:
        verify(connection, lease.schema, lease.marker)
        before = outside_relations(connection, lease.schema)
        config = migration_config(connection, lease.schema)
        (command.downgrade if downgrade else command.upgrade)(config, target)
        if outside_relations(connection, lease.schema) != before:
            raise SafetyError("Migration altered relations outside owned schema")


def verify_layout(engine, lease):
    with engine.connect() as connection:
        verify(connection, lease.schema, lease.marker)
        version = connection.execute(text(f'SELECT version_num FROM "{lease.schema}".alembic_version')).scalar_one()
        if version != HEAD:
            raise SafetyError("Schema-local Alembic version refused")
        columns = connection.execute(text("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema=:schema"), {"schema": lease.schema}).all()
        required = {("memberships", "status"), ("memberships", "role"), ("membership_permissions", "permission"),
                    ("management_events", "target_id"), ("sessions", "token_hash"),
                    ("communities", "programme_id"), ("programmes", "id"),
                    ("modules", "programme_id"),
                    ("programmes", "slug"), ("programmes", "name"),
                    ("programmes", "institution_slug"), ("programmes", "institution_name")}
        required.add(("users", "avatar_storage_key"))
        required |= {("sticker_assets", column) for column in ["id", "owner_id", "storage_key", "media_type", "width", "height", "byte_size", "created_at", "removed_at"]}
        required.add(("discussion_messages", "custom_sticker_id"))
        required |= {("community_post_replies", column) for column in ["image_storage_key", "client_request_id", "request_fingerprint"]}
        required |= {("documents", column) for column in ["description", "resource_kind", "image_storage_key", "youtube_video_id", "external_url"]}
        required |= {("documents", column) for column in ["removed_at", "removed_by_id"]}
        required |= {(table, column) for table in ["announcements", "announcement_replies", "community_posts", "community_post_replies", "discussion_messages"] for column in ["removed_at", "removed_by_id"]}
        if not required.issubset(set(columns)):
            raise SafetyError("Required acceptance columns missing")
        document_indexes = set(connection.execute(text("""SELECT indexname FROM pg_indexes
            WHERE schemaname=:schema AND tablename='documents'"""),
            {"schema": lease.schema}).scalars())
        if "ix_documents_module_resource_feed" not in document_indexes:
            raise SafetyError("Module resource pagination index missing")
        resource_constraints = set(connection.execute(text("""SELECT conname FROM pg_constraint c
            JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
            WHERE n.nspname=:schema AND t.relname='documents'"""),
            {"schema": lease.schema}).scalars())
        if not {"ck_document_resource_kind", "ck_document_resource_payload",
                "ck_document_resource_image_key", "uq_document_image_storage_key"}.issubset(resource_constraints):
            raise SafetyError("Typed document resource constraints missing")
        programme_index = connection.execute(text("""SELECT count(*) FROM pg_indexes
            WHERE schemaname=:schema AND indexname='ix_communities_programme_id'"""),
            {"schema": lease.schema}).scalar_one()
        module_programme_index = connection.execute(text("""SELECT count(*) FROM pg_indexes
            WHERE schemaname=:schema AND indexname='ix_modules_programme_id'"""),
            {"schema": lease.schema}).scalar_one()
        membership_indexes = set(connection.execute(text("""SELECT indexname FROM pg_indexes
            WHERE schemaname=:schema AND tablename='memberships'"""),
            {"schema": lease.schema}).scalars())
        programme_fk = connection.execute(text("""SELECT count(*) FROM pg_constraint c
            JOIN pg_class source ON source.oid=c.conrelid
            JOIN pg_namespace n ON n.oid=source.relnamespace
            JOIN pg_class target ON target.oid=c.confrelid
            WHERE n.nspname=:schema AND source.relname='communities'
              AND target.relname='programmes' AND c.contype='f'"""),
            {"schema": lease.schema}).scalar_one()
        module_programme_fk = connection.execute(text("""SELECT count(*) FROM pg_constraint c
            JOIN pg_class source ON source.oid=c.conrelid
            JOIN pg_namespace n ON n.oid=source.relnamespace
            JOIN pg_class target ON target.oid=c.confrelid
            WHERE n.nspname=:schema AND source.relname='modules'
              AND target.relname='programmes' AND c.contype='f'"""),
            {"schema": lease.schema}).scalar_one()
        module_constraints = connection.execute(text("""SELECT conname FROM pg_constraint c
            JOIN pg_class source ON source.oid=c.conrelid
            JOIN pg_namespace n ON n.oid=source.relnamespace
            WHERE n.nspname=:schema AND source.relname='modules' AND c.contype='u'"""),
            {"schema": lease.schema}).scalars()
        required_membership_indexes = {
            "uq_memberships_user_community",
            "uq_memberships_community_active_delegate",
        }
        if (programme_index != 1 or programme_fk != 1
                or module_programme_index != 1 or module_programme_fk != 1
                or "uq_modules_community_slug" not in set(module_constraints)
                or not required_membership_indexes.issubset(membership_indexes)
                or "uq_memberships_global_active_pending" in membership_indexes):
            raise SafetyError("Programme or membership index layout refused")
        outside = connection.execute(text("""SELECT count(*) FROM pg_constraint c
            JOIN pg_class source ON source.oid=c.conrelid JOIN pg_namespace sn ON sn.oid=source.relnamespace
            JOIN pg_class target ON target.oid=c.confrelid JOIN pg_namespace tn ON tn.oid=target.relnamespace
            WHERE c.contype='f' AND tn.nspname=:schema AND sn.nspname<>:schema"""), {"schema": lease.schema}).scalar_one()
        if outside:
            raise SafetyError("External schema dependency refused")


class OwnedDatabase:
    def __init__(self, config, run_id, journal_path):
        self.config, self.run_id, self.journal_path = config, run_id, Path(journal_path)
        self.lease = Lease("irm_acceptance_" + uuid4().hex, uuid4().hex, run_id)
        self.engine = None
        self.attempted = False
        self.server_identity = None

    def create(self, upgrade=True):
        self.config.validate()
        self.lease.validate(self.run_id)
        admin = self.config.engine()
        try:
            with admin.begin() as connection:
                self.server_identity = verify(connection, "pg_catalog")
                journal(self.journal_path, self.lease)
                self.attempted = True
                connection.execute(text(f'CREATE SCHEMA "{self.lease.schema}"'))
                # Marker and CREATE are committed atomically.
                connection.execute(text(f'COMMENT ON SCHEMA "{self.lease.schema}" IS \'{self.lease.marker}\''))
            self.engine = self.config.engine(self.lease.schema)
            if upgrade:
                migrate(self.engine, self.lease)
                verify_layout(self.engine, self.lease)
            install_checkout_guard(self.engine, self.lease)
            return self
        except BaseException:
            self.close()
            raise
        finally:
            admin.dispose()

    @property
    def factory(self):
        return sessionmaker(bind=self.engine, autoflush=False)

    def close(self):
        if self.engine is not None:
            self.engine.dispose()
        if self.attempted:
            drop_owned(self.config, self.lease, self.run_id)
            self.attempted = False


def drop_owned(config, lease, run_id):
    lease.validate(run_id)
    admin = config.engine()
    try:
        with admin.begin() as connection:
            verify(connection, "pg_catalog")
            marker = connection.execute(text("SELECT obj_description(oid, 'pg_namespace') FROM pg_namespace WHERE nspname=:schema"), {"schema": lease.schema}).scalar_one_or_none()
            if marker is None:
                exists = connection.execute(text("SELECT count(*) FROM pg_namespace WHERE nspname=:schema"), {"schema": lease.schema}).scalar_one()
                if exists:
                    raise SafetyError("Unmarked schema cannot be cleaned up")
                return
            if marker != lease.marker:
                raise SafetyError("Cleanup ownership marker refused")
            # A schema created by this run must never have external dependents.
            external = connection.execute(text("""SELECT count(*) FROM pg_constraint c
                JOIN pg_class a ON a.oid=c.conrelid JOIN pg_namespace an ON an.oid=a.relnamespace
                JOIN pg_class b ON b.oid=c.confrelid JOIN pg_namespace bn ON bn.oid=b.relnamespace
                WHERE c.contype='f' AND bn.nspname=:schema AND an.nspname<>:schema"""), {"schema": lease.schema}).scalar_one()
            external += connection.execute(text(EXTERNAL_SQL), {"schema": lease.schema}).scalar_one()
            if external:
                objects = connection.execute(text(EXTERNAL_DETAILS_SQL), {"schema": lease.schema}).all()
                raise SafetyError(f"External dependencies prevent safe cleanup of schema {lease.schema}: {objects}")
            connection.execute(text(f'DROP SCHEMA "{lease.schema}" CASCADE'))
    finally:
        admin.dispose()


def install_checkout_guard(engine, lease):
    # Instance-local pool hook, never an application-wide Engine hook.
    def guard(raw, record, proxy):
        previous = raw.autocommit
        raw.autocommit = True
        try:
            with raw.cursor() as cursor:
                cursor.execute(IDENTITY_SQL)
                check_identity(cursor.fetchone(), lease.schema)
                cursor.execute("SELECT obj_description(oid, 'pg_namespace') FROM pg_namespace WHERE nspname=%s", (lease.schema,))
                if cursor.fetchone()[0] != lease.marker:
                    raise SafetyError("Pooled connection ownership refused")
        finally:
            raw.autocommit = previous
    event.listen(engine, "checkout", guard)


class AttachedDatabase:
    """Children may use a lease but cannot choose cleanup targets."""
    def __init__(self):
        self.config = TestConfig.from_env()
        self.lease = Lease(os.environ["IRM_ACCEPTANCE_SCHEMA"], os.environ["IRM_ACCEPTANCE_NONCE"], os.environ["IRM_ACCEPTANCE_RUN_ID"])
        self.lease.validate(os.environ["IRM_ACCEPTANCE_RUN_ID"])
        self.engine = self.config.engine(self.lease.schema)
        verify_layout(self.engine, self.lease)
        install_checkout_guard(self.engine, self.lease)
        self.factory = sessionmaker(bind=self.engine, autoflush=False)

    def verify_session(self, session):
        return verify(session.connection(), self.lease.schema, self.lease.marker)

    def truncate(self, session, names):
        self.verify_session(session)
        if not names or not set(names).issubset(TABLES):
            raise SafetyError("Unapproved truncation table")
        # Layout verification also rejects cross-schema cascade dependencies.
        verify_layout(self.engine, self.lease)
        targets = ', '.join(f'"{self.lease.schema}"."{name}"' for name in names)
        session.execute(text(f"TRUNCATE TABLE {targets} CASCADE"))

    def close(self):
        self.engine.dispose()


@contextmanager
def disposable_database(upgrade=True):
    config = TestConfig.from_env()
    resource = OwnedDatabase(config, os.environ["IRM_ACCEPTANCE_RUN_ID"], os.environ["IRM_ACCEPTANCE_JOURNAL"])
    try:
        yield resource.create(upgrade=upgrade)
    finally:
        resource.close()
