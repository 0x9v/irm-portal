"""Only owned child process groups and evidence files; no port-based killing."""
import os
from pathlib import Path
import re
import signal
import subprocess
import threading


class StageFailure(RuntimeError):
    pass


def sanitize(value, secrets=()):
    for secret in secrets:
        if secret:
            value = value.replace(secret, "[redacted]")
    value = re.sub(r"postgresql(?:\+\w+)?://[^\s'\"]+", "[redacted database URL]", value)
    value = re.sub(r"irm-acceptance:[0-9a-f]{32}:[0-9a-f]{32}", "[redacted ownership marker]", value)
    value = re.sub(r"(?i)([\"']?(?:password|nonce|token_hash)[\"']?\s*[:=]\s*)([\"'])[^\"']*\2", r'\1"[redacted]"', value)
    value = re.sub(r"(?im)^.*(?:set-cookie|\bcookies?\b|token_hash|session=).*$", "[redacted cookie header]", value)
    return value


def process_start(pid):
    try:
        return Path(f"/proc/{pid}/stat").read_text().rsplit(')', 1)[1].split()[19]
    except FileNotFoundError:
        return None


class Children:
    def __init__(self, workspace, evidence, secrets=()):
        self.workspace, self.evidence = Path(workspace), Path(evidence)
        self.secrets = list(secrets)
        self.children = []

    def start(self, name, args, cwd, env, pass_fds=()):
        env = {**env, 'IRM_ACCEPTANCE_STAGE': name}
        self.secrets.extend(env.get(key) for key in ['IRM_ACCEPTANCE_NONCE', 'IRM_ACCEPTANCE_MANIFEST'])
        child = subprocess.Popen(args, cwd=cwd, env=env, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, text=True, errors='replace',
                                 start_new_session=True, pass_fds=pass_fds)
        def capture():
            with (self.evidence / (name + '.log')).open('w') as stream:
                for line in child.stdout:
                    stream.write(sanitize(line, self.secrets))
                    stream.flush()
            child.stdout.close()
        reader = threading.Thread(target=capture, daemon=True)
        reader.start()
        self.children.append((name, child, process_start(child.pid), reader))
        return child

    def stop(self, child):
        entry = next(row for row in self.children if row[1] is child)
        if child.poll() is not None:
            return
        if process_start(child.pid) != entry[2] or os.getpgid(child.pid) != child.pid:
            raise StageFailure("Owned process identity changed; refusing signal")
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            if process_start(child.pid) != entry[2]:
                raise StageFailure("Owned process identity changed during shutdown")
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=5)

    def preserve(self):
        for _, child, _, reader in self.children:
            if child.poll() is not None:
                reader.join(timeout=5)

    def run(self, name, args, cwd, env, timeout):
        child = self.start(name, args, cwd, env)
        try:
            child.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            self.stop(child)
            raise StageFailure(f"{name} timed out after {timeout}s")
        finally:
            self.preserve()
        if child.returncode:
            raise StageFailure(f"{name} exited {child.returncode}; see sanitized evidence")

    def close(self):
        failures = []
        for _, child, _, _ in reversed(self.children):
            try:
                self.stop(child)
            except Exception as error:
                failures.append(type(error).__name__)
        self.preserve()
        if failures:
            raise StageFailure("Owned child cleanup failed")
