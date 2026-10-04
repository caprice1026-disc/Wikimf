"""Explicit local QA pairing: native start/exchange, Web approval, revoke only the new device."""
import json
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen


def main():
    fixture = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
    root = Path(__file__).resolve().parents[2]
    base = fixture["api_origin"].rstrip("/")
    if not base.endswith("/api/v1"):
        base += "/api/v1"
    origin = urlsplit(base)
    assert origin.hostname in ("localhost", "127.0.0.1"), "This helper is restricted to the local QA API"
    native_base = urlunsplit((origin.scheme, f"10.0.2.2:{origin.port or 80}", origin.path, "", ""))
    cookie = fixture["cookie"]
    headers = {"Cookie": cookie["name"] + "=" + cookie["value"], "X-CSRF-Token": fixture["csrf"]}
    adb = [str(root / "apps/android/.tooling/sdk/platform-tools/adb.exe"), "-s", "emulator-5554"]
    private = "/data/user_de/0/org.wikimf.reader/files/"
    def adb_call(*args):
        return subprocess.run(adb + list(args), capture_output=True, text=True, encoding="utf-8", errors="replace")
    def read_private(name):
        value = adb_call("shell", "run-as", "org.wikimf.reader", "cat", private + name)
        return json.loads(value.stdout) if value.returncode == 0 else None
    def web(path, body=None, method=None):
        data = json.dumps(body).encode() if body is not None else None
        request = Request(base + path, data=data, headers=headers | ({"Content-Type": "application/json"} if data else {}), method=method)
        with urlopen(request, timeout=10) as response:
            return json.load(response)
    before = {row["device_id"]: row["revoked"] for row in web("/me/devices")["items"]}
    for name in ("pairing-verification.json", "pairing-transport-result.json"):
        adb_call("shell", "run-as", "org.wikimf.reader", "rm", "-f", private + name)
    process = subprocess.Popen(adb + ["shell", "am", "instrument", "-w", "-e", "native_pairing_smoke", "true", "-e", "pairing_api_url", native_base, "-e", "class", "org.wikimf.reader.PairingTransportIntegrationTest", "org.wikimf.reader.test/androidx.test.runner.AndroidJUnitRunner"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    approved = False
    code_hidden = False
    deadline = time.monotonic() + 100
    while process.poll() is None and time.monotonic() < deadline:
        grant = read_private("pairing-verification.json")
        if grant and not approved:
            visible = web("/device-links/" + grant["link_id"])
            assert "user_code" not in visible
            assert grant["user_code"] not in json.dumps(visible)
            code_hidden = True
            assert web("/device-links/" + grant["link_id"] + "/approve", {"user_code": grant["user_code"]})["approved"]
            approved = True
        time.sleep(0.25)
    output, _ = process.communicate(timeout=15)
    evidence = root / "apps/android/verification"
    (evidence / "native-pairing-suite.txt").write_text(output, encoding="utf-8")
    result = read_private("pairing-transport-result.json")
    assert result and result["passed"] and result["user_id"] == fixture["user_id"]
    devices = {row["device_id"]: row for row in web("/me/devices")["items"]}
    new_device = result["device_id"]
    assert new_device not in before and devices[new_device]["source"] == "android_reader"
    assert web("/me/devices/" + new_device, method="DELETE")["revoked"]
    after = {row["device_id"]: row["revoked"] for row in web("/me/devices")["items"]}
    assert all(after[key] == revoked for key, revoked in before.items())
    assert "OK (1 test)" in output, "Native pairing instrumentation must pass"
    seconds = float(re.search(r"Time: ([0-9.]+)", output).group(1))
    report = {"tests": 1, "failures": 0, "seconds": seconds, "source": "android_reader", "transport": "Actual emulator Android Api -> local API/PostgreSQL", "web_get_has_no_user_code": code_hidden, "web_approval_with_csrf": approved, "native_exchange_and_authenticated_me": True, "owner_matches_qa_fixture": True, "new_test_device_revoked": after[new_device], "existing_device_revocation_states_preserved": True, "storage": "Isolated device-protected realm; existing Reader linkage/history preserved", "oauth": "Synthetic QA Web session; live Google/GitHub OAuth remains ST"}
    (evidence / "pairing-transport.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    adb_call("shell", "run-as", "org.wikimf.reader", "rm", "-f", private + "pairing-transport-result.json")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
