"""Pure guard/lifecycle regressions: no network or application databases."""
from dataclasses import replace
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pytest

from acceptance import isolation as module
from acceptance.isolation import Lease, OwnedDatabase, SafetyError, TestConfig as Config, check_identity, drop_owned, journal, leases
from acceptance.processes import Children, StageFailure, sanitize


def row(schema='pg_catalog', **changes):
    value = dict(db='irm_integration_test', role='irm_test', current=schema, schemas=[schema], address='172.18.0.2', port=5432)
    value.update(changes)
    return tuple(value.values())


@pytest.mark.parametrize('changes', [{'db': 'irm_platform'}, {'role': 'irm_dev'}, {'current': None, 'schemas': []}, {'current': 'public', 'schemas': ['public']}, {'schemas': ['pg_catalog', 'public']}])
def test_identity_refuses_wrong_database_role_or_search_path(changes):
    with pytest.raises(SafetyError):
        check_identity(row(**changes), 'pg_catalog')


def test_docker_host_port_is_distinct_from_actual_server_port():
    config = Config(port=15432)
    config.validate()
    identity = check_identity(row(), 'pg_catalog')
    assert identity['server_port'] == 5432 and config.port == 15432


@pytest.mark.parametrize('change', [{'host': 'example.com'}, {'host': '10.0.0.2'}, {'database': 'irm_platform'}, {'role': 'irm_dev'}, {'port': 0}, {'port': 65536}])
def test_client_configuration_refuses_unapproved_target(change):
    with pytest.raises(SafetyError):
        replace(Config(), **change).validate()


@pytest.mark.parametrize('host', ['127.0.0.1', '::1'])
def test_only_literal_loopback_hosts_allowed(host):
    replace(Config(), host=host).validate()


def test_password_is_not_in_configuration_repr():
    assert 'secret-value' not in repr(Config(password='secret-value'))


class Result:
    def __init__(self, value): self.value = value
    def one(self): return self.value
    def scalar_one(self): return self.value
    def scalar_one_or_none(self): return self.value
    def all(self): return []


class FakeConnection:
    def __init__(self, database, schema): self.database, self.schema = database, schema
    def execute(self, query, params=None):
        query = str(query)
        self.database.calls.append(query)
        if query == module.IDENTITY_SQL:
            return Result(row(self.schema, **self.database.identity))
        if 'obj_description' in query:
            return Result(self.database.schemas.get(params['schema']))
        if 'count(*) FROM pg_namespace' in query:
            return Result(int(params['schema'] in self.database.schemas))
        if 'pg_constraint' in query or 'pg_depend' in query:
            return Result(self.database.external)
        if query.startswith('CREATE SCHEMA'):
            name = query.split('"')[1]
            self.database.schemas[name] = None
        elif query.startswith('COMMENT ON SCHEMA'):
            if self.database.fail_comment:
                raise RuntimeError('forced comment failure')
            name = query.split('"')[1]
            self.database.schemas[name] = query.split(" IS '")[1][:-1]
        elif query.startswith('DROP SCHEMA'):
            del self.database.schemas[query.split('"')[1]]
        return Result(None)


class FakeEngine:
    def __init__(self, database, schema): self.database, self.schema = database, schema
    def begin(self): return self
    def connect(self): return self
    def __enter__(self):
        self.before = self.database.schemas.copy()
        return FakeConnection(self.database, self.schema)
    def __exit__(self, kind, value, traceback):
        if kind: self.database.schemas = self.before
    def dispose(self): pass


class FakeDatabase:
    def __init__(self, **identity):
        self.identity, self.calls, self.schemas = identity, [], {'public': 'owner'}
        self.fail_comment = False
        self.external = 0
    def validate(self): pass
    def engine(self, schema='pg_catalog'): return FakeEngine(self, schema)


@pytest.mark.parametrize('identity', [{'db': 'irm_platform'}, {'role': 'irm_dev'}, {'current': 'public', 'schemas': ['public']}, {'schemas': ['pg_catalog', 'public']}])
def test_refusal_happens_before_schema_creation_or_writes(tmp_path, identity):
    database = FakeDatabase(**identity)
    resource = OwnedDatabase(database, uuid4().hex, tmp_path/'journal')
    with pytest.raises(SafetyError): resource.create()
    assert not any(query.startswith(('CREATE', 'COMMENT', 'DROP', 'TRUNCATE')) for query in database.calls)
    assert database.schemas == {'public': 'owner'}


@pytest.mark.parametrize('failure', [RuntimeError, KeyboardInterrupt])
def test_failed_or_interrupted_migration_cleans_only_created_schema(tmp_path, monkeypatch, failure):
    database = FakeDatabase()
    resource = OwnedDatabase(database, uuid4().hex, tmp_path/'journal')
    monkeypatch.setattr(module, 'migrate', lambda *a, **k: (_ for _ in ()).throw(failure()))
    with pytest.raises(failure): resource.create()
    assert database.schemas == {'public': 'owner'}
    dropped = [query for query in database.calls if query.startswith('DROP')]
    assert len(dropped) == 1 and resource.lease.schema in dropped[0]
    assert leases(tmp_path/'journal', resource.run_id) == [resource.lease]


def test_creation_and_marker_failure_roll_back_without_touching_public(tmp_path):
    database = FakeDatabase()
    database.fail_comment = True
    resource = OwnedDatabase(database, uuid4().hex, tmp_path/'journal')
    with pytest.raises(RuntimeError): resource.create()
    assert database.schemas == {'public': 'owner'}
    assert not any(query.startswith('DROP') for query in database.calls)


@pytest.mark.parametrize('schema', ['public', 'irm_platform', 'irm_acceptance_fake', 'irm_acceptance_'+'0'*32+'";DROP SCHEMA public;'])
def test_cleanup_cannot_choose_arbitrary_schema(schema):
    database = FakeDatabase()
    run_id = uuid4().hex
    with pytest.raises(SafetyError): drop_owned(database, Lease(schema, uuid4().hex, run_id), run_id)
    assert database.calls == []


@pytest.mark.parametrize('marker', [None, 'another-run-marker'])
def test_cleanup_rejects_unmarked_or_foreign_owned_schema(marker):
    database = FakeDatabase()
    run_id = uuid4().hex
    lease = Lease('irm_acceptance_'+uuid4().hex, uuid4().hex, run_id)
    database.schemas[lease.schema] = marker
    with pytest.raises(SafetyError): drop_owned(database, lease, run_id)
    assert not any(query.startswith('DROP') for query in database.calls)


def test_cleanup_rejects_cross_schema_dependents():
    database = FakeDatabase()
    run_id = uuid4().hex
    lease = Lease('irm_acceptance_'+uuid4().hex, uuid4().hex, run_id)
    database.schemas[lease.schema] = lease.marker
    database.external = 1
    with pytest.raises(SafetyError): drop_owned(database, lease, run_id)
    assert lease.schema in database.schemas and 'public' in database.schemas


def test_journal_refuses_injected_public_cleanup_record(tmp_path):
    path = tmp_path/'journal'
    run_id = uuid4().hex
    journal(path, Lease('public', uuid4().hex, run_id))
    with pytest.raises(SafetyError): leases(path, run_id)
    assert path.stat().st_mode & 0o777 == 0o600


def test_journal_tracks_owned_lease_before_creation(tmp_path):
    path = tmp_path/'journal'
    run_id = uuid4().hex
    lease = Lease('irm_acceptance_'+uuid4().hex, uuid4().hex, run_id)
    journal(path, lease)
    assert leases(path, run_id) == [lease]


def test_sanitizer_removes_passwords_urls_and_cookies():
    log = 'password=secret-value\npostgresql+psycopg://account:other@localhost/db\nCookie: session=private-cookie\npassed\n'
    sanitized = sanitize(log, ['secret-value'])
    for secret in ['secret-value', 'other@', 'private-cookie']: assert secret not in sanitized
    assert 'passed' in sanitized


def test_timeout_stops_owned_child_and_preserves_sanitized_evidence(tmp_path):
    workspace, evidence = tmp_path/'work', tmp_path/'evidence'
    workspace.mkdir(); evidence.mkdir()
    children = Children(workspace, evidence, ['secret-value'])
    with pytest.raises(StageFailure):
        children.run('timeout', [sys.executable, '-u', '-c', 'import time; print("secret-value", flush=True); time.sleep(60)'], tmp_path, os.environ.copy(), 0.2)
    children.close()
    assert children.children[0][1].poll() is not None
    assert 'secret-value' not in (evidence/'timeout.log').read_text()


def test_process_identity_mismatch_refuses_to_signal(tmp_path, monkeypatch):
    import acceptance.processes as process_module
    class Child:
        pid = 123
        def poll(self): return None
    children = Children(tmp_path, tmp_path)
    child = Child()
    children.children = [('fake', child, 'original', None)]
    monkeypatch.setattr(process_module, 'process_start', lambda pid: 'different')
    signals = []
    monkeypatch.setattr(os, 'killpg', lambda *args: signals.append(args))
    with pytest.raises(StageFailure): children.stop(child)
    assert signals == []


def test_frontend_copy_excludes_env_output_and_preserves_lock(tmp_path, monkeypatch):
    from acceptance import run
    root = tmp_path/'repo'
    source = root/'frontend'; source.mkdir(parents=True)
    for name in ['.env', '.env.local', 'package-lock.json', 'page.tsx', 'cache.tsbuildinfo']: (source/name).write_text(name)
    for name in ['.next', 'node_modules', 'test-results', 'playwright-report']: (source/name).mkdir()
    monkeypatch.setattr(run, 'ROOT', root)
    destination = run.copy_frontend(tmp_path/'copy')
    assert not (destination/'.env').exists() and not (destination/'.next').exists()
    assert not (destination/'cache.tsbuildinfo').exists()
    assert (destination/'package-lock.json').read_bytes() == (source/'package-lock.json').read_bytes()
    assert (destination/'node_modules').is_dir() and not (destination/'node_modules').is_symlink()


def test_reserved_port_bind_failure_closes_only_owned_socket(monkeypatch):
    from acceptance import run
    class Socket:
        closed = False
        def bind(self, *args): raise PermissionError('restricted socket')
        def close(self): self.closed = True
    sock = Socket()
    monkeypatch.setattr(run.socket, 'socket', lambda *args: sock)
    with pytest.raises(PermissionError): run.reserve_port()
    assert sock.closed


def test_checkout_listener_is_engine_local_not_global(monkeypatch):
    engine = object()
    recorded = []
    monkeypatch.setattr(module.event, 'listen', lambda *args: recorded.append(args))
    lease = Lease('irm_acceptance_'+uuid4().hex, uuid4().hex, uuid4().hex)
    module.install_checkout_guard(engine, lease)
    assert len(recorded) == 1 and recorded[0][0] is engine and recorded[0][1] == 'checkout'


def test_standard_alembic_command_receives_explicit_connection_schema(monkeypatch):
    database = FakeDatabase()
    lease = Lease('irm_acceptance_'+uuid4().hex, uuid4().hex, uuid4().hex)
    database.schemas[lease.schema] = lease.marker
    monkeypatch.setattr(module, 'outside_relations', lambda *args: set())
    recorded = []
    monkeypatch.setattr(module.command, 'upgrade', lambda cfg, target: recorded.append((cfg, target)))
    module.migrate(database.engine(lease.schema), lease)
    config, target = recorded[0]
    assert config.attributes['schema'] == lease.schema
    assert isinstance(config.attributes['connection'], FakeConnection)
    assert target == module.HEAD
    assert 'acceptance/migrations' in config.get_main_option('script_location')


def test_migration_outside_relation_change_is_refused(monkeypatch):
    database = FakeDatabase()
    lease = Lease('irm_acceptance_'+uuid4().hex, uuid4().hex, uuid4().hex)
    database.schemas[lease.schema] = lease.marker
    snapshots = iter([set(), {('public', 'unexpected', 'r')}])
    monkeypatch.setattr(module, 'outside_relations', lambda *args: next(snapshots))
    monkeypatch.setattr(module.command, 'upgrade', lambda *args: None)
    with pytest.raises(SafetyError): module.migrate(database.engine(lease.schema), lease)


def test_cleanup_failure_returns_nonzero_and_retains_recovery_evidence(tmp_path, monkeypatch):
    from acceptance import run
    monkeypatch.setattr(sys, 'argv', ['runner', '--guards-only'])
    monkeypatch.setattr(run.Children, 'run', lambda *args, **kwargs: None)
    monkeypatch.setattr(run.Children, 'close', lambda *args: (_ for _ in ()).throw(StageFailure('forced failure')))
    destinations = iter([str(tmp_path/'evidence'), str(tmp_path/'workspace')])
    def create(**kwargs):
        name = next(destinations); Path(name).mkdir(); return name
    monkeypatch.setattr(run.tempfile, 'mkdtemp', create)
    assert run.main() == 1
    summary = json.loads((tmp_path/'evidence/summary.json').read_text())
    assert summary['acceptance'] == 'partial'
    assert summary['cleanup']['workspace'] == 'retained_for_safe_recovery'
    assert (tmp_path/'workspace').exists()
    assert summary['stages']['real_browser']['status'] == 'not_executed'


def test_cleanup_rejects_wrong_run_identity_before_connecting():
    database = FakeDatabase()
    lease = Lease('irm_acceptance_'+uuid4().hex, uuid4().hex, uuid4().hex)
    with pytest.raises(SafetyError): drop_owned(database, lease, uuid4().hex)
    assert database.calls == []


def test_truncate_requires_live_schema_and_approved_table_before_mutation(monkeypatch):
    resource = object.__new__(module.AttachedDatabase)
    resource.lease = Lease('irm_acceptance_'+uuid4().hex, uuid4().hex, uuid4().hex)
    resource.engine = None
    database = FakeDatabase(current='public', schemas=['public'])
    session = type('Session', (), {'connection': lambda self: FakeConnection(database, resource.lease.schema)})()
    with pytest.raises(SafetyError): resource.truncate(session, ['users'])
    assert not any(q.startswith('TRUNCATE') for q in database.calls)
    monkeypatch.setattr(resource, 'verify_session', lambda s: None)
    with pytest.raises(SafetyError): resource.truncate(session, ['users; DELETE FROM public.users'])
    assert not any(q.startswith('TRUNCATE') for q in database.calls)


def test_child_configuration_overrides_owner_target_storage_and_cookie_settings(tmp_path, monkeypatch):
    from acceptance.run import child_env
    for key, value in {'POSTGRES_DB': 'owner_database', 'POSTGRES_USER': 'owner_role',
                       'PGOPTIONS': '-c search_path=public', 'STORAGE_ROOT': '/owner/storage',
                       'DATABASE_HOST': 'remote.invalid', 'SECURE_COOKIES': 'true',
                       'SESSION_COOKIE_NAME': 'owner_cookie'}.items():
        monkeypatch.setenv(key, value)
    lease = Lease('irm_acceptance_'+uuid4().hex, uuid4().hex, uuid4().hex)
    env = child_env(Config(port=15432), lease, tmp_path, 'http://127.0.0.1:18998')
    assert env['POSTGRES_DB'] == 'irm_integration_test' and env['POSTGRES_USER'] == 'irm_test'
    assert env['DATABASE_HOST'] == '127.0.0.1' and env['DATABASE_PORT'] == '15432'
    assert env['PGOPTIONS'] == '-c search_path='+lease.schema
    assert env['STORAGE_ROOT'] == str(tmp_path/'storage')
    assert env['SECURE_COOKIES'] == 'false' and env['SESSION_COOKIE_NAME'] == 'session'
    assert env['FRONTEND_URL'] == 'http://127.0.0.1:18998'


def test_external_sql_excludes_internal_dependencies_and_system_schemas():
    sql = module.EXTERNAL_SQL
    assert "dependent.schema='pg_toast'" in sql and "dependent_relation.relkind='t'" in sql
    assert "d.deptype <> 'i'" not in sql and 'NOT LIKE' not in sql
    assert 'rewrite.ev_class' in sql and 'constraint_object.conrelid' in sql


def test_cleanup_reports_safety_error_and_schema_identity():
    database = FakeDatabase()
    run_id = uuid4().hex
    lease = Lease('irm_acceptance_' + uuid4().hex, uuid4().hex, run_id)
    database.schemas[lease.schema] = lease.marker
    database.external = 1
    with pytest.raises(SafetyError) as exc_info:
        drop_owned(database, lease, run_id)
    assert lease.schema in str(exc_info.value)



def test_dependency_copy_has_independent_writable_files_and_dereferences_links(tmp_path, monkeypatch):
    from acceptance import run
    root = tmp_path/'repo'
    nm = root/'frontend/node_modules'; nm.mkdir(parents=True)
    external = tmp_path/'external'; external.write_text('original')
    (nm/'linked').symlink_to(external)
    (nm/'regular').write_text('original')
    monkeypatch.setattr(run, 'ROOT', root)
    copied = run.copy_frontend(tmp_path/'copy')/'node_modules'
    for name, original in [('linked', external), ('regular', nm/'regular')]:
        assert not (copied/name).is_symlink()
        assert (copied/name).stat().st_ino != original.stat().st_ino
        (copied/name).write_text('changed')
        assert original.read_text() == 'original'


def test_dependency_copy_checks_space_before_creating_workspace(tmp_path, monkeypatch):
    from acceptance import run
    nm = tmp_path/'repo/frontend/node_modules'; nm.mkdir(parents=True)
    (nm/'file').write_text('dependency')
    monkeypatch.setattr(run, 'ROOT', tmp_path/'repo')
    monkeypatch.setattr(run.shutil, 'disk_usage', lambda _: type('Disk', (), {'free': 0})())
    with pytest.raises(StageFailure, match='Insufficient disk space'):
        run.copy_frontend(tmp_path/'copy')
    assert not (tmp_path/'copy').exists()


def test_phase_failure_evidence_redacts_private_data(tmp_path, monkeypatch):
    from acceptance.diagnostics import FailureEvidence
    monkeypatch.setenv('IRM_ACCEPTANCE_EVIDENCE', str(tmp_path))
    monkeypatch.setenv('IRM_ACCEPTANCE_STAGE', 'regressions')
    monkeypatch.setenv('IRM_ACCEPTANCE_DB_PASSWORD', 'hidden-password')
    plugin = FailureEvidence()
    for phase in ['setup', 'call', 'teardown']:
        report = type('Report', (), {'failed': True, 'nodeid': 'suite::case', 'when': phase,
                                    'longreprtext': 'hidden-password\nCookie: session=hidden-cookie\nValueError: safe detail'})()
        plugin.pytest_runtest_logreport(report)
    content = (tmp_path/'regressions-failures.json').read_text()
    assert 'hidden-password' not in content and 'hidden-cookie' not in content
    assert [row['phase'] for row in json.loads(content)] == ['setup', 'call', 'teardown']
    assert 'safe detail' in content


def test_live_login_closes_client_without_reentering_httpx(monkeypatch):
    import httpx
    import importlib.util
    spec = importlib.util.spec_from_file_location('live_network_helpers', Path(__file__).with_name('test_live_network.py'))
    live = importlib.util.module_from_spec(spec); spec.loader.exec_module(live)
    original = httpx.Client
    transport = httpx.MockTransport(lambda request: httpx.Response(200))
    monkeypatch.setattr(live.httpx, 'Client', lambda **kw: original(transport=transport, **kw))
    with live.login({'api': 'http://127.0.0.1:9'}, {'email': 'synthetic@example.com', 'password': 'synthetic'}) as client:
        assert not client.is_closed
    assert client.is_closed


def test_recovery_refuses_different_recorded_database_before_drop(tmp_path, monkeypatch):
    from acceptance import run
    database = FakeDatabase()
    lease = Lease('irm_acceptance_'+uuid4().hex, uuid4().hex, uuid4().hex)
    journal(tmp_path/'leases.jsonl', lease)
    (tmp_path/'summary.json').write_text(json.dumps({'run_id': lease.run_id, 'server_identity': {'database': 'wrong'}}))
    drops = []
    monkeypatch.setattr(run, 'drop_owned', lambda *a: drops.append(a))
    with pytest.raises(SafetyError, match='identity does not match'):
        run.recover(database, tmp_path)
    assert drops == [] and (tmp_path/'leases.jsonl').exists()


def test_recovery_refuses_missing_identity_without_connecting(tmp_path):
    from acceptance import run
    database = FakeDatabase()
    lease = Lease('irm_acceptance_'+uuid4().hex, uuid4().hex, uuid4().hex)
    journal(tmp_path/'leases.jsonl', lease)
    (tmp_path/'summary.json').write_text(json.dumps({'run_id': lease.run_id}))
    with pytest.raises(SafetyError, match='recorded leases and live server identity'):
        run.recover(database, tmp_path)
    assert database.calls == []


def test_dependency_bin_links_resolve_inside_copied_package(tmp_path, monkeypatch):
    from acceptance import run
    nm = tmp_path/'repo/frontend/node_modules'
    (nm/'package/bin').mkdir(parents=True); (nm/'.bin').mkdir()
    (nm/'package/bin/cli').write_text('cli')
    (nm/'.bin/cli').symlink_to('../package/bin/cli')
    (nm/'absolute').symlink_to(nm/'package/bin/cli')
    monkeypatch.setattr(run, 'ROOT', tmp_path/'repo')
    copied = run.copy_frontend(tmp_path/'copy')/'node_modules'
    assert (copied/'.bin/cli').resolve() == copied/'package/bin/cli'
    assert (copied/'absolute').resolve() == copied/'package/bin/cli'
    assert (copied/'package/bin/cli').stat().st_ino != (nm/'package/bin/cli').stat().st_ino


def test_pytest_reports_actual_setup_call_and_teardown_phases(tmp_path):
    script = tmp_path/'test_failures.py'
    script.write_text('''import pytest
@pytest.fixture
def setup_failure():
    raise RuntimeError("hidden-password")
@pytest.fixture
def teardown_failure():
    yield
    raise RuntimeError("hidden-password")
def test_setup(setup_failure): pass
def test_call(): raise RuntimeError("hidden-password")
def test_teardown(teardown_failure): pass
''')
    env = {**os.environ, 'IRM_ACCEPTANCE_EVIDENCE': str(tmp_path), 'IRM_ACCEPTANCE_STAGE': 'phase-check',
           'IRM_ACCEPTANCE_DB_PASSWORD': 'hidden-password'}
    command = 'import pytest, sys; from acceptance.diagnostics import FailureEvidence; sys.exit(pytest.main(sys.argv[1:], plugins=[FailureEvidence()]))'
    result = subprocess.run([sys.executable, '-c', command, str(script), '-q', '--tb=short'],
                            env=env, capture_output=True, text=True)
    assert result.returncode == 1
    raw = (tmp_path/'phase-check-failures.json').read_text()
    reports = json.loads(raw)
    assert [report['phase'] for report in reports] == ['setup', 'call', 'teardown']
    assert 'hidden-password' not in raw and 'RuntimeError' in raw
