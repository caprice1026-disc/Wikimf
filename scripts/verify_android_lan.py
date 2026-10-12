"""Inspect the actual APKs: isolated LAN ID/signature and unchanged release boundary."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', type=Path, default=Path(os.getenv('ANDROID_HOME', str(ROOT/'apps/android/.tooling/sdk'))))
    args = parser.parse_args()
    tools = args.sdk/'build-tools/35.0.0'
    suffix = '.exe' if os.name == 'nt' else ''
    def manifest(apk):
        return subprocess.check_output([str(tools/('aapt2'+suffix)), 'dump', 'xmltree', str(apk), '--file', 'AndroidManifest.xml'], text=True, encoding='utf-8')
    lan = ROOT/'apps/android/app/build/outputs/apk/lan/app-lan.apk'
    release = ROOT/'apps/android/app/build/outputs/apk/release/app-release-unsigned.apk'
    if not release.exists():
        release = release.with_name('app-release.apk')
    lan_xml, release_xml = manifest(lan), manifest(release)
    assert 'org.wikimf.reader.lan' in lan_xml
    assert ':usesCleartextTraffic' in lan_xml and re.search(r':usesCleartextTraffic\([^)]*\)=true', lan_xml)
    assert not re.search(r':debuggable\([^)]*\)=true', lan_xml)
    assert ':networkSecurityConfig' in lan_xml
    assert 'org.wikimf.reader.lan' not in release_xml
    assert re.search(r':usesCleartextTraffic\([^)]*\)=false', release_xml)
    assert not re.search(r':debuggable\([^)]*\)=true', release_xml)
    assert ':networkSecurityConfig' not in release_xml
    signer = subprocess.check_output([str(tools/('apksigner.bat' if os.name=='nt' else 'apksigner')), 'verify', '--verbose', '--print-certs', str(lan)], text=True)
    certificate = re.search(r'certificate SHA-256 digest: ([0-9a-f]+)', signer).group(1)
    evidence = {'application_id':'org.wikimf.reader.lan', 'version':'0.1.1-lan', 'debuggable':False,
                'lan_http':True, 'release_https_boundary':'passed', 'signature':'verified',
                'apk_sha256':hashlib.sha256(lan.read_bytes()).hexdigest(), 'certificate_sha256':certificate}
    output = ROOT/'.tmp/lan-apk-manifest.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(evidence, indent=2)+'\n')
    print(json.dumps(evidence, indent=2))


if __name__ == '__main__':
    main()
