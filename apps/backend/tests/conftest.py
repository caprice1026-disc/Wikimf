import os
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from wikimf.auth import COOKIE,digest,identify,issue_web_session,token
from wikimf.db import Article,Base,Device,User,now
from wikimf.main import create_app


class FixtureWiki:
    def query(self,wiki,identifier):
        if identifier.get("titles") == "Missing":
            return {"title":"Missing","missing":True}
        page_id = int(identifier.get("pageids",101 if wiki=="jawiki" else 202))
        title = identifier.get("titles","Fixture" if wiki=="enwiki" else "固定記事")
        return {"pageid":page_id,"ns":0,"title":title,"fullurl":f"https://{'ja' if wiki=='jawiki' else 'en'}.wikipedia.org/wiki/Fixture","revisions":[{"revid":99}],"pageprops":{}}


@pytest.fixture
def env():
    url = os.getenv("TEST_DATABASE_URL")
    schema = "test_"+uuid4().hex
    admin = None
    if url:
        admin = create_engine(url)
        with admin.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        url = str(make_url(url).update_query_dict({"options":f"-csearch_path={schema}"}).render_as_string(hide_password=False))
    else:
        directory = Path(".tmp/tests")
        directory.mkdir(parents=True,exist_ok=True)
        url = "sqlite:///"+str((directory/(schema+".db")).resolve()).replace("\\","/")
    app = create_app(url,FixtureWiki())
    Base.metadata.create_all(app.state.engine)
    with app.state.sessions() as db:
        user = identify(db,"google","fixture-google","Fixture reader")
        user.collection_enabled,user.consent_version = True,"privacy-v1"
        web_secret,web = issue_web_session(db,user.id)
        secret = token()
        device = Device(user_id=user.id,source="chrome_extension",display_name="Fixture PC",token_hash=digest(secret),expires_at=now()+timedelta(days=90))
        article = Article(wiki="jawiki",page_id=101,title="固定記事",canonical_url="https://ja.wikipedia.org/wiki/Fixture",namespace=0,trackable=True)
        db.add_all([device,article])
        db.commit()
        ids = {"user_id":user.id,"device_id":device.id,"article_id":article.id,"token":secret,"web_secret":web_secret,"csrf":web.csrf_token}
    with TestClient(app) as client:
        client.cookies.set(COOKIE,web_secret)
        yield app,client,ids
    app.state.engine.dispose()
    if admin:
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def observation(ids,*,session_id=None,seq=1,start=None,seconds=10,total=None,chunks=(0,),wiki="jawiki",page_id=101,source="chrome_extension",event_type="reading.observed"):
    start = start or now()-timedelta(minutes=5)
    end = start+timedelta(seconds=seconds)
    return {"event_id":str(uuid4()),"type":event_type,"device_id":ids["device_id"],"session_id":session_id or str(uuid4()),"session_started_at":start.isoformat(),"seq":seq,
            "source":source,"article_id":ids["article_id"],"wiki":wiki,"page_id":page_id,"recording_epoch":1,"occurred_at":end.isoformat(),
            "interval":{"start_at":start.isoformat(),"end_at":end.isoformat(),"active_spans_ms":[[0,seconds*1000]] if seconds else []},
            "document":{"fingerprint":"a"*64,"extractor_version":"prose-v1","observed_revision_id":None,"text_chars":1000,"chunk_chars":[200]*5},
            "progress":{"active_ms_total":total if total is not None else seconds*1000,"covered_chunk_ids":list(chunks),"measurement_status":"ok","max_scroll_ratio":0.5},
            "client_version":"0.1.0","measurement_policy_version":"reading-v1"}


def send(client,ids,*events):
    return client.post("/api/v1/reading-events/batch",headers={"Authorization":"Bearer "+ids["token"]},json={"schema_version":1,"events":list(events)})


def web_headers(ids):
    return {"X-CSRF-Token":ids["csrf"]}
