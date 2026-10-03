"""Optional Windows-local PostgreSQL 17.6, isolated under .tooling (no service install)."""
import hashlib
import json
import urllib.request
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]/".tooling"
root.mkdir(exist_ok=True)
target = root/"postgres"
if not (target/"pgsql/bin/postgres.exe").exists():
    archive = root/"postgres-17.6.zip"
    source = "https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64-binaries.zip"
    urllib.request.urlretrieve(source,archive)
    checksum = hashlib.file_digest(archive.open("rb"),"sha256").hexdigest()
    with zipfile.ZipFile(archive) as bundle:
        members = [x for x in bundle.namelist() if x.startswith(("pgsql/bin/","pgsql/lib/","pgsql/share/"))]
        bundle.extractall(target,members=members)
    (target/"download.json").write_text(json.dumps({"source":source,"sha256":checksum},indent=2),encoding="utf-8")
    archive.unlink()
print(target/"pgsql/bin")
