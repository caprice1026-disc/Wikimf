"""Temporary CP Reader QA linkage; backup/restore encrypted preferences without exposing secrets."""
import json
import hashlib
from pathlib import Path
import subprocess
import sys
import time
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
ADB = [str(ROOT / "apps/android/.tooling/sdk/platform-tools/adb.exe"), "-s", "emulator-5554"]
BACKUP = ROOT / "apps/android/.tooling/reader-original-preferences"
PRIVATE = "/data/user/0/org.wikimf.reader/"


def adb(*args, data=None):
    result = subprocess.run(ADB + list(args), input=data, capture_output=True)
    if result.returncode:
        raise RuntimeError("ADB command failed: " + " ".join(args[:3]))
    return result.stdout


def main():
    adb("shell", "am", "force-stop", "org.wikimf.reader")
    if sys.argv[1] == "restore":
        for name in ("preferences.xml", "encrypted_credentials.xml"):
            data = (BACKUP / name).read_bytes()
            adb("shell", "run-as", "org.wikimf.reader", "sh", "-c", f"'cat > shared_prefs/{name}'", data=data)
            restored = adb("exec-out", "run-as", "org.wikimf.reader", "cat", PRIVATE + "shared_prefs/" + name)
            assert hashlib.sha256(restored).digest() == hashlib.sha256(data).digest(), "Restored preferences must match the original backup"
        (ROOT / "apps/android/verification/emulator-preferences-restored.json").write_text(json.dumps({"original_preferences_hash_matches": True, "original_encrypted_credentials_hash_matches": True, "keystore_key_preserved_without_uninstall": True}, indent=2) + "\n")
        print("Original encrypted Reader preferences restored; app remains stopped")
        return
    assert not BACKUP.exists(), "Restore and archive the existing backup explicitly before preparing again"
    BACKUP.mkdir()
    for name in ("preferences.xml", "encrypted_credentials.xml"):
        (BACKUP / name).write_bytes(adb("exec-out", "run-as", "org.wikimf.reader", "cat", PRIVATE + "shared_prefs/" + name))
    fixture = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
    base = fixture["api_origin"].rstrip("/")
    if not base.endswith("/api/v1"):
        base += "/api/v1"
    origin = urlsplit(base)
    assert origin.hostname in ("localhost", "127.0.0.1")
    native = urlunsplit((origin.scheme, f"10.0.2.2:{origin.port}", origin.path, "", ""))
    cookie = fixture["cookie"]
    headers = {"Cookie": cookie["name"] + "=" + cookie["value"], "X-CSRF-Token": fixture["csrf"], "Content-Type": "application/json"}
    process = subprocess.Popen(ADB + ["shell", "am", "instrument", "-w", "-e", "emulator_qa_prepare", "true", "-e", "qa_api_url", native, "-e", "class", "org.wikimf.reader.EmulatorQaPreparationTest", "org.wikimf.reader.test/androidx.test.runner.AndroidJUnitRunner"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    approved = False
    deadline = time.monotonic() + 100
    while process.poll() is None and time.monotonic() < deadline:
        result = subprocess.run(ADB + ["shell", "run-as", "org.wikimf.reader", "cat", PRIVATE + "files/emulator-qa-grant.json"], capture_output=True)
        if result.returncode == 0 and not approved:
            grant = json.loads(result.stdout)
            request = Request(base + "/device-links/" + grant["link_id"] + "/approve", data=json.dumps({"user_code": grant["user_code"]}).encode(), headers=headers)
            with urlopen(request, timeout=10) as response:
                assert json.load(response)["approved"]
            approved = True
        time.sleep(0.25)
    output = process.communicate(timeout=15)[0].decode("utf-8", errors="replace")
    (ROOT / "apps/android/verification/emulator-qa-preparation.txt").write_text(output, encoding="utf-8")
    assert "OK (1 test)" in output and approved, "Explicit native QA preparation failed; restore original preferences"
    public = json.loads(adb("shell", "run-as", "org.wikimf.reader", "cat", PRIVATE + "files/emulator-qa-result.json"))
    assert public["user_id"] == fixture["user_id"]
    (ROOT / "apps/android/verification/emulator-qa-account.json").write_text(json.dumps(public, indent=2) + "\n")
    print("Dedicated Reader QA account linked; cloud consent remains OFF until Account UI")


if __name__ == "__main__":
    main()
