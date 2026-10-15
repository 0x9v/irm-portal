"""Revocation cleanup must finish when invoked by its own background task."""
import asyncio
from uuid import uuid4

import pytest
from starlette.websockets import WebSocketState

from app.core import broadcaster as module


@pytest.mark.parametrize("caller", ["revalidation", "external"])
def test_revocation_closes_socket_and_unregisters_without_self_cancellation(monkeypatch, caller):
    async def scenario():
        local = module.DiscussionBroadcaster()
        monkeypatch.setattr(module, "broadcaster", local)

        class Socket:
            client_state = WebSocketState.CONNECTED
            closed_code = None

            async def close(self, code, reason):
                # Real network sends can suspend: cancellation must not cut this off.
                await asyncio.sleep(0)
                self.closed_code = code
                self.client_state = WebSocketState.DISCONNECTED

        socket = Socket()
        connection = module.Connection(socket, uuid4(), "irm")
        local._connections["irm"] = {connection}
        connection.enqueue({"type": "pending"})
        connection.sender_task = asyncio.create_task(asyncio.Event().wait())
        if caller == "external":
            connection.revalidation_task = asyncio.create_task(asyncio.Event().wait())
        cleanup = asyncio.create_task(connection.close_and_cleanup("Membership revoked"))
        if caller == "revalidation":
            connection.revalidation_task = cleanup
        try:
            await cleanup
        except asyncio.CancelledError:
            pytest.fail("Revocation cancelled its own cleanup before socket close/unregister")
        await asyncio.sleep(0)
        assert socket.closed_code == 1008
        assert connection.closed
        assert connection.queue.empty()
        assert "irm" not in local._connections
        assert connection.sender_task.cancelled()
        if caller == "external":
            assert connection.revalidation_task.cancelled()
        assert not connection.enqueue({"type": "late"})

    asyncio.run(scenario())


def test_revocation_keeps_asgi_receiver_alive_until_close_disconnect(monkeypatch):
    async def scenario():
        local = module.DiscussionBroadcaster()
        monkeypatch.setattr(module, "broadcaster", local)

        class Socket:
            client_state = WebSocketState.CONNECTED
            close_code = None
            close_complete = asyncio.Event()

            async def close(self, code, reason):
                # Model the ASGI server completing the transport send before
                # receive_text observes the resulting disconnect.
                await asyncio.sleep(0)
                self.close_code = code
                self.client_state = WebSocketState.DISCONNECTED
                self.close_complete.set()

        socket = Socket()
        receiver_finished = []
        connection = module.Connection(socket, uuid4(), "irm")
        local._connections["irm"] = {connection}

        async def asgi_receiver():
            try:
                await socket.close_complete.wait()
            finally:
                receiver_finished.append(socket.close_code is not None)
                # The real route's finally block unregisters after receiving
                # the close-induced disconnect.
                await local.disconnect(connection)

        connection.receiver_task = asyncio.create_task(asgi_receiver())
        await asyncio.sleep(0)
        cleanup = asyncio.create_task(connection.close_and_cleanup(
            "Session expired or membership revoked"
        ))
        await cleanup

        assert socket.close_code == 1008
        assert receiver_finished == [True]
        assert connection.receiver_task.done() and not connection.receiver_task.cancelled()
        assert connection.closed
        assert "irm" not in local._connections

    asyncio.run(scenario())


def test_cancelling_cleanup_caller_does_not_cancel_shared_close(monkeypatch):
    async def scenario():
        local = module.DiscussionBroadcaster()
        monkeypatch.setattr(module, "broadcaster", local)

        class Socket:
            client_state = WebSocketState.CONNECTED
            close_code = None
            close_started = asyncio.Event()
            allow_close = asyncio.Event()

            async def close(self, code, reason):
                self.close_started.set()
                await self.allow_close.wait()
                self.close_code = code
                self.client_state = WebSocketState.DISCONNECTED

        socket = Socket()
        connection = module.Connection(socket, uuid4(), "irm")
        local._connections["irm"] = {connection}
        caller = asyncio.create_task(connection.close_and_cleanup("Revoked"))
        await socket.close_started.wait()
        cleanup = connection._cleanup_task
        caller.cancel()
        with pytest.raises(asyncio.CancelledError):
            await caller
        assert cleanup is not None and not cleanup.done()
        socket.allow_close.set()
        await cleanup
        assert socket.close_code == 1008
        assert connection.closed
        assert "irm" not in local._connections

    asyncio.run(scenario())


def test_disconnect_from_revalidation_waits_for_registry_lock_without_self_cancellation():
    async def scenario():
        local = module.DiscussionBroadcaster()
        connection = module.Connection(object(), uuid4(), "irm")
        local._connections["irm"] = {connection}
        await local._lock.acquire()
        cleanup = asyncio.create_task(local.disconnect(connection))
        connection.revalidation_task = cleanup
        await asyncio.sleep(0)
        local._lock.release()
        try:
            await cleanup
        except asyncio.CancelledError:
            pytest.fail("Disconnect cancelled its own task while waiting to unregister")
        assert "irm" not in local._connections
        assert connection.closed

    asyncio.run(scenario())
