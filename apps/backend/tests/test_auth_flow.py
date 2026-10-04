"""OAuth application-flow boundaries with successful synthetic provider adapters.

Signed browser sessions, CSRF, routes and identity persistence are real. These
tests do not replace live provider state/PKCE/signature verification evidence.
"""
from urllib.parse import parse_qs, urlencode, urlsplit
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import httpx
import pytest
from authlib.integrations.base_client.errors import OAuthError
from sqlalchemy import select
from starlette.responses import RedirectResponse

from conftest import web_headers
from wikimf.articles import APIError
from wikimf.auth import identify
from wikimf.db import Identity


class SuccessfulProvider:
    def __init__(self, provider, subject):
        self.provider = provider
        self.subject = subject
        self.verified = 0

    async def authorize_redirect(self, request, redirect_uri, **kwargs):
        state = kwargs.get("state") or uuid4().hex
        states = dict(request.session.get("fixture_external_states", {}))
        states[state] = self.provider
        request.session["fixture_external_states"] = states
        return RedirectResponse("https://provider.invalid/authorize?" + urlencode({"state": state}))

    async def authorize_access_token(self, request):
        state = request.query_params.get("state")
        states = dict(request.session.get("fixture_external_states", {}))
        if states.pop(state, None) != self.provider:
            raise OAuthError("invalid_fixture_provider_state")
        request.session["fixture_external_states"] = states
        self.verified += 1
        if self.provider == "google":
            return {"userinfo": {"sub": self.subject, "name": "Authenticated Google fixture"}}
        return {"access_token": "synthetic-provider-token"}

    async def get(self, path, **kwargs):
        return httpx.Response(200, json={"id": int(self.subject), "login": "github-fixture"},
                              request=httpx.Request("GET", "https://provider.invalid/user"))


@pytest.fixture
def providers(env, monkeypatch):
    app, client, ids = env
    adapters = {"google": SuccessfulProvider("google", "new-google-" + uuid4().hex),
                "github": SuccessfulProvider("github", "424242")}
    monkeypatch.setattr(app.state.oauth, "create_client", lambda provider: adapters.get(provider))
    return adapters


def start(client, path):
    response = client.get(path, follow_redirects=False)
    assert response.status_code in (302, 307)
    state = parse_qs(urlsplit(response.headers["location"]).query)["state"][0]
    return state


def callback(client, provider, state):
    return client.get(f"/api/v1/auth/{provider}/callback", params={"state": state, "code": "synthetic"},
                      follow_redirects=False)


def identity_providers(app, user_id):
    with app.state.sessions() as db:
        return sorted(row.provider for row in db.scalars(select(Identity).where(Identity.user_id == user_id)))


def test_abandoned_github_link_does_not_attach_normal_google_login(env, providers):
    app, client, ids = env
    link = client.post("/api/v1/me/identities/github/link", headers=web_headers(ids))
    assert link.status_code == 200
    state = start(client, "/api/v1/auth/google/start?return_to=/app/library?wiki=jawiki")
    completed = callback(client, "google", state)
    assert completed.status_code == 303
    assert completed.headers["location"].endswith("/app/library?wiki=jawiki")
    assert providers["google"].verified == 1
    assert client.get("/api/v1/me").json()["user_id"] != ids["user_id"]
    assert identity_providers(app, ids["user_id"]) == ["google"]


def test_explicit_link_nonce_cannot_be_used_for_another_provider(env, providers):
    app, client, ids = env
    link = client.post("/api/v1/me/identities/github/link", headers=web_headers(ids)).json()
    target = urlsplit(link["authorization_url"])
    assert "link" in parse_qs(target.query), "explicit link intent must accompany this start"
    wrong_provider = "/api/v1/auth/google/start?" + target.query
    rejected = client.get(wrong_provider, follow_redirects=False)
    assert rejected.status_code in (400, 403)
    assert providers["google"].verified == 0
    assert identity_providers(app, ids["user_id"]) == ["google"]
    assert client.get("/api/v1/me").json()["user_id"] == ids["user_id"]


def test_explicit_github_link_attaches_only_requested_provider(env, providers):
    app, client, ids = env
    link = client.post("/api/v1/me/identities/github/link", headers=web_headers(ids)).json()
    target = urlsplit(link["authorization_url"])
    state = start(client, target.path + "?" + target.query)
    completed = callback(client, "github", state)
    assert completed.status_code == 303
    assert providers["github"].verified == 1
    assert client.get("/api/v1/me").json()["user_id"] == ids["user_id"]
    assert identity_providers(app, ids["user_id"]) == ["github", "google"]
    replay = callback(client, "github", state)
    assert replay.status_code == 400
    assert providers["github"].verified == 1


def test_normal_oauth_flows_keep_own_provider_state_and_return_path(env, providers):
    app, client, ids = env
    google_state = start(client, "/api/v1/auth/google/start?return_to=/app/library?state=completed")
    github_state = start(client, "/api/v1/auth/github/start?return_to=/app/activity?source=chrome_extension")
    wrong = callback(client, "github", google_state)
    assert wrong.status_code == 400
    assert providers["github"].verified == 0
    completed = callback(client, "github", github_state)
    assert completed.status_code == 303
    assert completed.headers["location"].endswith("/app/activity?source=chrome_extension")
    assert providers["github"].verified == 1
    new_user = client.get("/api/v1/me").json()["user_id"]
    assert new_user != ids["user_id"]
    assert identity_providers(app, ids["user_id"]) == ["google"]
    assert identity_providers(app, new_user) == ["github"]


def test_concurrent_normal_callbacks_use_their_own_return_paths(env, providers):
    app, client, ids = env
    google_state = start(client, "/api/v1/auth/google/start?return_to=/app/library?state=completed")
    github_state = start(client, "/api/v1/auth/github/start?return_to=/app/activity?source=chrome_extension")
    google_completed = callback(client, "google", google_state)
    assert google_completed.status_code == 303
    assert google_completed.headers["location"].endswith("/app/library?state=completed")
    google_user = client.get("/api/v1/me").json()["user_id"]
    github_completed = callback(client, "github", github_state)
    assert github_completed.status_code == 303
    assert github_completed.headers["location"].endswith("/app/activity?source=chrome_extension")
    github_user = client.get("/api/v1/me").json()["user_id"]
    assert len({ids["user_id"], google_user, github_user}) == 3
    assert providers["google"].verified == providers["github"].verified == 1
    assert identity_providers(app, ids["user_id"]) == ["google"]
    assert identity_providers(app, google_user) == ["google"]
    assert identity_providers(app, github_user) == ["github"]


def test_existing_provider_link_is_rejected_and_same_identity_is_idempotent(env, providers):
    app, client, ids = env
    rejected = client.post("/api/v1/me/identities/google/link", headers=web_headers(ids))
    assert rejected.status_code == 409
    assert rejected.json()["error"]["code"] == "provider_already_linked"
    with app.state.sessions() as db:
        same = identify(db, "google", "fixture-google", "Fixture", ids["user_id"])
        assert same.id == ids["user_id"]
        with pytest.raises(APIError) as failure:
            identify(db, "google", "another-google-account", "Fixture", ids["user_id"])
        assert failure.value.code == "provider_already_linked"
        db.commit()
    assert identity_providers(app, ids["user_id"]) == ["google"]
    assert providers["google"].verified == 0


def test_second_inflight_link_cannot_add_another_subject_for_provider(env, providers):
    app, client, ids = env
    states = []
    for _ in range(2):
        link = client.post("/api/v1/me/identities/github/link", headers=web_headers(ids))
        assert link.status_code == 200
        target = urlsplit(link.json()["authorization_url"])
        states.append(start(client, target.path + "?" + target.query))
    assert callback(client, "github", states[0]).status_code == 303
    providers["github"].subject = "424243"
    rejected = callback(client, "github", states[1])
    assert rejected.status_code == 403
    assert rejected.json()["error"]["code"] == "identity_link_session_changed"
    assert providers["github"].verified == 2
    assert client.get("/api/v1/me").json()["user_id"] == ids["user_id"]
    assert identity_providers(app, ids["user_id"]) == ["github", "google"]


def test_unlink_removes_legacy_provider_duplicates_but_keeps_a_login_method(env):
    app, client, ids = env
    with app.state.sessions() as db:
        db.add(Identity(user_id=ids["user_id"], provider="google", subject="legacy-second-google"))
        db.commit()
    rejected = client.delete("/api/v1/me/identities/google", headers=web_headers(ids))
    assert rejected.status_code == 409
    assert rejected.json()["error"]["code"] == "last_identity"
    assert identity_providers(app, ids["user_id"]) == ["google", "google"]
    with app.state.sessions() as db:
        identify(db, "github", "other-login", "Fixture", ids["user_id"])
        db.commit()
    removed = client.delete("/api/v1/me/identities/google", headers=web_headers(ids))
    assert removed.status_code == 200
    assert identity_providers(app, ids["user_id"]) == ["github"]
    assert client.delete("/api/v1/me/identities/github", headers=web_headers(ids)).status_code == 409


def test_postgres_parallel_provider_links_are_serialized(env):
    app, client, ids = env
    if app.state.engine.dialect.name != "postgresql":
        pytest.skip("requires PostgreSQL row locks")
    ready = Barrier(2)

    def attempt(subject):
        with app.state.sessions() as db:
            ready.wait(timeout=10)
            try:
                identify(db, "github", subject, "Parallel fixture", ids["user_id"])
                db.commit()
                return "linked"
            except APIError as failure:
                db.rollback()
                return failure.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(attempt, ["parallel-first", "parallel-second"]))
    assert sorted(outcomes) == ["linked", "provider_already_linked"]
    assert identity_providers(app, ids["user_id"]) == ["github", "google"]
