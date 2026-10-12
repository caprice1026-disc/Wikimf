"""Explicit LAN-only factory and one-use local test login. Never an OAuth substitute."""
import argparse
import ipaddress
import json
import os
import secrets
import threading
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from fastapi import Request
from fastapi.responses import HTMLResponse, RedirectResponse

from .articles import APIError
from .auth import COOKIE, digest, identify, issue_web_session, token
from .db import database, now
from .main import create_app

PRIVATE_NETWORKS = tuple(ipaddress.ip_network(value) for value in (
    '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8'))


def lan_origin():
    if os.getenv('ENVIRONMENT') != 'lan' or os.getenv('LAN_TEST_MODE') != '1':
        raise RuntimeError('LAN test login requires ENVIRONMENT=lan and LAN_TEST_MODE=1')
    origin = os.getenv('API_ORIGIN', '')
    parsed = urlsplit(origin)
    try:
        host = ipaddress.IPv4Address(parsed.hostname or '')
        valid = (any(host in network for network in PRIVATE_NETWORKS)
                 and parsed.scheme == 'http' and not parsed.username and not parsed.password
                 and not parsed.path and not parsed.query and not parsed.fragment
                 and parsed.port in range(1, 65536))
    except ValueError:
        valid = False
    if not valid or origin != os.getenv('DASHBOARD_ORIGIN'):
        raise RuntimeError('LAN requires one explicit private IPv4 HTTP origin with a port')
    if any(os.getenv(key) for key in ('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET')):
        raise RuntimeError('Keep real OAuth credentials out of the LAN test stack')
    return origin


def credential_file():
    return Path(os.getenv('LAN_CREDENTIAL_FILE', '/lan-state/bootstrap.json'))


def require_lan_database(engine):
    if engine.dialect.name != 'postgresql' or engine.url.database != 'wikimf_lan':
        raise RuntimeError('LAN runtime requires its dedicated PostgreSQL database wikimf_lan')


def prepare_login(factory, path):
    """Reuse a dedicated synthetic identity; never switch collection on automatically."""
    with factory() as db:
        user = identify(db, 'lan', 'lan-verification-only', 'LAN 検証ユーザー')
        db.commit()
        user_id = user.id
    secret = token()
    payload = {'token_hash': digest(secret), 'user_id': user_id,
               'expires_at': (now() + timedelta(minutes=15)).isoformat()}
    path.parent.mkdir(parents=True, exist_ok=True)
    # The temporary file and atomic replacement prevent reading half-written state.
    staged = path.with_name(path.name + '.' + secrets.token_hex(8))
    with staged.open('x', encoding='utf-8') as output:
        os.chmod(staged, 0o600)
        json.dump(payload, output)
    staged.replace(path)
    return secret


def create_lan_app(database_url=None, mediawiki=None, login_file=None):
    origin = lan_origin()
    app = create_app(database_url, mediawiki)
    # Explicit injection exists for isolated tests; deployed factory has no arguments.
    if database_url is None:
        require_lan_database(app.state.engine)
    path = Path(login_file) if login_file is not None else credential_file()
    lock = threading.Lock()

    @app.get('/lan-login', response_class=HTMLResponse)
    def login_form():
        return """<!doctype html><html lang="ja"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>wikimf LAN 検証ログイン</title>
<body><main><h1>wikimf LAN 検証</h1><p>専用テストユーザーです。実 OAuth の確認は別に行います。</p>
<p>PC の scripts/lan.ps1 Login が表示する一度限りのトークンを入力してください。有効期限は15分です。</p>
<form method="post" action="/lan-login"><label>ログイントークン <input name="token" type="password" autocomplete="off" required maxlength="100"></label>
<button type="submit">検証ユーザーでログイン</button></form><p>HTTP 接続です。信頼できる同じ LAN でのみ使用してください。</p></main></body></html>"""

    @app.post('/lan-login')
    async def exchange_login(request: Request):
        if request.headers.get('origin') != origin:
            raise APIError('lan_origin_mismatch', 403)
        if request.headers.get('content-type', '').split(';')[0] != 'application/x-www-form-urlencoded':
            raise APIError('invalid_request', 400)
        try:
            form = parse_qs((await request.body()).decode('utf-8'), strict_parsing=True)
            supplied, = form['token']
        except (ValueError, KeyError, UnicodeError):
            raise APIError('invalid_request', 400) from None
        with lock:
            try:
                saved = json.loads(path.read_text(encoding='utf-8'))
                valid = (datetime.fromisoformat(saved['expires_at']) > now()
                         and secrets.compare_digest(digest(supplied), saved['token_hash']))
            except (OSError, ValueError, KeyError):
                valid = False
            if not valid:
                raise APIError('lan_login_invalid_or_expired', 401)
            path.unlink()  # A failed DB operation requires a newly prepared token.
            with app.state.sessions() as db:
                secret, web = issue_web_session(db, saved['user_id'])
                web.expires_at = now() + timedelta(days=1)
                db.commit()
        response = RedirectResponse('/app', status_code=303)
        response.set_cookie(COOKIE, secret, max_age=86400, httponly=True, secure=False, samesite='lax', path='/')
        return response

    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare', action='store_true', required=True)
    parser.add_argument('--json', action='store_true', help='For isolated stack verification; contains a secret')
    args = parser.parse_args()
    origin = lan_origin()
    engine, factory = database()
    try:
        require_lan_database(engine)
        secret = prepare_login(factory, credential_file())
    finally:
        engine.dispose()
    if args.json:
        print(json.dumps({'login_url': origin + '/lan-login', 'token': secret}))
    else:
        print('LAN 検証ログイン: ' + origin + '/lan-login')
        print('一度限りのトークン（15分有効）: ' + secret)
        print('共有・コミットしないでください。端末のブラウザーには新しいトークンを発行できます。')


if __name__ == '__main__':
    main()
