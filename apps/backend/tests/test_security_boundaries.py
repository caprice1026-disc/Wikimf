"""Issue #14/#18 boundaries; synthetic OAuth adapters are not live-provider proof."""
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import select

from conftest import web_headers
from test_auth_flow import providers, start, callback
from wikimf.auth import digest, identify, issue_web_session
from wikimf.db import DeviceLink, Identity, User, WebSession, now


def age_session(app, ids, minutes=11):
    with app.state.sessions() as db:
        row = db.get(WebSession, digest(ids["web_secret"]))
        row.authenticated_at = now() - timedelta(minutes=minutes)
        db.commit()


def reauth(client, ids, provider="google", return_to="/app/settings/account"):
    response = client.post(f"/api/v1/auth/{provider}/reauthenticate", params={"return_to":return_to}, headers=web_headers(ids))
    assert response.status_code == 200, response.text
    target = urlsplit(response.json()["authorization_url"])
    return start(client, target.path + "?" + target.query)


def test_pair_code_only_returned_to_original_device(env):
    app, client, ids = env
    grant = client.post("/api/v1/device-links", json={"source":"android_reader", "display_name":"Phone"}).json()
    assert len(grant["user_code"]) == 8
    path = "/api/v1/device-links/" + grant["link_id"]
    web = client.get(path)
    assert web.status_code == 200
    assert "user_code" not in web.json() and grant["user_code"] not in web.text
    with app.state.sessions() as db:
        row = db.get(DeviceLink, grant["link_id"])
        assert not hasattr(row, "user_code")
        assert grant["user_code"] not in row.user_code_hash
        assert row.user_code_hash != digest(grant["user_code"]), "short codes need a salt and slow hash"
    wrong = "00000000" if grant["user_code"] != "00000000" else "11111111"
    assert client.post(path+"/approve", json={"user_code":wrong}, headers=web_headers(ids)).status_code == 400
    with app.state.sessions() as db:
        assert db.get(DeviceLink, grant["link_id"]).attempts == 1
    assert client.post(path+"/approve", json={"user_code":grant["user_code"].lower()}, headers=web_headers(ids)).status_code == 200
    assert client.post(path+"/exchange", json={"device_secret":grant["device_secret"]}).status_code == 200


@pytest.mark.parametrize("method,path,body", [
    ("DELETE", "/me", {"confirmation":"DELETE"}),
    ("DELETE", "/me/history", None),
    ("DELETE", "/me/identities/google", None),
    ("POST", "/me/identities/github/link", None),
    ("PATCH", "/me/privacy", {"profile_public":True}),
    ("PATCH", "/me/privacy", {"publish_total_time":True}),
    ("PATCH", "/me/privacy", {"publish_achievements":True}),
])
def test_old_session_cannot_perform_sensitive_operation(env, providers, method, path, body):
    app, client, ids = env
    age_session(app, ids)
    response = client.request(method, "/api/v1"+path, json=body, headers=web_headers(ids))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "reauthentication_required"
    with app.state.sessions() as db:
        assert db.get(User, ids["user_id"]) is not None


def test_old_session_can_disable_publication_and_collection(env):
    app, client, ids = env
    age_session(app, ids)
    response = client.patch("/api/v1/me/privacy", json={"profile_public":False,"collection_enabled":False}, headers=web_headers(ids))
    assert response.status_code == 200


def test_reauth_same_identity_rotates_session_and_still_requires_csrf(env, providers):
    app, client, ids = env
    age_session(app, ids)
    providers["google"].subject = "fixture-google"
    assert client.post("/api/v1/auth/google/reauthenticate").json()["error"]["code"] == "csrf_failed"
    state = reauth(client, ids, return_to="/app/settings/privacy?tab=data")
    done = callback(client, "google", state)
    assert done.status_code == 303
    assert "/app/settings/privacy?tab=data&reauthenticated=1" in done.headers["location"]
    me = client.get("/api/v1/me").json()
    assert me["user_id"] == ids["user_id"] and me["recent_auth_until"]
    assert me["csrf_token"] != ids["csrf"]
    with app.state.sessions() as db:
        assert db.get(WebSession, digest(ids["web_secret"])) is None
    assert client.request("DELETE", "/api/v1/me", json={"confirmation":"DELETE"}).json()["error"]["code"] == "csrf_failed"
    assert client.request("DELETE", "/api/v1/me", json={"confirmation":"DELETE"}, headers={"X-CSRF-Token":me["csrf_token"]}).status_code == 200


def test_reauth_different_subject_never_switches_or_creates_user(env, providers):
    app, client, ids = env
    age_session(app, ids)
    state = reauth(client, ids)
    response = callback(client, "google", state)
    assert "reauth_error=reauthentication_identity_mismatch" in response.headers["location"]
    assert client.get("/api/v1/me").json()["user_id"] == ids["user_id"]
    assert client.delete("/api/v1/me/history", headers=web_headers(ids)).status_code == 403
    with app.state.sessions() as db:
        assert len(list(db.scalars(select(User)))) == 1


def test_reauth_is_bound_to_original_session_even_for_same_user(env, providers):
    app, client, ids = env
    providers["google"].subject = "fixture-google"
    state = reauth(client, ids)
    with app.state.sessions() as db:
        other, row = issue_web_session(db, ids["user_id"])
        row.authenticated_at = None
        db.commit()
    # Preserve the OAuth state cookie while replacing the authenticated session.
    client.cookies.set("wikimf_session", other)
    response = callback(client, "google", state)
    assert "reauth_error=reauthentication_session_changed" in response.headers["location"]
    assert client.get("/api/v1/me").json()["recent_auth_until"] is None


def test_reauth_unlinked_provider_and_external_return_rejected(env, providers):
    app, client, ids = env
    assert client.post("/api/v1/auth/github/reauthenticate", headers=web_headers(ids)).status_code == 404
    assert client.post("/api/v1/auth/google/reauthenticate", params={"return_to":"https://evil.invalid/app"}, headers=web_headers(ids)).status_code == 400


def test_reauth_cancel_does_not_refresh_session(env, providers):
    app, client, ids = env
    age_session(app, ids)
    state = reauth(client, ids)
    response = client.get("/api/v1/auth/google/callback", params={"state":state,"error":"access_denied"}, follow_redirects=False)
    assert "reauth_error=reauthentication_cancelled" in response.headers["location"]
    assert client.delete("/api/v1/me/history", headers=web_headers(ids)).status_code == 403


def test_identity_link_cannot_refresh_old_session_or_outlive_recent_auth(env, providers):
    app, client, ids = env
    target = urlsplit(client.post("/api/v1/me/identities/github/link", headers=web_headers(ids)).json()["authorization_url"])
    state = start(client, target.path+"?"+target.query)
    age_session(app, ids)
    assert callback(client, "github", state).json()["error"]["code"] == "reauthentication_required"
    with app.state.sessions() as db:
        assert [i.provider for i in db.scalars(select(Identity))] == ["google"]


def test_identity_link_preserves_original_recent_auth_deadline(env, providers):
    app, client, ids = env
    age_session(app, ids, minutes=9)
    before = client.get("/api/v1/me").json()["recent_auth_until"]
    target = urlsplit(client.post("/api/v1/me/identities/github/link", headers=web_headers(ids)).json()["authorization_url"])
    state = start(client, target.path+"?"+target.query)
    assert callback(client, "github", state).status_code == 303
    assert client.get("/api/v1/me").json()["recent_auth_until"] == before


def test_wrong_pair_code_exhaustion_expires_even_correct_code(env):
    app, client, ids = env
    grant = client.post("/api/v1/device-links", json={"source":"chrome_extension","display_name":"PC"}).json()
    path = "/api/v1/device-links/"+grant["link_id"]+"/approve"
    wrong = "00000000" if grant["user_code"] != "00000000" else "11111111"
    for _ in range(5):
        assert client.post(path, json={"user_code":wrong}, headers=web_headers(ids)).status_code == 400
    assert client.post(path, json={"user_code":grant["user_code"]}, headers=web_headers(ids)).status_code == 410
