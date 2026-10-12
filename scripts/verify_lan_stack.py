"""Start a disposable loopback LAN Compose project; never touch the user's LAN project."""
import http.cookiejar
import json
from pathlib import Path
import re
import secrets
import subprocess
import time
import urllib.parse
import urllib.request
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


def main():
    directory = ROOT/'.tmp'/('lan-stack-'+uuid4().hex[:12])
    directory.mkdir(parents=True)
    env_file = directory/'test.env'
    # Loopback is only for disposable automated acceptance, not the device setup script.
    env_file.write_text('LAN_BIND_IP=127.0.0.1\nLAN_PORT=18080\nLAN_DB_PASSWORD='+secrets.token_hex(32)+'\nLAN_SESSION_SECRET='+secrets.token_hex(32)+'\n')
    project = 'wikimf-lan-ci-'+uuid4().hex[:12]
    command = ['docker','compose','--project-name',project,'--env-file',str(env_file),'-f',str(ROOT/'compose.lan.yaml')]
    log_path = directory/'compose.log'
    def run(*args):
        with log_path.open('a', encoding='utf-8') as log:
            subprocess.run(command+list(args), cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True)
    config = json.loads(subprocess.check_output(command+['config','--format','json'], cwd=ROOT, text=True))
    published = [(name, port) for name, service in config['services'].items() for port in service.get('ports', [])]
    assert len(published)==1 and published[0][0]=='gateway' and published[0][1]['host_ip']=='127.0.0.1'
    assert str(published[0][1]['published'])=='18080' and published[0][1]['target']==8080
    origin = 'http://127.0.0.1:18080'
    cookies = http.cookiejar.CookieJar()
    client = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(cookies))
    def request(path, method='GET', payload=None, headers=None, form=False):
        headers = dict(headers or {})
        data = None
        if payload is not None:
            data = (urllib.parse.urlencode(payload) if form else json.dumps(payload)).encode()
            headers['Content-Type'] = 'application/x-www-form-urlencoded' if form else 'application/json'
        req = urllib.request.Request(origin+path, data=data, method=method, headers=headers)
        with client.open(req, timeout=10) as response:
            raw = response.read().decode()
            return json.loads(raw) if response.headers.get('Content-Type','').startswith('application/json') else raw
    try:
        print('Building and starting isolated LAN stack: '+project, flush=True)
        run('up','-d','--build')
        deadline = time.monotonic()+150
        while True:
            try:
                assert request('/health')['status']=='ok'
                break
            except (OSError, AssertionError):
                if time.monotonic()>deadline:
                    raise RuntimeError('Stack health timed out: '+str(log_path))
                time.sleep(2)
        assert request('/api/v1/config')['dashboard_url']==origin
        for route in ('/','/app','/app/settings/privacy','/link-device/12345678-1234-4234-8234-123456789abc'):
            html = request(route)
            assert '<div id="root">' in html
        for asset in re.findall(r'(?:src|href)="([^"]*/assets/[^\"]+)"', html):
            assert request(asset)
        assert 'LAN' in request('/lan-login')
        # Real native browser POST catches referrer-policy Origin:null regressions.
        with log_path.open('a', encoding='utf-8') as log:
            subprocess.run(['node', str(ROOT/'apps/dashboard/scripts/lan-form-smoke.mjs'), origin],
                           cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True)
        # Capture the one-use secret only in memory, never in acceptance evidence/logs.
        login = json.loads(subprocess.check_output(command+['exec','-T','backend','python','-m','wikimf.lan','--prepare','--json'], cwd=ROOT, text=True))
        request('/lan-login','POST',{'token':login['token']},{'Origin':origin},form=True)
        me = request('/api/v1/me')
        assert me['collection_enabled'] is False
        grant = request('/api/v1/device-links','POST',{'source':'android_reader','display_name':'Disposable LAN transport'})
        assert grant['verification_url']==origin+'/link-device/'+grant['link_id']
        request('/api/v1/device-links/'+grant['link_id']+'/approve','POST',{'user_code':grant['user_code']},{'X-CSRF-Token':me['csrf_token']})
        phone = request('/api/v1/device-links/'+grant['link_id']+'/exchange','POST',{'device_secret':grant['device_secret']})
        control = request('/api/v1/me/recording-control',headers={'Authorization':'Bearer '+phone['token']})
        assert control['user_id']==me['user_id'] and control['collection_enabled'] is False
        # Use PostgreSQL regression tests in isolated schemas for event retry/duplicate/stop.
        run('exec','-T','-e','TEST_DATABASE_URL=postgresql+psycopg://wikimf:'+env_file.read_text().split('LAN_DB_PASSWORD=')[1].splitlines()[0]+'@db:5432/wikimf_lan',
            'backend','python','-m','pytest','-q','-p','no:cacheprovider','apps/backend/tests/test_lan.py')
        evidence = {'project':project,'single_published_port':True,'health':'passed','dashboard_routes_assets':'passed',
                    'same_origin_config':'passed','one_use_login':'passed','normal_device_pairing':'passed',
                    'native_browser_form_origin':'passed',
                    'postgres_lan_retry_duplicate_stop_tests':'passed','adb_used':False,'firewall_changed':False}
        (directory/'results.json').write_text(json.dumps(evidence,indent=2)+'\n')
        print(json.dumps(evidence,indent=2))
        print('Evidence: '+str(directory/'results.json'))
    finally:
        # No --volumes: retain the explicitly isolated test data for investigation.
        run('down')


if __name__ == '__main__':
    main()
