"""Explicit, bounded sticker maintenance. Run from backend with python -m scripts.sticker_maintenance."""

import argparse
import json
import os
from pathlib import Path
import stat
import sys
from uuid import UUID

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.core.storage.local import LocalFileSystemStorage
from app.services.sticker_cleanup import CleanupLimits, run_asset_cleanup, run_namespace_inventory


EXPECTED_HEAD = "d1e2f3a4b5c6"


class TargetRefused(Exception):
    pass


def _absolute_directory(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute() or not path.is_dir():
        raise TargetRefused("Storage target must be an existing absolute directory")
    # The storage provider trusts its root, so reject symlink components here.
    for component in (path, *path.parents):
        if component.is_symlink() or not stat.S_ISDIR(component.lstat().st_mode):
            raise TargetRefused("Storage target contains an unsafe directory")
    return path.resolve(strict=True)


def _target(engine, *, database: str, role: str, schema: str, apply: bool,
            storage_root: Path, marker: str | None, owner_apply: bool,
            expected_server: str | None, expected_port: int | None) -> dict[str, str]:
    url = engine.url
    if url.get_backend_name() == "postgresql":
        if not database or not role or not schema or schema == "pg_catalog":
            raise TargetRefused("Explicit PostgreSQL identity and application schema are required")
        with engine.connect() as connection:
            row = connection.execute(text(
                "SELECT current_database(), current_user, current_schema(), "
                "current_schemas(false), inet_server_addr(), inet_server_port()"
            )).one()
            if (row[0], row[1], row[2]) != (database, role, schema) or list(row[3]) != [schema]:
                raise TargetRefused("PostgreSQL identity or exclusive search path mismatch")
            if row[4] is None or row[5] is None:
                raise TargetRefused("TCP PostgreSQL identity required")
            head = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            if head != EXPECTED_HEAD:
                raise TargetRefused("Database migration head mismatch")
            actual_marker = connection.execute(text(
                "SELECT obj_description(oid, 'pg_namespace') FROM pg_namespace WHERE nspname=:name"
            ), {"name": schema}).scalar_one_or_none()
            if marker is not None and actual_marker != marker:
                raise TargetRefused("Schema ownership marker mismatch")
            acceptance_schema = schema.startswith("irm_acceptance_")
            if acceptance_schema:
                from acceptance.isolation import DATABASE, ROLE, SCHEMA_PATTERN, TestConfig

                if (database, role) != (DATABASE, ROLE) or not SCHEMA_PATTERN.fullmatch(schema):
                    raise TargetRefused("Isolated integration identity mismatch")
                TestConfig(host=url.host or "", port=url.port or 5432,
                           database=database, role=role).validate()
                if not actual_marker or not actual_marker.startswith("irm-acceptance:"):
                    raise TargetRefused("Isolated schema ownership marker missing")
                if apply and (owner_apply or marker != actual_marker):
                    raise TargetRefused("Exact integration lease marker required for apply")
            elif apply and (not owner_apply or expected_server != str(row[4])
                             or expected_port != row[5]):
                raise TargetRefused("Explicit owner target and server identity required for apply")
        def verify_checkout(raw, _record, _proxy):
            previous = raw.autocommit
            raw.autocommit = True
            try:
                with raw.cursor() as cursor:
                    cursor.execute(
                        "SELECT current_database(), current_user, current_schema(), "
                        "current_schemas(false), inet_server_addr(), inet_server_port()"
                    )
                    live = cursor.fetchone()
                    if ((live[0], live[1], live[2]) != (database, role, schema)
                            or list(live[3]) != [schema]
                            or str(live[4]) != str(row[4]) or live[5] != row[5]):
                        raise TargetRefused("PostgreSQL identity changed after preflight")
                    if marker is not None:
                        cursor.execute(
                            "SELECT obj_description(oid, 'pg_namespace') FROM pg_namespace WHERE nspname=%s",
                            (schema,),
                        )
                        if cursor.fetchone()[0] != marker:
                            raise TargetRefused("Schema ownership marker changed after preflight")
            finally:
                raw.autocommit = previous

        event.listen(engine, "checkout", verify_checkout)
        return {"database": database, "role": role, "schema": schema,
                "server": f"{row[4]}:{row[5]}", "storage_root": str(storage_root)}
    if url.get_backend_name() == "sqlite":
        if owner_apply:
            raise TargetRefused("Owner apply mode is PostgreSQL-only")
        db_file = Path(url.database or "")
        if database != str(db_file) or role != "sqlite" or schema != "main" or not db_file.is_absolute():
            raise TargetRefused("Explicit SQLite file identity mismatch")
        with engine.connect() as connection:
            files = connection.execute(text("PRAGMA database_list")).all()
            if len(files) != 1 or Path(files[0][2]).resolve() != db_file.resolve():
                raise TargetRefused("SQLite database file mismatch")
        if apply:
            # A standalone maintenance command must never mutate an arbitrary
            # SQLite owner/development database. Test data stays under /tmp.
            test_base = Path("/tmp").resolve()
            if (not db_file.resolve().is_relative_to(test_base)
                    or not storage_root.is_relative_to(test_base)
                    or "irm-sticker-maintenance-test-" not in str(db_file.parent)
                    or "irm-sticker-maintenance-test-" not in str(storage_root)):
                raise TargetRefused("SQLite apply is restricted to isolated temporary test targets")
        def verify_sqlite_checkout(raw, _record, _proxy):
            cursor = raw.cursor()
            try:
                cursor.execute("PRAGMA database_list")
                live_files = cursor.fetchall()
                if len(live_files) != 1 or Path(live_files[0][2]).resolve() != db_file.resolve():
                    raise TargetRefused("SQLite database file changed after preflight")
            finally:
                cursor.close()

        event.listen(engine, "checkout", verify_sqlite_checkout)
        return {"database": str(db_file), "role": "sqlite", "schema": "main",
                "server": "local", "storage_root": str(storage_root)}
    raise TargetRefused("Unsupported database engine")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("assets", "orphans", "temporaries"), default="assets")
    parser.add_argument("--apply", action="store_true", help="Delete eligible DB-backed assets (assets mode only)")
    parser.add_argument("--storage-root", required=True)
    parser.add_argument("--expected-storage-root", required=True)
    parser.add_argument("--expected-database", required=True)
    parser.add_argument("--expected-role", required=True)
    parser.add_argument("--expected-schema", required=True)
    parser.add_argument("--expected-schema-marker")
    parser.add_argument("--owner-apply", action="store_true",
                        help="Explicit owner PostgreSQL apply after reviewing a dry run")
    parser.add_argument("--expected-server-address")
    parser.add_argument("--expected-server-port", type=int)
    parser.add_argument("--after-id", type=UUID)
    parser.add_argument("--after-ordinal", type=int, default=0)
    parser.add_argument("--max-rows", type=int, default=100)
    parser.add_argument("--max-files", type=int, default=50)
    parser.add_argument("--max-bytes", type=int, default=25 * 1024 * 1024)
    parser.add_argument("--max-seconds", type=int, default=30)
    args = parser.parse_args(argv)
    engine = None
    try:
        if args.apply and args.mode != "assets":
            raise TargetRefused("Filesystem inventory modes are dry-run-only")
        if args.owner_apply and not args.apply:
            raise TargetRefused("Owner target switch requires apply mode")
        if (args.mode == "assets" and args.after_ordinal != 0) or (
            args.mode != "assets" and args.after_id is not None
        ):
            raise TargetRefused("Cursor does not match mode")
        root = _absolute_directory(args.storage_root)
        expected_root = _absolute_directory(args.expected_storage_root)
        if root != expected_root:
            raise TargetRefused("Storage root identity mismatch")
        limits = CleanupLimits(args.max_rows, args.max_files, args.max_bytes, args.max_seconds)
        limits.validate()
        database_url = os.environ.get("IRM_STICKER_MAINTENANCE_DATABASE_URL")
        if not database_url:
            raise TargetRefused("Explicit maintenance database URL environment variable required")
        url = make_url(database_url)
        engine = create_engine(url, pool_pre_ping=True, hide_parameters=True)
        identity = _target(engine, database=args.expected_database, role=args.expected_role,
                           schema=args.expected_schema, apply=args.apply, storage_root=root,
                           marker=args.expected_schema_marker, owner_apply=args.owner_apply,
                           expected_server=args.expected_server_address,
                           expected_port=args.expected_server_port)
        print(json.dumps({"target": identity, "mode": args.mode,
                          "apply": args.apply, "limits": limits.__dict__}), flush=True)
        factory = sessionmaker(bind=engine, expire_on_commit=False)
        storage = LocalFileSystemStorage(root)
        if args.mode == "assets":
            report = run_asset_cleanup(factory, storage, limits, after_id=args.after_id,
                                       apply=args.apply)
        else:
            report = run_namespace_inventory(factory, storage, limits, mode=args.mode,
                                             after_ordinal=args.after_ordinal)
        print(json.dumps(report.sanitized()), flush=True)
        return 0 if report.failed == 0 else 1
    except (Exception, KeyboardInterrupt) as error:
        # Neither credentials, SQL, paths/keys nor decoder/storage internals
        # belong in maintenance output.
        print(json.dumps({"error": "maintenance_refused_or_failed", "type": type(error).__name__}),
              file=sys.stderr)
        return 2
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
