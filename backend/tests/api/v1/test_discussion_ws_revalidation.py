"""Deterministic WebSocket revalidation failure and cancellation coverage."""
import asyncio
import threading
from uuid import uuid4

import pytest
from starlette.websockets import WebSocketState

from app.api.v1.endpoints import discussion
from app.core import broadcaster as broadcaster_module


@pytest.fixture
def anyio_backend():
    return "asyncio"


class Socket:
    def __init__(self, *, fail_close=False):
        self.client_state = WebSocketState.CONNECTED
        self.close_code = None
        self.close_reason = None
        self.close_count = 0
        self.fail_close = fail_close
        self.close_started = asyncio.Event()
        self.allow_close = asyncio.Event()
        self.allow_close.set()

    async def close(self, code, reason):
        self.close_count += 1
        self.close_started.set()
        await self.allow_close.wait()
        if self.fail_close:
            raise RuntimeError("transport closed")
        self.close_code = code
        self.close_reason = reason
        self.client_state = WebSocketState.DISCONNECTED


def register(monkeypatch, socket=None):
    local = broadcaster_module.DiscussionBroadcaster()
    monkeypatch.setattr(broadcaster_module, "broadcaster", local)
    monkeypatch.setattr(discussion, "broadcaster", local)
    connection = broadcaster_module.Connection(socket or Socket(), uuid4(), "irm")
    local._connections["irm"] = {connection}
    return local, connection


@pytest.mark.parametrize("reason", ["Invalid or expired session", "Inactive or absent membership"])
@pytest.mark.anyio
async def test_confirmed_session_or_membership_loss_closes_with_policy_code(monkeypatch, reason):
    local, conn = register(monkeypatch)
    conn.enqueue({"type": "message_created", "message": {"content": "private"}})
    monkeypatch.setattr(discussion, "WS_REVALIDATION_INTERVAL_SECONDS", 0)

    async def invalid(*_args):
        return False, None, reason

    monkeypatch.setattr(discussion, "_bounded_ws_auth_check", invalid)
    task = asyncio.create_task(discussion.revalidate_ws_connection(conn, "opaque-token", "irm"))
    conn.revalidation_task = task
    await task

    assert conn.websocket.close_code == 1008
    assert conn.websocket.close_reason == "Session expired or membership revoked"
    assert conn.queue.empty()
    assert "irm" not in local._connections
    assert not conn.enqueue({"type": "late"})
    assert conn._cleanup_task is not None and conn._cleanup_task.done()


@pytest.mark.anyio
async def test_operational_revalidation_exception_fails_closed_and_sanitizes_reason(monkeypatch, caplog):
    local, conn = register(monkeypatch)
    conn.enqueue({"type": "message_created", "message": {"content": "private"}})
    monkeypatch.setattr(discussion, "WS_REVALIDATION_INTERVAL_SECONDS", 0)

    async def unavailable(*_args):
        raise RuntimeError("SQL password=secret token=opaque private message")

    monkeypatch.setattr(discussion, "_bounded_ws_auth_check", unavailable)
    task = asyncio.create_task(discussion.revalidate_ws_connection(conn, "opaque-token", "irm"))
    conn.revalidation_task = task
    await task

    assert conn.websocket.close_code == 1011
    assert conn.websocket.close_reason == "Authorization check unavailable"
    assert conn.closed and conn.queue.empty()
    assert conn.queue._unfinished_tasks == 0
    assert "irm" not in local._connections
    assert not conn.enqueue({"type": "late"})
    assert "password=secret" not in caplog.text
    assert "private message" not in caplog.text


@pytest.mark.anyio
async def test_hung_auth_worker_times_out_socket_without_cancelling_worker(monkeypatch):
    _local, conn = register(monkeypatch)
    started = threading.Event()
    release = threading.Event()
    finished = threading.Event()
    monkeypatch.setattr(discussion, "WS_REVALIDATION_INTERVAL_SECONDS", 0)
    monkeypatch.setattr(discussion, "WS_AUTH_CHECK_TIMEOUT_SECONDS", 0.02)

    def slow_check(*_args):
        started.set()
        release.wait(timeout=2)
        finished.set()
        return True, conn.user_id, None

    monkeypatch.setattr(discussion, "check_ws_auth", slow_check)
    task = asyncio.create_task(discussion.revalidate_ws_connection(conn, "opaque-token", "irm"))
    conn.revalidation_task = task
    deadline = asyncio.get_running_loop().time() + 1
    while not started.is_set() and asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(0.005)
    assert started.is_set()
    await task

    assert conn.websocket.close_code == 1011
    assert conn.websocket.close_reason == "Authorization check unavailable"
    assert not finished.is_set()
    release.set()
    deadline = asyncio.get_running_loop().time() + 1
    while not finished.is_set() and asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(0.005)
    assert finished.is_set()


@pytest.mark.anyio
async def test_normal_revalidation_cancellation_propagates_without_auth_failure(monkeypatch):
    _local, conn = register(monkeypatch)
    monkeypatch.setattr(discussion, "WS_REVALIDATION_INTERVAL_SECONDS", 60)
    task = asyncio.create_task(discussion.revalidate_ws_connection(conn, "opaque-token", "irm"))
    conn.revalidation_task = task
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not conn.closed
    assert conn.websocket.close_code is None


@pytest.mark.anyio
async def test_concurrent_cleanup_is_idempotent_drains_and_awaits_tasks(monkeypatch):
    local, conn = register(monkeypatch)
    conn.websocket.allow_close.clear()
    conn.enqueue({"type": "pending"})
    sender = asyncio.create_task(asyncio.Event().wait())
    revalidation = asyncio.create_task(asyncio.Event().wait())
    conn.sender_task = sender
    conn.revalidation_task = revalidation

    first = asyncio.create_task(conn.close_and_cleanup("Authorization check unavailable", close_code=1011))
    await conn.websocket.close_started.wait()
    second = asyncio.create_task(conn.close_and_cleanup("duplicate", close_code=1008))
    await local.disconnect(conn)
    assert not conn.enqueue({"type": "late"})
    conn.websocket.allow_close.set()
    await asyncio.gather(first, second)

    assert conn.websocket.close_count == 1
    assert conn.websocket.close_code == 1011
    assert sender.cancelled() and revalidation.cancelled()
    assert conn.queue.empty() and conn.queue._unfinished_tasks == 0
    assert "irm" not in local._connections
    await conn.close_and_cleanup("repeat")
    assert conn.websocket.close_count == 1


@pytest.mark.anyio
async def test_socket_close_failure_still_unregisters_and_refuses_enqueues(monkeypatch, caplog):
    socket = Socket(fail_close=True)
    local, conn = register(monkeypatch, socket)
    receiver = asyncio.create_task(asyncio.Event().wait())
    conn.receiver_task = receiver
    conn.enqueue({"type": "pending"})

    await conn.close_and_cleanup("Authorization check unavailable", close_code=1011)

    assert conn.closed and conn.queue.empty()
    assert conn.queue._unfinished_tasks == 0
    assert "irm" not in local._connections
    assert not conn.enqueue({"type": "late"})
    assert receiver.cancelled()
    await conn.close_and_cleanup("repeat")
    assert socket.close_count == 1
    assert "transport closed" not in caplog.text
