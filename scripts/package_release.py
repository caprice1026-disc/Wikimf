"""Package already verified local development builds with commit and digests."""
import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from zipfile import ZIP_DEFLATED,ZipFile

ROOT=Path(__file__).resolve().parents[1]


def main():
    commit=subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip()
    dirty=subprocess.check_output(["git","status","--porcelain","--","apps","packages","scripts"],cwd=ROOT,text=True)
    if dirty.strip():
        raise SystemExit("Commit verified source files before packaging.")
    sources={"android":"apps/android/app/build/outputs/apk/debug/app-debug.apk","extension":"apps/extension/dist","dashboard":"apps/dashboard/dist"}
    if any(not (ROOT/path).exists() for path in sources.values()):
        raise SystemExit("Build Android, extension and Dashboard first.")
    output=ROOT/"dist"/("0.1.0-"+commit[:12])
    output.mkdir(parents=True,exist_ok=True)
    apk=output/"wikimf-0.1.0-debug.apk"
    shutil.copy2(ROOT/sources["android"],apk)
    artifacts=[apk]
    for kind in ("extension","dashboard"):
        source=ROOT/sources[kind]
        target=output/f"wikimf-0.1.0-{kind}.zip"
        with ZipFile(target,"w",ZIP_DEFLATED) as archive:
            for path in sorted(source.rglob("*")):
                if path.is_file():
                    archive.write(path,path.relative_to(source).as_posix())
        artifacts.append(target)
    manifest={"product":"wikimf","version":"0.1.0","source_commit":commit,"schema_version":1,"measurement_policy_version":"reading-v1","server_policy_version":"reading-v1","extractor_version":"prose-v1",
              "distribution":"closed local verification; debug APK; unpacked Chrome extension; static Dashboard",
              "production_release":False,"signing":"local Android debug key; not a release key",
              "artifacts":[{"file":p.name,"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()} for p in artifacts]}
    (output/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
    (output/"README.txt").write_text("wikimf 0.1.0 閉じたローカル検証用\nAndroid: adb install -r wikimf-0.1.0-debug.apk\nAndroidのAccountでAPIを設定する。エミュレータでは http://10.0.2.2:8000/api/v1、adb reverse使用時は http://localhost:8000/api/v1。初期の example URL は接続先ではない。\nChrome: extension.zip を展開して chrome://extensions の開発者モードで読み込む。API は http://localhost:8000/api/v1。\nDashboard: dashboard.zip を展開し、SPA fallback と /api/v1 proxy を設定する。\nローカルDashboardは localhost:5173。Backendの DASHBOARD_ORIGIN も合わせる。公開配備時は接続先を設定して再buildする。\n実OAuth・HTTPS・実機・release署名はSTで確認する。詳しくは docs/releases/ を参照。\n",encoding="utf-8")
    print(json.dumps({"output":str(output),"source_commit":commit,"artifacts":manifest["artifacts"]}))


if __name__=="__main__":main()
