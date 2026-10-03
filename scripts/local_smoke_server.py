"""Real API/SQLAlchemy/PostgreSQL QA server; synthetic identities and article metadata only.

Never deploy this script: no login bypass endpoint exists. Secrets are written only
to the ignored .tmp/backend-smoke.json for local browser automation.
"""
import json
import os
import sys
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT/"apps/backend"),str(ROOT/"apps/backend/tests")]
from conftest import FixtureWiki,observation
from wikimf.auth import digest,identify,issue_web_session,token
from wikimf.contracts import EventBatch
from wikimf.db import Article,Base,Device,User,now
from wikimf.ingest import accept_batch
from wikimf.main import create_app
import uvicorn

url = os.getenv("SMOKE_DATABASE_URL", "postgresql+psycopg://wikimf@127.0.0.1:54329/wikimf_smoke")
app = create_app(url,FixtureWiki())
Base.metadata.create_all(app.state.engine)
with app.state.sessions() as db:
    user = identify(db,"google","local-smoke-identity","Local verification reader")
    user.collection_enabled,user.consent_version = True,"privacy-v1"
    secret,web = issue_web_session(db,user.id)
    pc_secret,phone_secret = token(),token()
    pc = Device(user_id=user.id,source="chrome_extension",display_name="Local Chrome",token_hash=digest(pc_secret),expires_at=now()+timedelta(days=1))
    phone = Device(user_id=user.id,source="android_reader",display_name="Synthetic phone sender",token_hash=digest(phone_secret),expires_at=now()+timedelta(days=1))
    article = db.scalar(__import__('sqlalchemy').select(Article).where(Article.wiki=="jawiki",Article.page_id==101))
    if not article:
        article = Article(wiki="jawiki",page_id=101,title="Fixture",canonical_url="https://ja.wikipedia.org/wiki/Fixture",namespace=0,trackable=True)
        db.add(article)
    db.add_all([pc,phone])
    db.commit()
    ids = {"user_id":user.id,"device_id":pc.id,"article_id":article.id,"token":pc_secret}
    sample = observation(ids,seconds=30,chunks=(0,1))
    accept_batch(db,user,pc,EventBatch(schema_version=1,events=[sample]))
    payload = {"api_origin":"http://localhost:8000","dashboard_origin":"http://localhost:5173","user_id":user.id,
               "cookie":{"name":"wikimf_session","value":secret,"domain":"localhost","path":"/","httpOnly":True,"sameSite":"Lax"},
               "csrf":web.csrf_token,"article_id":article.id,
               "device":{"user_id":user.id,"device_id":pc.id,"token":pc_secret,"recording_epoch":user.recording_epoch,"display_name":user.display_name}}
    directory = ROOT/".tmp"
    directory.mkdir(exist_ok=True)
    (directory/"backend-smoke.json").write_text(json.dumps(payload),encoding="utf-8")
print("Local PostgreSQL QA server http://localhost:8000; private browser credentials saved to ignored .tmp file")
uvicorn.run(app,host="127.0.0.1",port=8000,access_log=False)
