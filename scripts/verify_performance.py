"""Bounded cache-hit API measurement in an isolated PostgreSQL schema."""
import argparse
import json
import os
import platform
import sys
from datetime import timedelta
from pathlib import Path
from time import perf_counter
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/"apps/backend"),str(ROOT/"apps/backend/tests")]
from fastapi.testclient import TestClient
from sqlalchemy import create_engine,text
from sqlalchemy.engine import make_url
from conftest import FixtureWiki,observation,send
from wikimf.auth import digest,identify,issue_web_session,token
from wikimf.db import Article,Base,Device,now
from wikimf.main import create_app


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--events",type=int,default=500)
    parser.add_argument("--requests",type=int,default=30)
    args=parser.parse_args()
    if not 1<=args.events<=2000 or not 10<=args.requests<=50:
        parser.error("events:1..2000, requests:10..50")
    url=os.environ["TEST_DATABASE_URL"]
    admin=create_engine(url)
    schema="perf_"+uuid4().hex
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    isolated=make_url(url).update_query_dict({"options":f"-csearch_path={schema}"}).render_as_string(hide_password=False)
    app=create_app(isolated,FixtureWiki())
    try:
        Base.metadata.create_all(app.state.engine)
        with app.state.sessions() as db:
            user=identify(db,"google","performance-"+uuid4().hex,"Performance fixture")
            user.collection_enabled=True
            web_secret,_=issue_web_session(db,user.id)
            device_secret=token()
            device=Device(user_id=user.id,source="chrome_extension",display_name="Performance fixture",token_hash=digest(device_secret),expires_at=now()+timedelta(days=1))
            article=Article(wiki="jawiki",page_id=101,title="Fixture",canonical_url="https://ja.wikipedia.org/wiki/Fixture",namespace=0,trackable=True)
            db.add_all([device,article]);db.commit()
            ids={"device_id":device.id,"article_id":article.id,"token":device_secret}
        with TestClient(app) as client:
            client.cookies.set("wikimf_session",web_secret)
            start=now()-timedelta(days=3)
            events=[observation(ids,start=start+timedelta(minutes=i),seconds=30) for i in range(args.events)]
            for offset in range(0,len(events),100):
                response=send(client,ids,*events[offset:offset+100])
                assert response.status_code==200
                assert all(r["status"]=="accepted" for r in response.json()["results"])
            measurements={}
            for path in ("/wikis/jawiki/pages/101","/me/articles","/me/activities","/me/stats"):
                for _ in range(3):
                    assert client.get("/api/v1"+path).status_code==200
                values=[]
                for _ in range(args.requests):
                    before=perf_counter()
                    response=client.get("/api/v1"+path)
                    values.append((perf_counter()-before)*1000)
                    assert response.status_code==200
                values.sort()
                measurements[path]={"p50_ms":round(values[len(values)//2],2),"p95_ms":round(values[int(len(values)*.95)-1],2),"max_ms":round(values[-1],2)}
        report={"environment":{"os":platform.platform(),"python":platform.python_version(),"cpu":platform.processor(),"database":"PostgreSQL17.6 local native"},
                "dataset":{"users":1,"articles":1,"sessions":args.events,"raw_events":args.events,"normalized_intervals":args.events},
                "requests_per_endpoint":args.requests,"warmup":3,"transport":"in-process HTTP TestClient; real PostgreSQL; no TLS or WAN",
                "results":measurements,"target_p95_ms":500,"target_met":all(v["p95_ms"]<500 for v in measurements.values())}
        evidence=ROOT/".tmp/performance.json"
        evidence.write_text(json.dumps(report,indent=2),encoding="utf-8")
        print(json.dumps(report))
    finally:
        app.state.engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


if __name__=="__main__":main()
