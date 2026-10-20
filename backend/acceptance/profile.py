"""Focused profile API/guarded PostgreSQL acceptance, isolated to this process."""
import argparse
import asyncio
from contextlib import contextmanager
import json
import os
from pathlib import Path
import signal
import tempfile
from uuid import uuid4

from acceptance.isolation import BACKEND, OwnedDatabase, TestConfig


API_SUITES = [
    "tests/api/v1/test_profile_editing.py",
    "tests/api/v1/test_auth.py",
    "tests/api/v1/test_auth_me.py",
]
PG_SUITES = ["tests/services/test_user_profile_pg.py"]
PASSWORD_API_SUITES = ["tests/api/v1/test_password_change.py", *API_SUITES,
                       "tests/core/test_sessions.py", "tests/core/test_security.py"]
PASSWORD_PG_SUITES = ["tests/services/test_password_change_pg.py",
                      "tests/services/test_user_profile_pg.py"]
PASSWORD_LIVE_SOCKET_PG_SUITES = [
    "tests/services/test_password_change_pg.py::test_live_socket_closes_on_password_revocation_at_policy_interval",
]
AVATAR_API_SUITES = ["tests/api/v1/test_profile_editing.py", "tests/api/v1/test_auth_me.py",
                     "tests/api/v1/test_auth.py",
                     "tests/api/v1/test_avatar_api.py", "tests/core/test_storage.py",
                     "tests/core/test_avatars.py", "tests/core/test_avatar_processing.py",
                     "tests/services/test_user_avatar_migration_sqlite.py"]
AVATAR_PG_SUITES = ["tests/services/test_user_avatar_migration_pg.py",
                    "tests/services/test_avatar_concurrency_pg.py"]
STICKER_PG_SUITES = ["tests/services/test_sticker_foundation_pg.py"]
STICKER_LIBRARY_PG_SUITES = ["tests/services/test_sticker_library_pg.py"]
STICKER_API_SUITES = ["tests/api/v1/test_sticker_library.py", "tests/core/test_stickers.py",
                      "tests/core/test_storage.py"]
DISCUSSION_STICKER_API_SUITES = ["tests/api/v1/test_discussion.py",
                                 "tests/api/v1/test_content_removal.py",
                                 "tests/api/v1/test_sticker_library.py"]
DISCUSSION_STICKER_PG_SUITES = ["tests/services/test_discussion_custom_stickers_pg.py",
                                "tests/services/test_sticker_library_pg.py"]
STICKER_CLEANUP_API_SUITES = ["tests/services/test_sticker_cleanup.py",
                              "tests/core/test_storage.py"]
STICKER_CLEANUP_PG_SUITES = ["tests/services/test_sticker_cleanup_pg.py"]
DISCUSSION_WEBSOCKET_PG_SUITES = ["tests/api/v1/test_delegate_member_websocket_revocation_pg.py"]
MODULE_RESOURCE_API_SUITES = ["tests/api/v1/test_module_resources.py",
                              "tests/core/test_module_resource_processing.py",
                              "tests/core/test_storage.py",
                              "tests/api/v1/test_document_voting.py",
                              "tests/api/v1/test_document_voting_flows.py",
                              "tests/api/v1/test_document_voting_thresholds.py",
                              "tests/api/v1/test_moderator_permissions.py"]
MODULE_RESOURCE_PG_SUITES = ["tests/services/test_module_resource_migration_pg.py",
                             "tests/services/test_module_resource_review_pg.py",
                             "tests/services/test_resource_removal_migration_pg.py",
                             "tests/services/test_delegate_publication_pg.py"]
POST_REPLY_IMAGES_PG_SUITES = ["tests/services/test_post_reply_images_pg.py"]


@contextmanager
def loop_heartbeat(enabled):
    """Wake sleeping loops without replacing ASGI, AnyIO, or worker execution."""
    original = asyncio.BaseEventLoop.run_forever

    def run_with_heartbeat(loop):
        handle = None

        def tick():
            nonlocal handle
            handle = loop.call_later(0.01, tick)

        tick()
        try:
            return original(loop)
        finally:
            if handle is not None:
                handle.cancel()

    if enabled:
        asyncio.BaseEventLoop.run_forever = run_with_heartbeat
    try:
        yield
    finally:
        if enabled:
            asyncio.BaseEventLoop.run_forever = original


class Counts:
    def __init__(self):
        self.suites = {}

    def pytest_runtest_logreport(self, report):
        suite = report.nodeid.split("::", 1)[0]
        counts = self.suites.setdefault(suite, dict(passed=0, failed=0, errors=0, skipped=0))
        if report.when == "call":
            counts[report.outcome] += 1
        elif report.failed:
            counts["errors"] += 1
        elif report.skipped:
            counts["skipped"] += 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=["api", "postgresql", "all", "password-api",
                                             "password-postgresql", "password-all", "avatar-api",
                                             "avatar-postgresql", "avatar-all", "sticker-postgresql",
                                             "sticker-library-postgresql", "sticker-api",
                                             "discussion-sticker-api", "discussion-sticker-postgresql",
                                             "sticker-cleanup-api", "sticker-cleanup-postgresql",
                                             "discussion-websocket-postgresql",
                                             "password-live-socket-postgresql", "module-resource-api",
                                             "module-resource-postgresql", "module-resource-all",
                                             "post-reply-images-postgresql"], default="api")
    parser.add_argument("--heartbeat", action="store_true", help="Opt-in test-process event-loop wakeup accommodation")
    args = parser.parse_args()
    config = TestConfig.from_env()
    if config.port != 5432:
        parser.error("Focused profile acceptance requires the approved integration port 5432")

    run_id = os.environ.get("IRM_ACCEPTANCE_RUN_ID", uuid4().hex)
    evidence = Path(tempfile.mkdtemp(prefix="irm-profile-evidence-"))
    journal = Path(os.environ.get("IRM_ACCEPTANCE_JOURNAL", str(evidence / "leases.jsonl")))
    journal.parent.mkdir(parents=True, exist_ok=True)
    result = dict(run_id=run_id, suite=args.suite, heartbeat=args.heartbeat,
                  journal=str(journal), pytest_exit_status=None, tests={}, cleanup={})
    resource = None
    pytest_status = 2
    previous_sigterm = signal.getsignal(signal.SIGTERM)

    def terminate(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, terminate)
    with tempfile.TemporaryDirectory(prefix="irm-profile-work-") as workspace:
        # Override application settings only in this runner process, before
        # importing the app/tests. Never use repository owner database settings.
        os.environ.update(
            IRM_ACCEPTANCE_RUN_ID=run_id, IRM_ACCEPTANCE_JOURNAL=str(journal),
            POSTGRES_DB=config.database, POSTGRES_USER=config.role,
            POSTGRES_PASSWORD=config.password or "isolated-test-placeholder",
            DATABASE_HOST=config.host, DATABASE_PORT=str(config.port),
            PGOPTIONS="-c search_path=pg_catalog",
            STORAGE_ROOT=str(Path(workspace) / "storage"),
            ENVIRONMENT="test", FRONTEND_URL="http://localhost:3000",
            SESSION_COOKIE_NAME="session", SECURE_COOKIES="false",
            EXTRA_WEBSOCKET_ORIGINS="[]",
        )
        try:
            if args.suite in {"postgresql", "all", "password-postgresql", "password-all",
                              "avatar-postgresql", "avatar-all", "sticker-postgresql",
                              "sticker-library-postgresql", "discussion-sticker-postgresql",
                              "sticker-cleanup-postgresql", "discussion-websocket-postgresql",
                              "password-live-socket-postgresql", "module-resource-postgresql",
                              "module-resource-all", "post-reply-images-postgresql"}:
                resource = OwnedDatabase(config, run_id, journal)
                resource.create()
                result["schema"] = resource.lease.schema
                result["server_identity"] = resource.server_identity
                os.environ.update(IRM_ACCEPTANCE_SCHEMA=resource.lease.schema,
                                  IRM_ACCEPTANCE_NONCE=resource.lease.nonce,
                                  PGOPTIONS=f"-c search_path={resource.lease.schema}")

            import pytest
            counts = Counts()
            suites = (API_SUITES if args.suite in {"api", "all"} else []) + (
                PG_SUITES if args.suite in {"postgresql", "all"} else []
            ) + (PASSWORD_API_SUITES if args.suite in {"password-api", "password-all"} else []) + (
                PASSWORD_PG_SUITES if args.suite in {"password-postgresql", "password-all"} else []
            ) + (AVATAR_API_SUITES if args.suite in {"avatar-api", "avatar-all"} else []) + (
                AVATAR_PG_SUITES if args.suite in {"avatar-postgresql", "avatar-all"} else []
            )
            if args.suite == "sticker-postgresql":
                suites += STICKER_PG_SUITES
            if args.suite == "sticker-library-postgresql":
                suites += STICKER_LIBRARY_PG_SUITES
            if args.suite == "sticker-api":
                suites += STICKER_API_SUITES
            if args.suite == "discussion-sticker-api":
                suites += DISCUSSION_STICKER_API_SUITES
            if args.suite == "discussion-sticker-postgresql":
                suites += DISCUSSION_STICKER_PG_SUITES
            if args.suite == "sticker-cleanup-api":
                suites += STICKER_CLEANUP_API_SUITES
            if args.suite == "sticker-cleanup-postgresql":
                suites += STICKER_CLEANUP_PG_SUITES
            if args.suite == "discussion-websocket-postgresql":
                suites += DISCUSSION_WEBSOCKET_PG_SUITES
            if args.suite == "password-live-socket-postgresql":
                suites += PASSWORD_LIVE_SOCKET_PG_SUITES
            if args.suite in {"module-resource-api", "module-resource-all"}:
                suites += MODULE_RESOURCE_API_SUITES
            if args.suite in {"module-resource-postgresql", "module-resource-all"}:
                suites += MODULE_RESOURCE_PG_SUITES
            if args.suite == "post-reply-images-postgresql":
                suites += POST_REPLY_IMAGES_PG_SUITES
            print("Focused suites:", ", ".join(suites), flush=True)
            os.chdir(BACKEND)
            with loop_heartbeat(args.heartbeat):
                pytest_status = int(pytest.main([
                    *suites, "-q", "--tb=short", "-o", "faulthandler_timeout=15",
                ], plugins=[counts]))
            # Capture pytest's return immediately, before any cleanup action.
            result["pytest_exit_status"] = pytest_status
            result["tests"] = counts.suites
        except KeyboardInterrupt:
            result["blocked"] = "Interrupted"
            pytest_status = 130
        except Exception as error:
            result["blocked"] = type(error).__name__
            print("Focused acceptance setup blocked:", type(error).__name__)
        finally:
            if resource is not None:
                try:
                    resource.close()
                    result["cleanup"]["database"] = (
                        "verified owned schema dropped" if "schema" in result
                        else "no outstanding owned schema"
                    )
                except Exception as error:
                    result["cleanup"]["database"] = type(error).__name__
                    pytest_status = 3
            signal.signal(signal.SIGTERM, previous_sigterm)
    result["cleanup"]["temporary_storage"] = "removed"
    (evidence / "profile-result.json").write_text(json.dumps(result, indent=2))
    print("Focused profile evidence:", evidence / "profile-result.json")
    return pytest_status


if __name__ == "__main__":
    raise SystemExit(main())
