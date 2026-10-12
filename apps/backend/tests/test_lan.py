"""LAN opt-in, one-use browser login, normal pairing/consent and durable event semantics."""
import json
from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from conftest import FixtureWiki, observation
from wikimf.auth import digest
from wikimf.db import Identity, now
from wikimf.lan import create_lan_app, lan_origin, prepare_login, require_lan_database
from wikimf.main import create_app

ORIGIN = 'http://192.168.11.10:8080'


@pytest.fixture
def lan(env, monkeypatch, tmp_path):
    base, _, ids = env
    for name, value in {'ENVIRONMENT':'lan', 'LAN_TEST_MODE':'1', 'API_ORIGIN':ORIGIN, 'DASHBOARD_ORIGIN':ORIGIN}.items():
        monkeypatch.setenv(name, value)
    for name in ('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'):
        monkeypatch.delenv(name, raising=False)
    path = tmp_path / 'bootstrap.json'
    app = create_lan_app(base.state.engine.url.render_as_string(hide_password=False), FixtureWiki(), path)
    with TestClient(app, base_url=ORIGIN) as client:
        yield app, client, path, ids
    app.state.engine.dispose()


def login(app, client, path):
    secret = prepare_login(app.state.sessions, path)
    response = client.post('/lan-login', data={'token':secret}, headers={'Origin':ORIGIN}, follow_redirects=False)
    assert response.status_code == 303 and response.headers['location'] == '/app'
    cookie = response.headers['set-cookie']
    assert 'HttpOnly' in cookie and 'SameSite=lax' in cookie
    assert 'Secure' not in cookie  # LAN only; production does not mount this route.
    return secret, client.get('/api/v1/me').json()


def pair(client, csrf):
    grant = client.post('/api/v1/device-links', json={'source':'android_reader', 'display_name':'LAN phone'}).json()
    assert grant['verification_url'] == ORIGIN + '/link-device/' + grant['link_id']
    path = '/api/v1/device-links/' + grant['link_id']
    assert client.post(path+'/approve', json={'user_code':grant['user_code']}).status_code == 403
    assert client.post(path+'/approve', json={'user_code':grant['user_code']}, headers={'X-CSRF-Token':csrf}).status_code == 200
    response = client.post(path+'/exchange', json={'device_secret':grant['device_secret']})
    assert response.status_code == 200
    assert client.post(path+'/exchange', json={'device_secret':grant['device_secret']}).status_code == 410
    return response.json()


def test_lan_login_is_one_use_and_preserves_explicit_consent(lan):
    app, client, path, _ = lan
    assert client.get('/lan-login').status_code == 200
    assert client.get('/api/v1/me').status_code == 401
    secret, me = login(app, client, path)
    assert me['display_name'] == 'LAN 検証ユーザー' and me['collection_enabled'] is False
    assert not path.exists()
    assert client.post('/lan-login', data={'token':secret}, headers={'Origin':ORIGIN}).status_code == 401
    _, again = login(app, client, path)
    assert again['user_id'] == me['user_id'] and again['collection_enabled'] is False


def test_invalid_expired_replaced_tokens_and_cross_origin_cannot_login(lan):
    app, client, path, _ = lan
    old = prepare_login(app.state.sessions, path)
    fresh = prepare_login(app.state.sessions, path)
    assert old not in path.read_text() and fresh not in path.read_text()
    assert client.post('/lan-login', data={'token':fresh}).status_code == 403
    assert client.post('/lan-login', data={'token':fresh}, headers={'Origin':'http://evil.example'}).status_code == 403
    assert client.post('/lan-login', data={'token':old}, headers={'Origin':ORIGIN}).status_code == 401
    assert path.exists()
    saved = json.loads(path.read_text())
    saved['expires_at'] = (now()-timedelta(seconds=1)).isoformat()
    path.write_text(json.dumps(saved))
    assert client.post('/lan-login', data={'token':fresh}, headers={'Origin':ORIGIN}).status_code == 401
    assert client.get('/api/v1/me').status_code == 401


@pytest.mark.parametrize('origin', [None, 'null', 'http://192.168.11.10',
                                  'http://192.168.11.10:8081', 'http://evil.example'])
def test_form_origin_remains_strict_and_rejection_preserves_token(lan, origin):
    app, client, path, _ = lan
    secret = prepare_login(app.state.sessions, path)
    headers = {} if origin is None else {'Origin': origin}
    response = client.post('/lan-login', data={'token': secret}, headers=headers)
    assert response.status_code == 403
    assert response.json()['error']['code'] == 'lan_origin_mismatch'
    assert path.exists()
    # Neither an opaque origin nor a different host/port can consume a token.
    assert client.post('/lan-login', data={'token': secret}, headers={'Origin': ORIGIN},
                       follow_redirects=False).status_code == 303


def test_lan_pair_sync_retry_duplicate_and_recording_stop(lan):
    app, client, path, fixture = lan
    _, me = login(app, client, path)
    phone = pair(client, me['csrf_token'])
    ids = {**fixture, **phone}
    auth = {'Authorization':'Bearer '+phone['token']}
    web = {'X-CSRF-Token':me['csrf_token']}
    event = observation(ids, source='android_reader')
    def send(item):
        return client.post('/api/v1/reading-events/batch', headers=auth, json={'schema_version':1, 'events':[item]})
    assert send(event).json()['results'][0]['code'] == 'collection_disabled'
    assert client.patch('/api/v1/me/privacy', headers=web, json={'collection_enabled':True, 'consent_version':'privacy-v1'}).status_code == 200
    assert client.get('/api/v1/me/recording-control', headers=auth).json()['collection_enabled'] is True
    assert send(event).json()['results'][0]['status'] == 'accepted'
    before = client.get('/api/v1/me/stats').json()['activity']['active_ms']
    assert before == 10000
    for _ in range(3):
        assert send(event).json()['results'][0]['status'] == 'duplicate'
    assert client.get('/api/v1/me/stats').json()['activity']['active_ms'] == before
    assert client.get('/api/v1/me/articles').json()['items'][0]['article_id'] == fixture['article_id']
    assert client.patch('/api/v1/me/privacy', headers=web, json={'collection_enabled':False}).status_code == 200
    assert client.get('/api/v1/me/recording-control', headers=auth).json()['collection_enabled'] is False
    later = observation(ids, source='android_reader')
    assert send(later).json()['results'][0]['code'] == 'collection_disabled'
    assert client.get('/api/v1/me/stats').json()['activity']['active_ms'] == before
    # New browser login reuses the user and does not undo collection OFF.
    _, again = login(app, client, path)
    assert again['user_id'] == me['user_id'] and again['collection_enabled'] is False
    with app.state.sessions() as db:
        assert db.scalar(select(Identity).where(Identity.provider=='lan')).subject == 'lan-verification-only'


def test_normal_factory_has_no_lan_login_even_when_flag_is_set(env, monkeypatch):
    _, client, _ = env
    monkeypatch.setenv('LAN_TEST_MODE', '1')
    assert client.get('/lan-login').status_code == 404
    assert client.post('/lan-login', data={'token':'anything'}).status_code == 404


def test_production_refuses_lan_opt_in(monkeypatch, tmp_path):
    monkeypatch.setenv('ENVIRONMENT', 'production')
    monkeypatch.setenv('LAN_TEST_MODE', '1')
    with pytest.raises(RuntimeError, match='production must not'):
        create_app('sqlite:///' + str(tmp_path/'production.db'))
    with pytest.raises(RuntimeError, match='ENVIRONMENT=lan'):
        create_lan_app('sqlite:///' + str(tmp_path/'lan.db'))


@pytest.mark.parametrize('origin', ['http://8.8.8.8:8080', 'http://example.com:8080', 'http://169.254.1.1:8080', 'http://192.168.11.10:0', 'http://192.168.11.10:8080/path', 'http://user@192.168.11.10:8080', 'https://192.168.11.10:8080', 'http://192.168.11.10:8080?token=x'])
def test_lan_requires_private_numeric_same_origin(lan, monkeypatch, origin):
    monkeypatch.setenv('API_ORIGIN', origin)
    monkeypatch.setenv('DASHBOARD_ORIGIN', origin)
    with pytest.raises(RuntimeError, match='one explicit'):
        lan_origin()


def test_lan_refuses_real_oauth_and_wrong_database(lan, monkeypatch):
    app, _, _, _ = lan
    monkeypatch.setenv('GOOGLE_CLIENT_ID', 'real-client')
    with pytest.raises(RuntimeError, match='real OAuth'):
        lan_origin()
    with pytest.raises(RuntimeError, match='dedicated PostgreSQL'):
        require_lan_database(SimpleNamespace(dialect=SimpleNamespace(name="postgresql"), url=SimpleNamespace(database="wikimf")))
