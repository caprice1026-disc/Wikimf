"""ADB/SQLite half of the explicit emulator runner. Public CDP observations use Node's WebSocket."""
import hashlib
import json
import os
import re
from pathlib import Path
import sqlite3
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
ANDROID = ROOT / "apps/android"
ADB = [str(ANDROID / ".tooling/sdk/platform-tools/adb.exe"), "-s", "emulator-5554"]
EVIDENCE = ANDROID / "verification/emulator-st-observations.json"


def adb(*args):
    result = subprocess.run(ADB + list(args), capture_output=True)
    if result.returncode:
        raise RuntimeError("ADB failed: " + " ".join(args[:3]))
    return result.stdout


def record(operation, label, value):
    items = json.loads(EVIDENCE.read_text(encoding="utf-8")) if EVIDENCE.exists() else []
    items.append(dict(at=datetime.now(timezone.utc).isoformat(), operation=operation, label=label, **value))
    EVIDENCE.write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(value, ensure_ascii=True))


def main():
    operation, label, *args = sys.argv[1:]
    if operation in ("probe", "eval", "event", "lifecycle", "crash", "metrics", "delete-article", "delete-history"):
        if operation in ("probe", "eval", "event", "lifecycle", "crash"):
            pid = adb("shell", "pidof", "org.wikimf.reader").decode().strip().split()[0]
            adb("forward", "tcp:9223", "localabstract:webview_devtools_remote_" + pid)
            os.environ["WIKIMF_READER_PID"] = pid
        subprocess.run(["node", str(ANDROID / "verify-emulator.mjs"), operation, label, *args], check=True)
    elif operation == "adb":
        record(operation, label, dict(args=args, output=adb(*args).decode(errors="replace").strip()))
    elif operation == "power":
        power = adb("shell", "dumpsys", "power").decode()
        policy = adb("shell", "dumpsys", "window", "policy").decode()
        values = {"wakefulness": re.search(r"mWakefulness=(\w+)", power).group(1)}
        for field in ("showing", "secure", "occluded"):
            match = re.search(r"^\s+" + field + r"=(true|false)\s*$", policy, re.M)
            values[field] = match.group(1) == "true" if match else None
        record(operation, label, values)
    elif operation == "foreground":
        activity = adb("shell", "dumpsys", "activity", "activities").decode()
        record(operation, label, dict(resumed=[line.strip() for line in activity.splitlines() if "topResumedActivity=" in line or "mResumedActivity:" in line]))
    elif operation in ("ui", "tap-text"):
        adb("shell", "uiautomator", "dump", "/sdcard/wikimf-ui.xml")
        tree = ET.fromstring(adb("shell", "cat", "/sdcard/wikimf-ui.xml"))
        nodes = [n for n in tree.iter("node") if n.get("text") and not n.get("text").startswith("確認コード")]
        if operation == "ui":
            record(operation, label, dict(labels=[dict(text=n.get("text"), bounds=n.get("bounds"), enabled=n.get("enabled"), checked=n.get("checked")) for n in nodes[:40]]))
        else:
            target = next(n for n in nodes if n.get("text") == args[0])
            x1, y1, x2, y2 = map(int, re.findall(r"\d+", target.get("bounds")))
            adb("shell", "input", "tap", str((x1+x2)//2), str((y1+y2)//2))
            record(operation, label, dict(text=args[0], tapped=True))
    elif operation == "queue":
        snapshot = ANDROID / ".tooling/emulator-queue.sqlite"
        snapshot.write_bytes(adb("exec-out", "run-as", "org.wikimf.reader", "cat", "databases/wikimf.sqlite"))
        with sqlite3.connect(snapshot) as db:
            rows = []
            for id, owner, device, payload, pending, attempt, next_try in db.execute("SELECT id,owner,device,payload,pending_url,attempt,next_try FROM outbox"):
                e = json.loads(payload)
                interval = e.get("interval", {})
                duration = None
                if interval.get("start_at") and interval.get("end_at"):
                    duration = int((datetime.fromisoformat(interval["end_at"].replace("Z", "+00:00")) - datetime.fromisoformat(interval["start_at"].replace("Z", "+00:00"))).total_seconds() * 1000)
                rows.append(dict(id=id, owner=owner, device=device, sha256=hashlib.sha256(payload.encode()).hexdigest(), pending_url=pending is not None, attempt=attempt, next_try=next_try, session_id=e.get("session_id"), epoch=e.get("recording_epoch"), type=e.get("type"), seq=e.get("seq"), active_ms_total=e.get("progress", {}).get("active_ms_total"), interval_duration_ms=duration, spans=interval.get("active_spans_ms")))
            record(operation, label, dict(rows=rows, history=[dict(owner=o, kind=k, count=n) for o,k,n in db.execute("SELECT owner,kind,COUNT(*) FROM history GROUP BY owner,kind")], diagnostics=[dict(owner=o,code=k,count=n) for o,k,n in db.execute("SELECT owner,code,COUNT(*) FROM diagnostics GROUP BY owner,code")]))
    elif operation == "wm":
        directory = ANDROID / ".tooling/emulator-wm"
        directory.mkdir(exist_ok=True)
        for suffix in ("", "-wal", "-shm"):
            try:
                (directory / ("work.db" + suffix)).write_bytes(adb("exec-out", "run-as", "org.wikimf.reader", "cat", "no_backup/androidx.work.workdb" + suffix))
            except RuntimeError:
                pass
        with sqlite3.connect(directory / "work.db") as db:
            db.row_factory = sqlite3.Row
            record(operation, label, dict(work=[dict(row) for row in db.execute('SELECT id,state,worker_class_name,run_attempt_count,last_enqueue_time,schedule_requested_at,backoff_delay_duration,next_schedule_time_override FROM workspec WHERE worker_class_name LIKE "%SyncWorker"')]))
    else:
        raise ValueError("Unknown operation")


if __name__ == "__main__":
    main()
