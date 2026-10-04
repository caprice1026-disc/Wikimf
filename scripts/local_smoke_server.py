"""Local QA API/PG; synthetic identity, optional real MediaWiki metadata.

Never deploy this script: no login bypass endpoint exists. Secrets are written only
to ignored .tmp files for local browser automation. SMOKE_LIVE_WIKIPEDIA=1
uses a separate database/port and never seeds synthetic articles or events.
"""
import json
import os
import sys
from datetime import timedelta
from pathlib import Path
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT/"apps/backend"),str(ROOT/"apps/backend/tests")]
from conftest import FixtureWiki,observation
from wikimf.auth import digest,identify,issue_web_session,token
from wikimf.contracts import EventBatch
from wikimf.db import Article,Base,Device,User,now
from wikimf.ingest import accept_batch
from wikimf.main import create_app
import uvicorn

live = os.getenv("SMOKE_LIVE_WIKIPEDIA") == "1"
port = 8002 if live else 8000
database_name = "wikimf_live_smoke" if live else "wikimf_smoke"
url = os.getenv("SMOKE_DATABASE_URL", f"postgresql+psycopg://wikimf@127.0.0.1:54329/{database_name}")
if live:
    target = make_url(url)
    if (target.drivername != "postgresql+psycopg" or target.host not in ("127.0.0.1", "localhost")
            or target.port != 54329 or target.database != "wikimf_live_smoke"):
        raise RuntimeError("Live metadata QA requires local PostgreSQL on port 54329, database wikimf_live_smoke")
os.environ.setdefault("API_ORIGIN", f"http://localhost:{port}")
os.environ.setdefault("DASHBOARD_ORIGIN", "http://localhost:5174" if live else "http://localhost:5173")
app = create_app(url, None if live else FixtureWiki())
Base.metadata.create_all(app.state.engine)
with app.state.sessions() as db:
    user = identify(db,"google","local-live-smoke-identity" if live else "local-smoke-identity","Local verification reader")
    user.collection_enabled,user.consent_version = True,"privacy-v1"
    secret,web = issue_web_session(db,user.id)
    pc_secret,phone_secret = token(),token()
    pc = Device(user_id=user.id,source="chrome_extension",display_name="Local Chrome",token_hash=digest(pc_secret),expires_at=now()+timedelta(days=1))
    phone = Device(user_id=user.id,source="android_reader",display_name="Synthetic phone sender",token_hash=digest(phone_secret),expires_at=now()+timedelta(days=1))
    article = None
    if not live:
        article = db.scalar(__import__('sqlalchemy').select(Article).where(Article.wiki=="jawiki",Article.page_id==101))
        if not article:
            article = Article(wiki="jawiki",page_id=101,title="Fixture",canonical_url="https://ja.wikipedia.org/wiki/Fixture",namespace=0,trackable=True)
            db.add(article)
    db.add_all([pc,phone])
    db.commit()
    if not live:
        ids = {"user_id":user.id,"device_id":pc.id,"article_id":article.id,"token":pc_secret}
        sample = observation(ids,seconds=30,chunks=(0,1))
        accept_batch(db,user,pc,EventBatch(schema_version=1,events=[sample]))
    payload = {"api_origin":f"http://localhost:{port}","dashboard_origin":os.environ["DASHBOARD_ORIGIN"],"user_id":user.id,
               "cookie":{"name":"wikimf_session","value":secret,"domain":"localhost","path":"/","httpOnly":True,"sameSite":"Lax"},
               "csrf":web.csrf_token,"article_id":article.id if article else None,
               "device":{"user_id":user.id,"device_id":pc.id,"token":pc_secret,"recording_epoch":user.recording_epoch,"display_name":user.display_name}}
    directory = ROOT/".tmp"
    directory.mkdir(exist_ok=True)
    (directory/("backend-live-smoke.json" if live else "backend-smoke.json")).write_text(json.dumps(payload),encoding="utf-8")
print(f"Local PostgreSQL QA server http://localhost:{port}; metadata={'live' if live else 'fixture'}; credentials in ignored .tmp file")
uvicorn.run(app,host="127.0.0.1",port=port,access_log=False)
