import asyncio
import logging
from typing import Any, Callable
from uuid import UUID

from fastapi import WebSocket
from starlette import status
from starlette.websockets import WebSocketState
from starlette.concurrency import run_in_threadpool

from app.core.discussion import WS_QUEUE_MAX_SIZE

logger = logging.getLogger(__name__)


class Connection:
    def __init__(self, websocket: WebSocket, user_id: UUID, community_slug: str,
                 visibility_check: Callable[[str, UUID], bool] | None = None) -> None:
        self.websocket = websocket
        self.user_id = user_id
        self.community_slug = community_slug
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=WS_QUEUE_MAX_SIZE)
        self.receiver_task: asyncio.Task[None] | None = None
        self.sender_task: asyncio.Task[None] | None = None
        self.revalidation_task: asyncio.Task[None] | None = None
        self._cleanup_task: asyncio.Task[None] | None = None
        self.broadcaster: Any | None = None
        self.closed = False
        self.visibility_check = visibility_check

    async def send_loop(self) -> None:
        """Pulls events from the bounded queue and transmits to the WebSocket."""
        try:
            while not self.closed:
                event = await self.queue.get()
                if self.closed or self.websocket.client_state != WebSocketState.CONNECTED:
                    self.queue.task_done()
                    break
                try:
                    message_id = _payload_message_id(event)
                    if message_id and self.visibility_check:
                        try:
                            visible = await run_in_threadpool(self.visibility_check, self.community_slug, message_id)
                        except Exception:
                            logger.warning("Skipping discussion payload: visibility check unavailable")
                            continue
                        if not visible:
                            continue
                    if not self.closed:
                        await self.websocket.send_json(event)
                finally:
                    self.queue.task_done()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.debug("Discussion WebSocket sender stopped after transport error")
        finally:
            self.closed = True

    def enqueue(self, event: dict[str, Any]) -> bool:
        """
        Attempts to enqueue an event without blocking other subscribers.
        If the queue is full (slow/stalled client), triggers an immediate
        asynchronous disconnect and unregisters the connection to protect
        server memory and ensure remaining subscribers continue unhindered.
        """
        if self.closed:
            return False
        if event.get("type") == "message_removed":
            # Bounded queue, preserve other events' order and task accounting.
            retained = []
            while not self.queue.empty():
                queued = self.queue.get_nowait()
                self.queue.task_done()
                if str(_payload_message_id(queued)) != event.get("message_id"):
                    retained.append(queued)
            for queued in retained:
                self.queue.put_nowait(queued)
        try:
            self.queue.put_nowait(event)
            return True
        except asyncio.QueueFull:
            logger.warning(
                "WebSocket queue overflow for user %s in %s. Forcing slow-client disconnect.",
                self.user_id,
                self.community_slug,
            )
            self.closed = True
            # Schedule asynchronous disconnect and cleanup without blocking the broadcast loop
            asyncio.create_task(self.close_and_cleanup(reason="Queue overflow"))
            return False

    async def close_and_cleanup(self, reason: str = "Connection closed",
                                close_code: int = status.WS_1008_POLICY_VIOLATION) -> None:
        """
        Closes socket, cancels background tasks, drains queue, and unregisters from broadcaster.
        Ensures no messages can be sent once marked unauthorized or closed.
        """
        self.closed = True
        if self._cleanup_task is None:
            # Keep cleanup alive independently of its initiator. In particular,
            # the ASGI receiver may finish normally after the close frame and
            # cancel the revalidation task that requested cleanup.
            self._cleanup_task = asyncio.create_task(self._perform_close_and_cleanup(
                reason, close_code, asyncio.current_task()
            ))
        cleanup_task = self._cleanup_task
        if cleanup_task is not asyncio.current_task():
            # A caller's genuine cancellation still propagates, while the
            # shared close/unregister operation continues to completion.
            await asyncio.shield(cleanup_task)

    async def _perform_close_and_cleanup(self, reason: str, close_code: int,
                                        initiator: asyncio.Task[Any] | None) -> None:
        current_task = asyncio.current_task()
        tasks = [task for task in (self.sender_task, self.revalidation_task)
                 if task is not None and task is not initiator
                 and task is not current_task and not task.done()]
        close_sent = False
        for task in tasks:
            task.cancel()
        self._drain_queue()
        try:
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            if self.websocket.client_state == WebSocketState.CONNECTED:
                try:
                    await self.websocket.close(code=close_code, reason=reason)
                    close_sent = True
                except Exception:
                    # Socket closure can fail after transport loss. Keep the
                    # connection fail-closed and always unregister below.
                    logger.warning("Discussion WebSocket close failed during cleanup")
            receiver = self.receiver_task
            if receiver is not None and receiver is not current_task and not receiver.done():
                if close_sent:
                    # A successful ASGI close makes receive_text return a
                    # disconnect. Let the route finish its own lifecycle;
                    # cancelling it here can abort transport flushing.
                    await asyncio.gather(receiver, return_exceptions=True)
                else:
                    receiver.cancel()
                    await asyncio.gather(receiver, return_exceptions=True)
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            receiver = self.receiver_task
            if receiver is not None and receiver is not current_task and not receiver.done():
                receiver.cancel()
                await asyncio.gather(receiver, return_exceptions=True)
            self.closed = True
            self._drain_queue()
            await (self.broadcaster or broadcaster).disconnect(self, cancel_tasks=False)

    def _drain_queue(self) -> None:
        while not self.queue.empty():
            try:
                self.queue.get_nowait()
                self.queue.task_done()
            except (asyncio.QueueEmpty, ValueError):
                break


class DiscussionBroadcaster:
    """
    In-process community-scoped WebSocket broadcaster.

    Architectural note:
    This broadcaster operates in-process for a single backend instance on a single worker.
    Future horizontal scaling across multiple workers/nodes will require shared event
    distribution (e.g. PostgreSQL LISTEN/NOTIFY or Redis PubSub).
    """

    def __init__(self) -> None:
        # community_slug -> set of Connection objects
        self._connections: dict[str, set[Connection]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, connection: Connection) -> None:
        connection.broadcaster = self
        async with self._lock:
            if connection.community_slug not in self._connections:
                self._connections[connection.community_slug] = set()
            self._connections[connection.community_slug].add(connection)
        connection.sender_task = asyncio.create_task(connection.send_loop())

    async def disconnect(self, connection: Connection, *, cancel_tasks: bool = True) -> None:
        connection.closed = True
        current_task = asyncio.current_task()
        tasks = []
        if cancel_tasks:
            tasks = [task for task in (connection.receiver_task, connection.sender_task, connection.revalidation_task)
                     if task is not None and task is not current_task
                     and task is not connection._cleanup_task and not task.done()]
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

        while not connection.queue.empty():
            try:
                connection.queue.get_nowait()
                connection.queue.task_done()
            except (asyncio.QueueEmpty, ValueError):
                break

        async with self._lock:
            conns = self._connections.get(connection.community_slug)
            if conns and connection in conns:
                conns.remove(connection)
                if not conns:
                    del self._connections[connection.community_slug]

    async def broadcast(self, community_slug: str, event: dict[str, Any]) -> None:
        """Dispatches an event strictly to clients connected to the specified community."""
        conns_snapshot: list[Connection] = []
        async with self._lock:
            conns = self._connections.get(community_slug)
            if conns:
                conns_snapshot = list(conns)

        for conn in conns_snapshot:
            if not conn.closed:
                conn.enqueue(event)

    async def shutdown(self) -> None:
        """Closes all active connections gracefully on server shutdown."""
        all_conns: list[Connection] = []
        async with self._lock:
            for conns in self._connections.values():
                all_conns.extend(conns)

        for conn in all_conns:
            await conn.close_and_cleanup(reason="Server shutting down", close_code=1001)


# Global singleton broadcaster instance
broadcaster = DiscussionBroadcaster()


def _payload_message_id(event: dict[str, Any]) -> UUID | None:
    if event.get("type") not in ("message_created", "reaction_changed"):
        return None
    value = (event.get("message") or {}).get("id") if event["type"] == "message_created" else event.get("message_id")
    try:
        return UUID(str(value)) if value else None
    except ValueError:
        return None
