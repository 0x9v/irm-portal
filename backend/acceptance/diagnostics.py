"""Sanitized pytest phase evidence; never write raw reports or private manifests."""
import json
import os
from pathlib import Path
import traceback

from acceptance.processes import sanitize


def secrets():
    values = [os.environ.get(key) for key in ['IRM_ACCEPTANCE_DB_PASSWORD', 'IRM_ACCEPTANCE_NONCE', 'IRM_ACCEPTANCE_MANIFEST']]
    manifest = os.environ.get('IRM_ACCEPTANCE_MANIFEST')
    if manifest:
        try:
            values.extend(actor['password'] for actor in json.loads(Path(manifest).read_text())['actors'].values())
        except (OSError, ValueError, KeyError):
            # A broken/missing manifest must not prevent redacted setup evidence.
            pass
    return values


class FailureEvidence:
    def __init__(self):
        self.failures = []

    def pytest_runtest_logreport(self, report):
        if report.failed:
            self.failures.append({'test': report.nodeid, 'phase': report.when,
                                  'traceback': sanitize(report.longreprtext, secrets())})
            self.write()

    def write(self):
        evidence = os.environ.get('IRM_ACCEPTANCE_EVIDENCE')
        if evidence:
            stage = os.environ['IRM_ACCEPTANCE_STAGE']
            (Path(evidence) / (stage + '-failures.json')).write_text(json.dumps(self.failures, indent=2))


def worker_failure(error):
    detail = sanitize(''.join(traceback.format_exception(error, limit=8)), secrets())
    print(detail)
    plugin = FailureEvidence()
    plugin.failures.append({'phase': 'worker_setup', 'error': type(error).__name__, 'traceback': detail})
    plugin.write()
