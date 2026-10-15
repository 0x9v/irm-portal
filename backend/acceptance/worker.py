"""Child-process operations; configuration comes only from the runner's environment."""
import sys
from acceptance.isolation import AttachedDatabase


def main():
    mode = sys.argv[1]
    if mode == "serve":
        from acceptance.server import serve
        serve(int(sys.argv[2]))
    elif mode == "seed":
        from acceptance.seed import seed
        seed(sys.argv[2], sys.argv[3])
    elif mode == "pytest":
        # Verify ownership before collecting application/test modules.
        import pytest
        from acceptance.diagnostics import FailureEvidence
        resource = AttachedDatabase()
        resource.close()
        raise SystemExit(pytest.main(sys.argv[2:], plugins=[FailureEvidence()]))
    else:
        raise RuntimeError("Unknown acceptance worker mode")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        from acceptance.diagnostics import worker_failure
        worker_failure(error)
        raise SystemExit(1)
