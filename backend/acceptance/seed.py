"""Bootstrap synthetic infrastructure; accounts/content use supported HTTP APIs."""
import json
import os
from uuid import UUID
import secrets
from urllib.parse import urlsplit

import httpx
import fitz

from acceptance.isolation import AttachedDatabase, TABLES, SafetyError


def require(response, status):
    if response.status_code != status:
        raise SafetyError(f"Synthetic workflow refused (HTTP {response.status_code})")
    return response.json() if response.content else None


def seed(base, destination):
    from app.models.community import Community
    from app.models.module import Module
    from app.models.user import User
    from app.services.provisioning import appoint_delegate
    resource = AttachedDatabase()
    actors, clients = {}, {}
    try:
        parsed = urlsplit(base)
        if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or parsed.port is None or base != os.environ['IRM_ACCEPTANCE_API']:
            raise SafetyError('Synthetic workflow server target refused')
        with httpx.Client(base_url=base, trust_env=False, timeout=10) as probe:
            identity = require(probe.get('/__acceptance__/identity', headers={'X-Acceptance-Run': resource.lease.run_id}), 200)
        if not identity['same_factory'] or any(identity[label]['schema'] != resource.lease.schema for label in ['rest', 'websocket']):
            raise SafetyError('Synthetic workflow server isolation refused')
        with resource.factory() as db:
            resource.truncate(db, sorted(TABLES))
            communities = [Community(name="Synthetic IRM", slug="irm"), Community(name="Synthetic foreign", slug="foreign")]
            db.add_all(communities)
            db.flush()
            db.add(Module(name="Synthetic module", slug="acceptance", community_id=communities[0].id))
            db.commit()
        suffix = resource.lease.run_id[:8]
        for role in ["delegate", "member", "moderator", "remove_target", "ban_target", "foreign_delegate", "foreign_member", "long_member"]:
            client = httpx.Client(base_url=base, timeout=20, trust_env=False)
            clients[role] = client
            username = ("long_" + "x" * 36 + suffix) if role == "long_member" else f"acc_{role}_{suffix}"
            password = secrets.token_urlsafe(24)
            actor = require(client.post("/api/v1/auth/register", json={"username": username, "email": f"{username}@example.com", "password": password, "first_name": "Synthetic", "family_name": "Acceptance"}), 201)
            require(client.post("/api/v1/auth/login", json={"email": actor["email"], "password": password}), 200)
            actors[role] = {"id": actor["id"], "username": username, "email": actor["email"], "password": password}
        for role, slug in [("delegate", "irm"), ("foreign_delegate", "foreign")]:
            with resource.factory() as db:
                resource.verify_session(db)
                account = db.get(User, UUID(actors[role]["id"]))
                if account.username != actors[role]["username"] or not account.username.startswith("acc_"):
                    raise SafetyError("Synthetic Delegate appointment refused")
                success, _ = appoint_delegate(db, slug, str(account.id), cne=f"ACC_{role}_{suffix}", apply=True)
                if not success:
                    raise SafetyError("Supported Delegate appointment failed")
        for role in actors:
            slug = "foreign" if role.startswith("foreign") else "irm"
            if "delegate" not in role:
                request = require(clients[role].post(f"/api/v1/communities/{slug}/membership", json={"cne": f"ACC_{role}_{suffix}"}), 201)
                leader = clients["foreign_delegate" if slug == "foreign" else "delegate"]
                require(leader.post(f"/api/v1/communities/{slug}/membership/{request['id']}/approve"), 200)
            membership = require(clients[role].get(f"/api/v1/communities/{slug}/membership/me"), 200)["membership"]
            actors[role]["membership_id"] = membership["id"]
        for role in ["moderator", "remove_target", "ban_target"]:
            mid = actors[role]["membership_id"]
            require(clients["delegate"].patch(f"/api/v1/communities/irm/membership/{mid}/role", json={"role": "MODERATOR"}), 200)
            require(clients["delegate"].patch(f"/api/v1/communities/irm/membership/{mid}/permissions", json={"upload_official_documents": True, "create_announcements": True, "manage_document_voting": True}), 200)
        for role in ['remove_target', 'ban_target']:
            with fitz.open() as document:
                document.new_page().insert_text((72, 72), 'Synthetic acceptance document')
                pdf = document.tobytes()
            upload = require(clients[role].post('/api/v1/communities/irm/modules/acceptance/documents',
                data={'title': 'Synthetic preservation '+role, 'type': 'OTHER', 'source': 'OFFICIAL'},
                files={'file': ('synthetic.pdf', pdf, 'application/pdf')}), 201)
            actors[role]['document_id'] = upload['id']
        manifest = {"api": base, "frontend": os.environ["FRONTEND_URL"], "run_id": resource.lease.run_id, "actors": actors}
        descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            json.dump(manifest, stream)
    finally:
        for client in clients.values():
            client.close()
        resource.close()
