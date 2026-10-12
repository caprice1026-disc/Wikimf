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
    parser.add_argument('--expected-certificate', help='Required stable signer SHA256 for distributable local builds')
    parser.add_argument('--previous-apk', type=Path, help='Verify same-signature increasing-version update compatibility')
    parser.add_argument('--variant', choices=['lan','lanLocal'], default='lan')
    args = parser.parse_args()
    tools = args.sdk/'build-tools/35.0.0'
    suffix = '.exe' if os.name == 'nt' else ''
    def manifest(apk):
        return subprocess.check_output([str(tools/('aapt2'+suffix)), 'dump', 'xmltree', str(apk), '--file', 'AndroidManifest.xml'], text=True, encoding='utf-8')
    lan = ROOT/f'apps/android/app/build/outputs/apk/{args.variant}/app-{args.variant}.apk'
    expected_id = 'org.wikimf.reader.lan.local' if args.variant=='lanLocal' else 'org.wikimf.reader.lan'
    release = ROOT/'apps/android/app/build/outputs/apk/release/app-release-unsigned.apk'
    if not release.exists():
        release = release.with_name('app-release.apk')
    lan_xml, release_xml = manifest(lan), manifest(release)
    assert expected_id in lan_xml
    assert ':usesCleartextTraffic' in lan_xml and re.search(r':usesCleartextTraffic\([^)]*\)=true', lan_xml)
    assert not re.search(r':debuggable\([^)]*\)=true', lan_xml)
    assert ':networkSecurityConfig' in lan_xml
    assert 'org.wikimf.reader.lan' not in release_xml
    assert re.search(r':usesCleartextTraffic\([^)]*\)=false', release_xml)
    assert not re.search(r':debuggable\([^)]*\)=true', release_xml)
    assert ':networkSecurityConfig' not in release_xml
    signer = subprocess.check_output([str(tools/('apksigner.bat' if os.name=='nt' else 'apksigner')), 'verify', '--verbose', '--print-certs', str(lan)], text=True)
    certificate = re.search(r'certificate SHA-256 digest: ([0-9a-f]+)', signer).group(1)
    badging = subprocess.check_output([str(tools/('aapt2'+suffix)), 'dump', 'badging', str(lan)], text=True, encoding='utf-8')
    version = re.search(r"versionName='([^']+)'", badging).group(1)
    code = int(re.search(r"versionCode='(\d+)'", badging).group(1))
    if args.expected_certificate:
        assert certificate == args.expected_certificate.lower(), 'Stable signing certificate changed; do not distribute as an update'
    compatibility = 'not_checked'
    if args.previous_apk:
        previous = subprocess.check_output([str(tools/('apksigner.bat' if os.name=='nt' else 'apksigner')), 'verify', '--print-certs', str(args.previous_apk)], text=True)
        previous_cert = re.search(r'certificate SHA-256 digest: ([0-9a-f]+)', previous).group(1)
        previous_badging = subprocess.check_output([str(tools/('aapt2'+suffix)), 'dump', 'badging', str(args.previous_apk)], text=True, encoding='utf-8')
        assert re.search(r"package: name='([^']+)'", previous_badging).group(1)==expected_id
        assert certificate == previous_cert, 'Previous APK signature differs; preserve installed app, never uninstall to bypass this'
        assert code > int(re.search(r"versionCode='(\d+)'", previous_badging).group(1)), 'Update versionCode must increase'
        compatibility = 'same_signature_increasing_version'
    commit = subprocess.check_output(['git', '-c', 'safe.directory='+ROOT.as_posix(), 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    evidence = {'source_commit':commit, 'application_id':expected_id, 'version':version, 'version_code':code, 'debuggable':False,
                'distribution':'stable_local_validation' if args.expected_certificate else 'ci_or_local_test_only',
                'update_compatibility':compatibility,
                'lan_http':True, 'release_https_boundary':'passed', 'signature':'verified',
                'apk_sha256':hashlib.sha256(lan.read_bytes()).hexdigest(), 'certificate_sha256':certificate}
    output = ROOT/('.tmp/lan-local-apk-manifest.json' if args.variant=='lanLocal' else '.tmp/lan-apk-manifest.json')
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(evidence, indent=2)+'\n')
    print(json.dumps(evidence, indent=2))


if __name__ == '__main__':
    main()
