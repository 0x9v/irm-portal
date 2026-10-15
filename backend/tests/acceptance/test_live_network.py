"""Real HTTP/cookie/WebSocket acceptance against runner-owned synthetic data."""
import asyncio
from contextlib import contextmanager
import json
import os
from pathlib import Path
import secrets
import time
from uuid import uuid4

import httpx
import pytest
import websockets

from acceptance.isolation import AttachedDatabase


@pytest.fixture(scope='module')
def live():
    resource = AttachedDatabase()  # Live ownership verification before any writes.
    resource.close()
    value = json.loads(Path(os.environ['IRM_ACCEPTANCE_MANIFEST']).read_text())
    assert value['run_id'] == os.environ['IRM_ACCEPTANCE_RUN_ID']
    with httpx.Client(trust_env=False, timeout=10) as probe:
        response = probe.get(value['api']+'/__acceptance__/identity', headers={'X-Acceptance-Run': value['run_id']})
        assert response.status_code == 200
        identity = response.json()
        assert identity['same_factory']
        assert identity['rest']['schema'] == identity['websocket']['schema'] == os.environ['IRM_ACCEPTANCE_SCHEMA']
    return value


def authenticated_client(live, actor):
    client = httpx.Client(base_url=live['api'], trust_env=False, timeout=10)
    response = client.post('/api/v1/auth/login', json={k: actor[k] for k in ['email', 'password']})
    if response.status_code != 200:
        client.close()
        pytest.fail(f'Synthetic login returned HTTP {response.status_code}')
    return client


@contextmanager
def login(live, actor):
    client = authenticated_client(live, actor)
    try:
        yield client
    finally:
        client.close()


def synthetic_target(live, leader):
    suffix = uuid4().hex[:12]
    actor = {'email': f'net_{suffix}@example.com', 'password': secrets.token_urlsafe(24)}
    with httpx.Client(base_url=live['api'], trust_env=False) as client:
        response = client.post('/api/v1/auth/register', json={**actor, 'username': 'net_'+suffix, 'first_name': 'Synthetic', 'family_name': 'Network'})
        assert response.status_code == 201
        actor['id'] = response.json()['id']
    client = authenticated_client(live, actor)
    response = client.post('/api/v1/communities/irm/membership', json={'cne': 'NET_'+suffix})
    assert response.status_code == 201
    actor['membership_id'] = response.json()['id']
    assert leader.post(f"/api/v1/communities/irm/membership/{actor['membership_id']}/approve").status_code == 200
    return client, actor


def socket(live, client, community='irm'):
    return websockets.connect(live['api'].replace('http:', 'ws:')+f'/api/v1/communities/{community}/discussion/ws',
                              origin=live['frontend'], additional_headers={'Cookie': 'session='+client.cookies.get('session')})


async def observed(live, client, user, predicate):
    deadline = time.monotonic()+5
    while time.monotonic() < deadline:
        response = await asyncio.to_thread(client.get, '/__acceptance__/connections', headers={'X-Acceptance-Run': live['run_id']})
        assert response.status_code == 200
        matching = [row for row in response.json() if row['user_id'] == user]
        if matching and predicate(matching[-1]): return matching[-1]
        await asyncio.sleep(.05)
    pytest.fail('Owned connection cleanup/registration did not meet its deadline')


@pytest.mark.parametrize('action', ['remove', 'ban'])
def test_default_interval_real_revocation_and_cleanup(live, action):
    from app.core.discussion import WS_REVALIDATION_INTERVAL_SECONDS
    assert WS_REVALIDATION_INTERVAL_SECONDS == 30
    async def workflow():
        with login(live, live['actors']['delegate']) as leader:
            client, actor = synthetic_target(live, leader)
            try:
                async with socket(live, client) as ws:
                    await observed(live, leader, actor['id'], lambda row: row['registered'])
                    response = await asyncio.to_thread(leader.delete if action == 'remove' else leader.put,
                        f"/api/v1/communities/irm/memberships/{actor['membership_id']}" + ('' if action == 'remove' else '/ban'))
                    committed = time.monotonic()
                    assert response.status_code == 204 and response.content == b''
                    with pytest.raises(websockets.exceptions.ConnectionClosed) as closed:
                        await asyncio.wait_for(ws.recv(), timeout=50)
                    elapsed = time.monotonic()-committed
                    assert closed.value.rcvd.code == 1008
                    row = await observed(live, leader, actor['id'], lambda row: row['closed'] and not row['registered'] and row['sender_done'] and row['revalidation_done'])
                    assert row['queued'] == 0 and row['unfinished'] == 0 and row['rejects_enqueue'] is True
                    evidence = Path(os.environ['IRM_ACCEPTANCE_EVIDENCE'])/f'revocation-{action}.json'
                    evidence.write_text(json.dumps({'action': action, 'configured_interval_seconds': 30, 'response_to_close_seconds': elapsed, 'close_code': 1008, 'cleanup': row}, indent=2))
                assert client.get('/api/v1/auth/me').status_code == 200
                assert client.get('/api/v1/communities/irm/discussion/messages').status_code == 403
            finally:
                if action == 'ban':
                    state = leader.get('/api/v1/communities/irm/memberships?status=BANNED&limit=100')
                    if state.status_code == 200 and actor['membership_id'] in {item['id'] for item in state.json()['items']}:
                        assert leader.delete(f"/api/v1/communities/irm/memberships/{actor['membership_id']}/ban").status_code == 204
                client.close()
    asyncio.run(workflow())


def test_real_message_removal_is_scoped_and_history_excludes_it(live):
    async def workflow():
        with login(live, live['actors']['delegate']) as leader, login(live, live['actors']['member']) as member, login(live, live['actors']['foreign_member']) as foreign:
            async with socket(live, member) as ws, socket(live, foreign, 'foreign') as other:
                response = await asyncio.to_thread(member.post, '/api/v1/communities/irm/discussion/messages', json={'client_message_id': str(uuid4()), 'kind': 'TEXT', 'content': 'Synthetic network removal'})
                assert response.status_code == 201
                mid = response.json()['id']
                assert json.loads(await asyncio.wait_for(ws.recv(), 5))['type'] == 'message_created'
                path = f'/api/v1/communities/irm/discussion/messages/{mid}'
                deleted = await asyncio.to_thread(leader.delete, path)
                assert deleted.status_code == 204 and not deleted.content
                event = json.loads(await asyncio.wait_for(ws.recv(), 5))
                assert event == {'type': 'message_removed', 'community_slug': 'irm', 'message_id': mid}
                with pytest.raises(asyncio.TimeoutError): await asyncio.wait_for(other.recv(), .3)
                assert leader.delete(path).status_code == 204
            history = member.get('/api/v1/communities/irm/discussion/messages').json()['items']
            assert mid not in {item['id'] for item in history}
            async with socket(live, member):
                assert mid not in {item['id'] for item in member.get('/api/v1/communities/irm/discussion/messages').json()['items']}
    asyncio.run(workflow())
