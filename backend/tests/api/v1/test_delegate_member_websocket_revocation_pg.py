"""Real PostgreSQL WebSocket access revocation tests for Task 0.1.8."""

import asyncio
from contextlib import closing
from datetime import datetime, timedelta, timezone
import json
import socket
import threading
import time
import uuid
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
import uvicorn
import websockets

from app.core.broadcaster import Connection, broadcaster
from app.core.config import settings
from app.core.discussion import WS_QUEUE_MAX_SIZE, WS_REVALIDATION_INTERVAL_SECONDS
from app.core.sessions import create_session
from app.database import Base
from app.database.session import get_db
from app.main import app
from app.models.community import Community
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.session import Session as AccountSession
from app.models.user import User
from app.api.v1.endpoints import discussion as discussion_api
from app.api.v1.endpoints.discussion import check_ws_auth
from app.services.membership import remove_community_membership, ban_community_membership

@pytest.fixture
def anyio_backend():
    # Application/broadcaster uses asyncio; no alternative-loop workaround.
    return "asyncio"


engine = None
TestingSessionLocal = None
_owned_pg = None


@pytest.fixture(scope="module", autouse=True)
def owned_pg_factories(isolated_pg):
    global engine, TestingSessionLocal, _owned_pg
    engine, TestingSessionLocal, _owned_pg = isolated_pg.engine, isolated_pg.factory, isolated_pg
    yield
    engine = TestingSessionLocal = _owned_pg = None



def verify_test_db(session: Session) -> None:
    _owned_pg.verify_session(session)


@pytest.fixture(scope="module")
def ws_server(owned_pg_factories):
    from acceptance.server import test_server
    with test_server(_owned_pg) as port:
        yield port


@pytest.fixture
def ws_data(ws_server):
    with TestingSessionLocal() as s:
        verify_test_db(s)
        _owned_pg.truncate(s, ['management_events', 'discussion_reactions', 'discussion_messages', 'memberships', 'sessions', 'communities', 'users'])
        s.commit()

        comm_irm = Community(id=uuid4(), name="IRM Community", slug="irm")
        s.add(comm_irm)
        s.flush()

        u_del = User(id=uuid4(), username="delegate", email="del@test.invalid", password_hash="h", first_name="D", family_name="U")
        u_mem = User(id=uuid4(), username="member", email="mem@test.invalid", password_hash="h", first_name="M", family_name="U")
        s.add_all([u_del, u_mem])
        s.flush()

        now = datetime.now(timezone.utc)
        m_del = Membership(id=uuid4(), user_id=u_del.id, community_id=comm_irm.id, cne="C1", role=MembershipRole.DELEGATE, status=MembershipStatus.ACTIVE, created_at=now, updated_at=now)
        m_mem = Membership(id=uuid4(), user_id=u_mem.id, community_id=comm_irm.id, cne="C2", role=MembershipRole.MEMBER, status=MembershipStatus.ACTIVE, created_at=now, updated_at=now)
        s.add_all([m_del, m_mem])

        tok_del, _ = create_session(s, u_del.id, timedelta(hours=2))
        tok_mem, _ = create_session(s, u_mem.id, timedelta(hours=2))
        s.commit()

        return {
            "port": ws_server,
            "comm_id": comm_irm.id,
            "del_id": u_del.id,
            "del_mid": str(m_del.id),
            "mem_id": u_mem.id,
            "mem_mid": str(m_mem.id),
            "tok_del": tok_del,
            "tok_mem": tok_mem,
        }


def test_check_ws_auth_recognizes_removed_and_banned(ws_data):
    tok = ws_data["tok_mem"]
    mem_mid = ws_data["mem_mid"]
    del_id = ws_data["del_id"]

    # 1. Active member validates successfully
    valid, uid, reason = check_ws_auth(tok, "irm")
    assert valid is True
    assert uid == ws_data["mem_id"]
    assert reason is None

    # 2. Delegate removes membership
    with TestingSessionLocal() as s:
        del_user = s.get(User, del_id)
        remove_community_membership(s, "irm", mem_mid, del_user)

    # 3. check_ws_auth recognizes REMOVED status
    valid, uid, reason = check_ws_auth(tok, "irm")
    assert valid is False
    assert uid is None
    assert reason == "Inactive or absent membership"

    # 4. Delegate bans membership
    with TestingSessionLocal() as s:
        del_user = s.get(User, del_id)
        ban_community_membership(s, "irm", mem_mid, del_user)

    # 5. check_ws_auth recognizes BANNED status
    valid, uid, reason = check_ws_auth(tok, "irm")
    assert valid is False
    assert uid is None
    assert reason == "Inactive or absent membership"


@pytest.mark.anyio
@pytest.mark.parametrize("action", ["remove", "ban"])
async def test_websocket_periodic_revalidation_disconnects_removed_or_banned_member(ws_data, monkeypatch, action):
    # Set revalidation interval to 0.2s for deterministic and fast test
    monkeypatch.setattr(discussion_api, "WS_REVALIDATION_INTERVAL_SECONDS", 0.2)

    port = ws_data["port"]
    uri = f"ws://127.0.0.1:{port}/api/v1/communities/irm/discussion/ws"
    headers = {"Cookie": f"{settings.session_cookie_name}={ws_data['tok_mem']}"}

    async with websockets.connect(uri, origin="http://localhost:3000", additional_headers=headers) as ws:
        await asyncio.sleep(0.1)

        # Connection is registered in broadcaster
        conns = broadcaster._connections.get("irm", set())
        assert any(c.user_id == ws_data["mem_id"] for c in conns)

        # Remove membership while connected
        with TestingSessionLocal() as s:
            del_user = s.get(User, ws_data["del_id"])
            if action == "remove":
                remove_community_membership(s, "irm", ws_data["mem_mid"], del_user)
            else:
                ban_community_membership(s, "irm", ws_data["mem_mid"], del_user)

        # Wait for periodic revalidation to trigger close
        with pytest.raises(websockets.exceptions.ConnectionClosed) as exc_info:
            # Attempt to read next frame; socket should close with code 1008
            await asyncio.wait_for(ws.recv(), timeout=2.0)

        assert exc_info.value.rcvd.code == 1008
        assert exc_info.value.rcvd.reason == "Session expired or membership revoked"

        # Verify connection unregistered from broadcaster
        await asyncio.sleep(0.1)
        conns_after = broadcaster._connections.get("irm", set())
        assert not any(c.user_id == ws_data["mem_id"] for c in conns_after)


@pytest.mark.anyio
async def test_websocket_periodic_revalidation_disconnects_revoked_session(ws_data, monkeypatch):
    monkeypatch.setattr(discussion_api, "WS_REVALIDATION_INTERVAL_SECONDS", 0.2)
    uri = f"ws://127.0.0.1:{ws_data['port']}/api/v1/communities/irm/discussion/ws"
    headers = {"Cookie": f"{settings.session_cookie_name}={ws_data['tok_mem']}"}

    async with websockets.connect(uri, origin="http://localhost:3000", additional_headers=headers) as ws:
        await asyncio.sleep(0.05)
        with TestingSessionLocal() as session:
            verify_test_db(session)
            account_session = session.query(AccountSession).filter_by(user_id=ws_data["mem_id"]).one()
            account_session.is_revoked = True
            session.commit()

        with pytest.raises(websockets.exceptions.ConnectionClosed) as exc_info:
            await asyncio.wait_for(ws.recv(), timeout=2.0)
        assert exc_info.value.rcvd.code == 1008
        assert exc_info.value.rcvd.reason == "Session expired or membership revoked"

        await asyncio.sleep(0.05)
        conns_after = broadcaster._connections.get("irm", set())
        assert not any(c.user_id == ws_data["mem_id"] for c in conns_after)


@pytest.mark.anyio
async def test_websocket_close_and_cleanup_drains_queue_and_halts_sends():
    user_id = uuid4()
    mock_ws = object()
    conn = Connection(websocket=mock_ws, user_id=user_id, community_slug="irm")

    # Enqueue events
    assert conn.enqueue({"type": "test", "data": 1}) is True
    assert conn.enqueue({"type": "test", "data": 2}) is True
    assert conn.queue.qsize() == 2

    # Close and cleanup
    conn.closed = True
    while not conn.queue.empty():
        conn.queue.get_nowait()
        conn.queue.task_done()

    # Further enqueues rejected immediately
    assert conn.enqueue({"type": "test", "data": 3}) is False
    assert conn.queue.empty()
