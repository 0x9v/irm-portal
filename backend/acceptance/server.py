"""A test-only application factory and bound-socket uvicorn lifecycle."""
import asyncio
from contextlib import asynccontextmanager, contextmanager
import socket
import threading
import time

from fastapi import Header, HTTPException
import uvicorn

from acceptance.isolation import AttachedDatabase


def application(resource):
    from app.main import app
    from app.database.session import get_db
    from app.api.v1.endpoints import discussion
    from app.core.broadcaster import broadcaster
    factory = resource.factory
    original_overrides = app.dependency_overrides.copy()
    original_ws = discussion.SessionLocal

    def database():
        with factory() as session:
            resource.verify_session(session)
            yield session

    app.dependency_overrides[get_db] = database
    discussion.SessionLocal = factory
    # Confirm the exact REST and WS factories against LIVE connections before startup.
    for label, selected in [("rest", factory), ("websocket", discussion.SessionLocal)]:
        with selected() as session:
            resource.verify_session(session)
    app.state.acceptance_factory = factory
    app.state.acceptance_resource = resource
    observed = {}
    original_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(application):
        async def sample():
            while True:
                for group in list(broadcaster._connections.values()):
                    for connection in list(group):
                        observed[id(connection)] = connection
                await asyncio.sleep(0.02)
        async with original_lifespan(application):
            observer = asyncio.create_task(sample())
            try:
                yield
            finally:
                observer.cancel()
                await asyncio.gather(observer, return_exceptions=True)
    app.router.lifespan_context = lifespan

    def authorize(value):
        if value != resource.lease.run_id:
            raise HTTPException(403, "Test-run identity required")

    @app.get("/__acceptance__/identity", include_in_schema=False)
    def identity(x_acceptance_run: str = Header(default="")):
        authorize(x_acceptance_run)
        identities = []
        for selected in [factory, discussion.SessionLocal]:
            with selected() as session:
                identities.append(resource.verify_session(session))
        return {"rest": identities[0], "websocket": identities[1], "same_factory": factory is discussion.SessionLocal}

    @app.get("/__acceptance__/connections", include_in_schema=False)
    async def connections(x_acceptance_run: str = Header(default="")):
        authorize(x_acceptance_run)
        active = {id(c) for group in broadcaster._connections.values() for c in group}
        result = []
        for key, connection in observed.items():
            result.append({"user_id": str(connection.user_id), "community": connection.community_slug,
                           "registered": key in active, "closed": connection.closed, "queued": connection.queue.qsize(), "unfinished": connection.queue._unfinished_tasks,
                           "sender_done": connection.sender_task is None or connection.sender_task.done(),
                           "revalidation_done": connection.revalidation_task is None or connection.revalidation_task.done(),
                           "rejects_enqueue": not connection.enqueue({"type": "acceptance_probe"}) if connection.closed else None})
        return result

    def restore():
        app.dependency_overrides.clear()
        app.dependency_overrides.update(original_overrides)
        discussion.SessionLocal = original_ws
        app.router.lifespan_context = original_lifespan
        # Test routes must not accumulate across module fixtures in one process.
        app.router.routes[:] = [route for route in app.router.routes if not getattr(route, "path", "").startswith("/__acceptance__/")]
    return app, restore


@contextmanager
def test_server(resource):
    app, restore = application(resource)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server = thread = None
    try:
        sock.bind(("127.0.0.1", 0))
        sock.listen(128)
        port = sock.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", access_log=False))
        thread = threading.Thread(target=lambda: server.run(sockets=[sock]), daemon=True)
        thread.start()
        deadline = time.monotonic() + 10
        while not server.started:
            if not thread.is_alive() or time.monotonic() > deadline:
                raise RuntimeError("Owned uvicorn failed to start")
            time.sleep(0.02)
        yield port
    finally:
        if server:
            server.should_exit = True
        if thread:
            thread.join(timeout=10)
            if thread.is_alive():
                server.force_exit = True
                thread.join(timeout=3)
        sock.close()
        if thread and thread.is_alive():
            raise RuntimeError("Owned server thread did not finish; fail the worker for process cleanup")
        restore()


def serve(fd):
    resource = AttachedDatabase()
    app, restore = application(resource)
    sock = socket.socket(fileno=fd)
    try:
        uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False)).run(sockets=[sock])
    finally:
        sock.close()
        restore()
        resource.close()
