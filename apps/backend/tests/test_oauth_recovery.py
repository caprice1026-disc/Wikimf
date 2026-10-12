"""Issue #30: real application/session routes with synthetic providers, not live OAuth proof."""
import json
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from authlib.integrations.base_client.errors import OAuthError
from sqlalchemy import select

from test_auth_flow import callback, providers, start
from wikimf.auth import COOKIE
from wikimf.db import DeviceLink, Identity, User, WebSession


def snapshot(app):
    with app.state.sessions() as db:
        return {model.__tablename__: sorted([tuple(row) for row in db.execute(select(model.__table__))], key=repr)
                for model in (User, Identity, WebSession, DeviceLink)}


@pytest.mark.parametrize('provider', ['google', 'github'])
@pytest.mark.parametrize('logged_in', [False, True])
@pytest.mark.parametrize('failure', ['denied', 'oauth', 'http', 'identity'])
def test_regular_login_recovers_without_mutating_identity_or_session(env, providers, monkeypatch, provider, logged_in, failure):
    app, client, ids = env
    if not logged_in:
        client.cookies.delete(COOKIE)
    target = '/link-device/12345678-1234-4234-8234-123456789abc?source=android'
    state = start(client, '/api/v1/auth/'+provider+'/start?return_to='+target)
    before = snapshot(app)
    adapter = providers[provider]
    original = adapter.authorize_access_token
    async def failed(request):
        if failure == 'denied':
            raise OAuthError('access_denied')
        if failure == 'oauth':
            raise OAuthError('provider_failure', description='sensitive provider details')
        if failure == 'http':
            raise httpx.ConnectError('sensitive connection detail')
        return {'userinfo': {}} if provider == 'google' else {'access_token':'synthetic'}
    monkeypatch.setattr(adapter, 'authorize_access_token', failed)
    if failure == 'identity' and provider == 'github':
        async def invalid(*args, **kwargs):
            return httpx.Response(200, json={'id':'invalid'}, request=httpx.Request('GET','https://provider.invalid/user'))
        monkeypatch.setattr(adapter, 'get', invalid)
    params = {'state':state,'code':'synthetic-private-code','returnTo':'https://evil.invalid/app','error_description':'sensitive details'}
    if failure == 'denied':
        params['error']='access_denied'
    response = client.get('/api/v1/auth/'+provider+'/callback',params=params,follow_redirects=False)
    assert response.status_code == 303
    destination = urlsplit(response.headers['location'])
    configured=urlsplit(client.get('/api/v1/config').json()['dashboard_url'])
    assert (destination.scheme,destination.netloc)==(configured.scheme,configured.netloc)
    assert destination.path == '/login'
    query = parse_qs(destination.query)
    assert query == {'error':['oauth_cancelled' if failure=='denied' else 'oauth_failed'], 'returnTo':[target]}
    assert not any(x in response.headers['location'] for x in ('sensitive','synthetic-private-code',state,'evil.invalid'))
    assert response.headers['cache-control'] == 'no-store'
    assert response.headers['referrer-policy'] == 'no-referrer'
    assert snapshot(app) == before
    assert client.get('/api/v1/me').status_code == (200 if logged_in else 401)
    assert callback(client, provider, state).status_code == 400
    monkeypatch.setattr(adapter, 'authorize_access_token', original)
    if failure == 'identity' and provider == 'github':
        from test_auth_flow import SuccessfulProvider
        monkeypatch.setattr(adapter,'get',SuccessfulProvider.get.__get__(adapter))
    retry = start(client, '/api/v1/auth/'+provider+'/start?return_to='+target)
    assert retry != state
    assert callback(client,provider,retry).headers['location'].endswith(target)


@pytest.mark.parametrize('target',['/app','/app/library?wiki=jawiki','/home'])
def test_recovery_preserves_only_the_verified_flow_return(env, providers, target):
    _,client,_=env
    state=start(client,'/api/v1/auth/google/start?return_to='+target)
    result=client.get('/api/v1/auth/google/callback',params={'state':state,'error':'access_denied','return_to':'//evil.invalid'},follow_redirects=False)
    assert parse_qs(urlsplit(result.headers['location']).query)['returnTo']==[target]


@pytest.mark.parametrize('kind',['missing','wrong','provider','expired'])
def test_untrusted_or_expired_flow_does_not_become_a_recovery_redirect(env, providers, monkeypatch, kind):
    import time
    from types import SimpleNamespace
    app,client,_=env
    state=start(client,'/api/v1/auth/google/start?return_to=/app')
    before=snapshot(app)
    if kind=='expired':monkeypatch.setattr('wikimf.main.time',SimpleNamespace(time=lambda:time.time()+601))
    params={'error':'access_denied','returnTo':'https://evil.invalid/app'}
    if kind!='missing':params['state']='invalid' if kind=='wrong' else state
    provider='github' if kind=='provider' else 'google'
    response=client.get('/api/v1/auth/'+provider+'/callback',params=params,follow_redirects=False)
    assert response.status_code==400 and 'location' not in response.headers
    assert response.json()['error']['code']=='oauth_invalid_state'
    assert snapshot(app)==before


def test_cancelled_flow_clears_authlib_state_and_keeps_other_flows(env, providers):
    from authlib.integrations.starlette_client.integration import StarletteIntegration
    _,client,_=env
    adapter=providers['google'];original=adapter.authorize_redirect
    async def redirect(request,uri,**kwargs):
        result=await original(request,uri,**kwargs)
        request.session['_state_google_'+kwargs['state']]={'data':{'code_verifier':'synthetic'},'exp':9999999999}
        return result
    adapter.authorize_redirect=redirect;adapter.framework=StarletteIntegration('google')
    first=start(client,'/api/v1/auth/google/start?return_to=/app')
    second=start(client,'/api/v1/auth/google/start?return_to=/app/library')
    result=client.get('/api/v1/auth/google/callback',params={'state':first,'error':'access_denied'},follow_redirects=False)
    assert result.status_code==303
    import base64,json
    from itsdangerous import TimestampSigner
    config=next(m.kwargs for m in client.app.user_middleware if m.cls.__name__=='SessionMiddleware')
    session=json.loads(base64.b64decode(TimestampSigner(config['secret_key']).unsign(client.cookies.get(config['session_cookie']))))
    assert '_state_google_'+first not in session and '_state_google_'+second in session
    # A separate in-flight flow remains usable, with its own trusted return.
    assert callback(client,'google',second).headers['location'].endswith('/app/library')


@pytest.mark.parametrize('provider', ['google', 'github'])
@pytest.mark.parametrize('info', [None, [], 'invalid'])
def test_malformed_provider_profile_recovers_without_server_error(env, providers, monkeypatch, provider, info):
    app,client,_=env
    state=start(client,'/api/v1/auth/'+provider+'/start?return_to=/app')
    before=snapshot(app)
    adapter=providers[provider]
    if provider=='google':
        async def grant(request):return {'userinfo':info}
        monkeypatch.setattr(adapter,'authorize_access_token',grant)
    else:
        async def profile(*args,**kwargs):return httpx.Response(200,content=json.dumps(info),request=httpx.Request('GET','https://provider.invalid/user'))
        monkeypatch.setattr(adapter,'get',profile)
    result=callback(client,provider,state)
    assert result.status_code==303
    assert parse_qs(urlsplit(result.headers['location']).query)=={'error':['oauth_failed'],'returnTo':['/app']}
    assert snapshot(app)==before
