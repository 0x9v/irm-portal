"""One owner-run command; no owner services, database provisioning or fallback."""
import argparse
from dataclasses import replace
import getpass
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import traceback
from uuid import uuid4

import httpx

from acceptance.isolation import BACKEND, HEAD, OwnedDatabase, TestConfig, SafetyError, check_head, drop_owned, leases, verify
from acceptance.processes import Children, StageFailure, sanitize

ROOT = BACKEND.parent
PYTHON = str(BACKEND / '.venv/bin/python')
PG_SUITES = ['tests/acceptance/test_catalog_pg.py', 'tests/api/v1/test_community_posts_pg.py',
             'tests/api/v1/test_moderation_acceptance_pg.py', 'tests/api/v1/test_moderation_websocket_pg.py',
             'tests/api/v1/test_delegate_member_websocket_revocation_pg.py',
             'tests/services/test_delegate_member_concurrency_pg.py', 'tests/services/test_delegate_member_management_migration_pg.py',
             'tests/services/test_user_profile_pg.py', 'tests/services/test_post_reply_images_pg.py',
             'tests/services/test_module_resource_migration_pg.py']
SQLITE_SUITES = ['tests/api/v1/test_member_directory.py', 'tests/api/v1/test_delegate_member_management.py',
                 'tests/api/v1/test_membership_management.py', 'tests/api/v1/test_membership_review.py',
                 'tests/api/v1/test_membership_me.py', 'tests/api/v1/test_membership_withdrawal.py',
                 'tests/api/v1/test_moderator_permissions.py', 'tests/api/v1/test_content_removal.py',
                 'tests/services/test_content_removal_transactions.py', 'tests/api/v1/test_auth.py',
                 'tests/api/v1/test_auth_me.py', 'tests/api/v1/test_post_reply_route_guards.py',
                 'tests/core/test_sessions.py', 'tests/core/test_post_reply_images.py',
                 'tests/services/test_post_reply_image_service.py', 'tests/core/test_broadcaster_revocation_cleanup.py',
                 'tests/api/v1/test_module_resources.py', 'tests/core/test_module_resource_processing.py']


def child_env(config, lease, workspace, origin):
    env = os.environ.copy()
    # Exact test-only settings override any repository .env values in these children.
    env.update(IRM_ACCEPTANCE_DB_HOST=config.host, IRM_ACCEPTANCE_DB_PORT=str(config.port),
               IRM_ACCEPTANCE_DB_PASSWORD=config.password or '', IRM_ACCEPTANCE_SCHEMA=lease.schema,
               IRM_ACCEPTANCE_NONCE=lease.nonce, IRM_ACCEPTANCE_RUN_ID=lease.run_id,
               IRM_ACCEPTANCE_JOURNAL=str(workspace / 'leases.jsonl'),
               POSTGRES_DB=config.database, POSTGRES_USER=config.role, POSTGRES_PASSWORD=config.password or '',
               DATABASE_HOST=config.host, DATABASE_PORT=str(config.port), PGOPTIONS=f'-c search_path={lease.schema}',
               STORAGE_ROOT=str(workspace / 'storage'), FRONTEND_URL=origin, SECURE_COOKIES='false', SESSION_COOKIE_NAME='session',
               ENVIRONMENT='test', EXTRA_WEBSOCKET_ORIGINS='[]')
    return env


def reserve_port():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(('127.0.0.1', 0))
        sock.listen(128)
        return sock
    except BaseException:
        sock.close()
        raise


def wait_ready(child, url, headers=None):
    deadline = time.monotonic() + 30
    with httpx.Client(trust_env=False, timeout=1) as client:
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise StageFailure('Owned server exited before readiness (possible bind race)')
            try:
                response = client.get(url, headers=headers)
                if response.status_code == 200:
                    return response
            except httpx.HTTPError:
                pass
            time.sleep(0.1)
    raise StageFailure('Owned server readiness timed out')


def copy_frontend(destination):
    source = ROOT / 'frontend'
    source_nm = source / 'node_modules'
    if not source_nm.is_dir():
        raise StageFailure('Source node_modules directory missing')
    target_parent = destination.parent if destination.parent.exists() else Path(tempfile.gettempdir())
    free_bytes = shutil.disk_usage(target_parent).free
    # Count linked content too; internal executable links must stay relative so
    # Node resolves package-relative imports from the executable's real location.
    # Reject loops rather than underestimating disk usage or copying indefinitely.
    seen = set()
    required_bytes = 0
    for directory, _, files in os.walk(source_nm, followlinks=True):
        resolved = Path(directory).resolve()
        if resolved in seen:
            raise StageFailure('Repeated dependency directory/symlink loop refused')
        seen.add(resolved)
        required_bytes += sum((Path(directory) / name).stat().st_size for name in files)
    margin_bytes = 100 * 1024 * 1024
    if free_bytes < (required_bytes + margin_bytes):
        raise StageFailure(
            f'Insufficient disk space for frontend dependencies: {free_bytes} bytes available, {required_bytes + margin_bytes} required'
        )
    def ignored(directory, names):
        return [name for name in names if name.startswith('.env') or name in {'node_modules', '.next', 'test-results', 'playwright-report', 'coverage', '.turbo', '.git', 'out', 'dist', '.cache'} or name.endswith('.tsbuildinfo')]
    shutil.copytree(source, destination, ignore=ignored)
    dest_nm = destination / 'node_modules'
    cp_res = subprocess.run(['cp', '-a', '--reflink=auto', str(source_nm.resolve()), str(dest_nm)], capture_output=True, text=True)
    if cp_res.returncode != 0:
        raise StageFailure('Independent dependency copy failed (possibly insufficient disk space)')
    for path in dest_nm.rglob('*'):
        if not path.is_symlink():
            continue
        original = (source_nm / path.relative_to(dest_nm)).resolve(strict=True)
        if original.is_relative_to(source_nm.resolve()):
            # Remap absolute/internal links into the owned copy as well.
            target = dest_nm / original.relative_to(source_nm.resolve())
            path.unlink()
            path.symlink_to(os.path.relpath(target, path.parent))
        else:
            path.unlink()
            if original.is_dir():
                shutil.copytree(original, path, symlinks=False)
            else:
                shutil.copy2(original, path)
    if any(path.is_symlink() and not path.resolve(strict=True).is_relative_to(dest_nm)
           for path in dest_nm.rglob('*')):
        raise StageFailure('Dependency copy contains an external symlink')
    return destination


def recover(config, evidence, workspace=None):
    """Only journaled leases from an identified run; preserve recovery artifacts."""
    summary = json.loads((evidence / 'summary.json').read_text())
    owned = leases(evidence / 'leases.jsonl', summary['run_id'])
    if not owned or 'server_identity' not in summary:
        raise SafetyError('Recovery requires recorded leases and live server identity')
    if workspace is not None:
        if leases(workspace / 'leases.jsonl', summary['run_id']) != owned:
            raise SafetyError('Workspace and evidence leases do not match')
        if str(workspace) != summary['cleanup'].get('recovery_workspace'):
            raise SafetyError('Workspace does not match recorded recovery target')
    admin = config.engine()
    try:
        with admin.connect() as connection:
            if verify(connection, 'pg_catalog') != summary['server_identity']:
                raise SafetyError('Recovery database/server identity does not match recorded run')
    finally:
        admin.dispose()
    for lease in reversed(owned):
        try:
            drop_owned(config, lease, summary['run_id'])
        except SafetyError as error:
            raise SafetyError(f'Recovery refused for schema {lease.schema}: {error}') from None
        print(f'Verified schema recovery: {lease.schema}')
    print('Recovery finished; evidence and workspace preserved')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--guards-only', action='store_true')
    parser.add_argument('--non-interactive', action='store_true', help='Use explicit test env or libpq password file; no prompt')
    parser.add_argument('--db-port', type=int, default=None, help='Approved integration loopback host port (not server inet_server_port)')
    parser.add_argument('--recover-workspace', type=Path, default=None, help='Safely recover retained acceptance workspace and schemas')
    parser.add_argument('--recover-evidence', type=Path, default=None, help='Recover only leases from this evidence and its recorded database identity')
    parser.add_argument('--stages', nargs='+', choices=['guards', 'sqlite_normal', 'node_checks', 'lint', 'typescript', 'postgresql_setup', 'postgresql_directory', 'postgresql_regressions', 'synthetic_workflows', 'real_websocket', 'normal_build', 'real_browser', 'mocked_browser', 'mocked_regressions'], default=None, help='Filter execution to specified stages (dependencies and setup always run safely)')
    args = parser.parse_args()
    if args.guards_only and args.stages:
        parser.error('--guards-only cannot be combined with --stages')
    try:
        config = TestConfig.from_env()
        if args.db_port is not None:
            config = replace(config, port=args.db_port)
        config.validate()
    except Exception as error:
        print("Configuration refused:", type(error).__name__)
        return 1
    if args.recover_workspace or args.recover_evidence:
        try:
            if args.recover_evidence is None:
                raise SafetyError('Recovery requires --recover-evidence to verify recorded database identity')
            if config.password is None and not args.non_interactive and sys.stdin.isatty():
                config = replace(config, password=getpass.getpass('Approved integration-role password (never logged): '))
            recover(config, args.recover_evidence.resolve(), args.recover_workspace.resolve() if args.recover_workspace else None)
            return 0
        except Exception as error:
            print('Recovery blocked:', type(error).__name__, sanitize(str(error), [config.password]))
            return 1
    run_id = uuid4().hex
    evidence = Path(tempfile.mkdtemp(prefix='irm-acceptance-evidence-'))
    os.chmod(evidence, 0o700)
    results = {'run_id': run_id, 'acceptance': 'partial', 'stages': {name: {'status': 'not_executed'} for name in ['guards', 'sqlite_normal', 'node_checks', 'lint', 'typescript', 'postgresql_setup', 'postgresql_directory', 'postgresql_regressions', 'normal_build', 'synthetic_workflows', 'real_websocket', 'real_browser', 'mocked_browser', 'mocked_regressions']}, 'cleanup': {}}
    workspace = Path(tempfile.mkdtemp(prefix='irm-acceptance-work-'))
    children = Children(workspace, evidence, [config.password])
    resource = None
    backend_socket = frontend_socket = None
    previous_signals = {}
    def interrupted(signum, frame):
        raise KeyboardInterrupt('Acceptance interrupted')
    for sig in [signal.SIGINT, signal.SIGTERM]:
        previous_signals[sig] = signal.signal(sig, interrupted)

    def stage(name, function):
        try:
            function()
            results['stages'][name] = {'status': 'passed'}
            print(name + ': passed', flush=True)
            return True
        except Exception as error:
            results['stages'][name] = {'status': 'failed_or_blocked', 'error': type(error).__name__, 'phase': 'stage', 'detail': sanitize(str(error), children.secrets)[:2000], 'traceback': sanitize(''.join(traceback.format_exception(error, limit=8)), children.secrets)}
            failures = name.replace('_', '-') + '-failures.json'
            if (evidence / failures).exists():
                results['stages'][name]['failure_evidence'] = failures
            print(name + ': failed/blocked (' + type(error).__name__ + ')', flush=True)
            return False

    def workflow():
        nonlocal config, resource, backend_socket, frontend_socket
        check_head()
        ordinary = os.environ.copy()
        def should_run(name):
            return args.stages is None or name in args.stages

        if should_run('guards'):
            if not stage('guards', lambda: children.run('guards', [PYTHON, '-m', 'pytest', 'tests/acceptance/test_isolation.py', '-q', '--tb=short'], BACKEND, ordinary, 60)):
                return 1
        if args.guards_only:
            results['acceptance'] = 'helper_checks_only'
            return 0
        # Independent checks still run if socket access later proves unavailable.
        if should_run('sqlite_normal'):
            stage('sqlite_normal', lambda: children.run('sqlite-normal', [PYTHON, '-m', 'pytest', *SQLITE_SUITES, '-k', 'not postgresql', '-q', '--tb=short'], BACKEND, ordinary, 60))
        frontend = ROOT / 'frontend'
        if should_run('node_checks'):
            stage('node_checks', lambda: [children.run('node-' + name, ['node', 'tests/' + name + '.test.mjs'], frontend, ordinary, 60) for name in ['member-directory', 'moderation', 'home-presentation', 'mobile-presentation', 'theme', 'acceptance-reporter']])
        if should_run('lint'):
            stage('lint', lambda: children.run('lint', ['npm', 'run', 'lint'], frontend, ordinary, 90))
        if should_run('typescript'):
            stage('typescript', lambda: children.run('typescript', ['node', 'node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'], frontend, ordinary, 90))

        need_pg = any(should_run(s) for s in ['postgresql_setup', 'postgresql_directory', 'postgresql_regressions', 'synthetic_workflows', 'real_websocket', 'normal_build', 'real_browser', 'mocked_browser', 'mocked_regressions'])
        if need_pg:
            if config.password is None and not args.non_interactive and sys.stdin.isatty():
                config = replace(config, password=getpass.getpass('Approved integration-role password (never logged): '))
                children.secrets.append(config.password)
            resource = OwnedDatabase(config, run_id, workspace / 'leases.jsonl')
            children.secrets.extend([resource.lease.nonce, resource.lease.marker])
            if not stage('postgresql_setup', lambda: resource.create()):
                return 1
            results['server_identity'] = resource.server_identity
            backend_socket, frontend_socket = reserve_port(), reserve_port()
            backend_port, frontend_port = backend_socket.getsockname()[1], frontend_socket.getsockname()[1]
            api, origin = f'http://127.0.0.1:{backend_port}', f'http://127.0.0.1:{frontend_port}'
            env = child_env(config, resource.lease, workspace, origin)
            env.update(IRM_ACCEPTANCE_API=api, IRM_ACCEPTANCE_FRONTEND=origin, IRM_ACCEPTANCE_EVIDENCE=str(evidence))
            common = [PYTHON, '-m', 'acceptance.worker', 'pytest']
            if should_run('postgresql_directory'):
                stage('postgresql_directory', lambda: children.run('postgresql-directory', [*common, 'tests/api/v1/test_member_directory.py', '-k', 'postgresql', '-q', '--tb=short'], BACKEND, env, 180))
            if should_run('postgresql_regressions'):
                stage('postgresql_regressions', lambda: children.run('postgresql-regressions', [*common, *PG_SUITES, '-q', '--tb=short'], BACKEND, env, 300))

            need_server = any(should_run(s) for s in ['synthetic_workflows', 'real_websocket', 'real_browser', 'mocked_browser', 'mocked_regressions'])
            if need_server:
                backend = children.start('backend', [PYTHON, '-m', 'acceptance.worker', 'serve', str(backend_socket.fileno())], BACKEND, env, pass_fds=(backend_socket.fileno(),))
                backend_socket.close()
                backend_socket = None
                identity = wait_ready(backend, api + '/__acceptance__/identity', {'X-Acceptance-Run': run_id}).json()
                if not identity['same_factory'] or identity['rest']['schema'] != resource.lease.schema or identity['websocket']['schema'] != resource.lease.schema:
                    raise StageFailure('REST/WebSocket factory mismatch')
                results['live_factories'] = identity
                manifest = workspace / 'actors.json'
                if not stage('synthetic_workflows', lambda: children.run('seed', [PYTHON, '-m', 'acceptance.worker', 'seed', api, str(manifest)], BACKEND, env, 180)):
                    return 1
                actors = json.loads(manifest.read_text())
                children.secrets.extend(actor['password'] for actor in actors['actors'].values())
                children.secrets.append(str(manifest))
                env['IRM_ACCEPTANCE_MANIFEST'] = str(manifest)
                if should_run('real_websocket'):
                    stage('real_websocket', lambda: children.run('real-websocket', [*common, 'tests/acceptance/test_live_network.py', '-q', '--tb=short'], BACKEND, env, 150))

            need_build = any(should_run(s) for s in ['normal_build', 'real_browser', 'mocked_browser', 'mocked_regressions'])
            if need_build:
                owned_frontend = None
                build_env = {**env, 'NEXT_PUBLIC_API_URL': api}
                def build():
                    nonlocal owned_frontend
                    owned_frontend = copy_frontend(workspace / 'frontend')
                    children.run('normal-build', ['npm', 'run', 'build'], owned_frontend, build_env, 300)
                if not stage('normal_build', build):
                    return 1

            need_front_server = any(should_run(s) for s in ['real_browser', 'mocked_browser', 'mocked_regressions'])
            if need_front_server:
                # Advisory reservation closes immediately before Next binds. A lost race
                # fails safely; never reuse or kill the process which won the port.
                frontend_socket.close()
                frontend_socket = None
                front = children.start('frontend', ['node', 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', str(frontend_port)], owned_frontend, build_env)
                wait_ready(front, origin)
                if should_run('real_browser'):
                    stage('real_browser', lambda: children.run('real-browser', ['node', 'node_modules/@playwright/test/cli.js', 'test', '--config=playwright.local-acceptance.config.ts'], frontend, env, 300))
                if should_run('mocked_browser'):
                    stage('mocked_browser', lambda: children.run('mocked-browser', ['node', 'node_modules/@playwright/test/cli.js', 'test', '--config=playwright.local-acceptance-mocked.config.ts'], frontend, env, 300))
                if should_run('mocked_regressions'):
                    stage('mocked_regressions', lambda: children.run('mocked-regressions', ['node', 'tests/run-moderation-regressions.mjs'], frontend, env, 600))

        executed = [v for k, v in results['stages'].items() if should_run(k)]
        if executed and all(value['status'] == 'passed' for value in executed):
            results['acceptance'] = 'passed_executed_automated_coverage' if args.stages is None else 'passed_filtered_stages'
            return 0
        return 1
    exit_code = 1
    try:
        exit_code = workflow()
    except (Exception, KeyboardInterrupt) as error:
        results['failure'] = {'error': type(error).__name__, 'detail': sanitize(str(error), children.secrets)}
        print('Acceptance stopped safely:', type(error).__name__)
        exit_code = 1
    finally:
        # Do not let a second termination interrupt owned-resource cleanup.
        for sig in previous_signals:
            signal.signal(sig, signal.SIG_IGN)
        for sock in [backend_socket, frontend_socket]:
            if sock:
                sock.close()
        try:
            children.close()
            results['cleanup']['children'] = 'stopped_owned_children'
        except Exception as error:
            results['cleanup']['children'] = type(error).__name__
            results['acceptance'] = 'partial'
            exit_code = 1
        journal_path = workspace / 'leases.jsonl'
        if journal_path.exists():
            shutil.copy2(journal_path, evidence / 'leases.jsonl')
        current_lease = None
        try:
            if results['cleanup'].get('children') != 'stopped_owned_children':
                raise StageFailure('Schema cleanup deferred: owned child shutdown unconfirmed')
            if resource and resource.engine:
                resource.engine.dispose()
            owned_leases = leases(workspace / 'leases.jsonl', run_id)
            for lease in reversed(owned_leases):
                current_lease = lease
                drop_owned(config, lease, run_id)
            results['cleanup']['schemas'] = {'verified_owned_leases': len(owned_leases), 'status': 'cleaned'}
        except Exception as error:
            cleanup_detail = {
                'error': type(error).__name__,
                'message': sanitize(str(error), children.secrets),
            }
            if current_lease is not None:
                cleanup_detail['schema'] = current_lease.schema
            results['cleanup']['schemas'] = cleanup_detail
            results['acceptance'] = 'partial'
            exit_code = 1
        children.preserve()
        if isinstance(results['cleanup'].get('schemas'), dict) and results['cleanup']['schemas'].get('status') == 'cleaned':
            shutil.rmtree(workspace)  # Only this invocation's mkdtemp root.
            results['cleanup']['workspace'] = 'removed_owned_workspace'
        else:
            results['cleanup']['workspace'] = 'retained_for_safe_recovery'
            results['cleanup']['recovery_workspace'] = str(workspace)
        (evidence / 'summary.json').write_text(json.dumps(results, indent=2))
        for sig, handler in previous_signals.items():
            signal.signal(sig, handler)
        print('Sanitized evidence:', evidence)
    return exit_code


if __name__ == '__main__':
    raise SystemExit(main())
