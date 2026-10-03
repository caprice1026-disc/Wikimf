"""Real PostgreSQL dump/restore safety drill in fresh disposable databases."""
import json
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/"apps/backend"),str(ROOT/"apps/backend/tests")]
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine,select,text
from conftest import FixtureWiki,observation,send,web_headers
from scripts.backend_ops import apply_safety,safety_manifest
from wikimf.auth import digest,identify,issue_web_session,token
from wikimf.db import Article,ArticleAlias,Device,Identity,ManualState,ReadingEvent,User,WebSession,now
from wikimf.main import create_app
from wikimf.projection import replay
from datetime import timedelta


def main():
    binpath=Path(os.getenv("POSTGRES_BIN",str(ROOT/".tooling/postgres/pgsql/bin")))
    suffix=uuid4().hex[:12]
    source,target="wikimf_ops_"+suffix,"wikimf_restore_"+suffix
    host=os.getenv("PGHOST","127.0.0.1")
    port=os.getenv("PGPORT","54329")
    username=os.getenv("PGUSER","wikimf")
    admin_url=os.getenv("RECOVERY_ADMIN_URL",f"postgresql+psycopg://{username}@{host}:{port}/postgres")
    admin=create_engine(admin_url,isolation_level="AUTOCOMMIT")
    prefix=admin_url.rsplit("/",1)[0]
    evidence=ROOT/".tmp/recovery"
    evidence.mkdir(parents=True,exist_ok=True)
    archive=evidence/(suffix+".dump")
    def pg(tool,*args):
        executable=binpath/(tool+(".exe" if os.name=="nt" else ""))
        result=subprocess.run([str(executable),"-h",host,"-p",port,"-U",username,*args],capture_output=True,text=True)
        if result.returncode:
            raise RuntimeError(f"{tool} failed: {result.stderr[:300]}")
    apps=[]
    try:
        with admin.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{source}"'))
            conn.execute(text(f'CREATE DATABASE "{target}"'))
        cfg=Config(str(ROOT/"apps/backend/alembic.ini"))
        original=os.environ.get("DATABASE_URL")
        os.environ["DATABASE_URL"]=prefix+"/"+source
        command.upgrade(cfg,"head")
        command.downgrade(cfg,"base")  # Only fresh empty DB; never retained-data rollback.
        command.upgrade(cfg,"0002_intervals")
        app=create_app(prefix+"/"+source,FixtureWiki());apps.append(app)
        credentials=[]
        with app.state.sessions() as db:
            article=Article(wiki="jawiki",page_id=101,title="Recovery fixture",canonical_url="https://ja.wikipedia.org/wiki/Fixture",namespace=0,trackable=True)
            db.add(article);db.flush()
            for i in range(3):
                user=identify(db,"google","recovery-"+str(i),"Recovery fixture")
                if i==0:
                    identify(db,"github","recovery-github","Recovery fixture",user.id)
                user.collection_enabled,user.consent_version=True,"privacy-v1"
                secret,web=issue_web_session(db,user.id)
                device_secret=token()
                device=Device(user_id=user.id,source="chrome_extension",display_name="Recovery PC",token_hash=digest(device_secret),expires_at=now()+timedelta(days=1))
                db.add(device);db.flush()
                credentials.append({"user_id":user.id,"device_id":device.id,"article_id":article.id,"token":device_secret,"web_secret":secret,"csrf":web.csrf_token})
            db.commit()
        with TestClient(app) as client:
            for ids in credentials:
                client.cookies.set("wikimf_session",ids["web_secret"])
                assert send(client,ids,observation(ids,seconds=30)).json()["results"][0]["status"]=="accepted"
                assert client.put("/api/v1/me/articles/"+ids["article_id"]+"/state",headers=web_headers(ids),json={"state":"completed"}).status_code==200
            # Upgrade retained evidence; the new cache table must not alter history.
            command.upgrade(cfg,"head")
            with app.state.sessions() as db:
                assert len(list(db.scalars(select(ReadingEvent))))==3
                assert len(list(db.scalars(select(ManualState))))==3
                assert len(list(db.scalars(select(Identity))))==4
                aliases=list(db.scalars(select(ArticleAlias)))
                assert len(aliases)==1 and aliases[0].article_id==credentials[0]["article_id"]
            pg("pg_dump","-Fc","-f",str(archive),source)
            # Delete article, account and all history after the old backup was created.
            for index,ids in enumerate(credentials):
                client.cookies.set("wikimf_session",ids["web_secret"])
                path="/api/v1/me/articles/"+ids["article_id"]+"/history" if index==0 else "/api/v1/me" if index==1 else "/api/v1/me/history"
                result=client.request("DELETE",path,headers=web_headers(ids),json={"confirmation":"DELETE"} if index==1 else None)
                assert result.status_code==200
            # Unlink after backup, and create new article references absent from it.
            with app.state.sessions() as db:
                extra=Article(wiki="enwiki",page_id=999,title="Post-backup article",canonical_url="https://en.wikipedia.org/wiki/New",namespace=0,trackable=True)
                db.add(extra);db.commit();extra_id=extra.id
            ids=credentials[0];client.cookies.set("wikimf_session",ids["web_secret"])
            assert client.delete("/api/v1/me/identities/google",headers=web_headers(ids)).status_code==200
            assert client.delete("/api/v1/me/articles/"+extra_id+"/history",headers=web_headers(ids)).status_code==200
            ids=credentials[2];client.cookies.set("wikimf_session",ids["web_secret"])
            assert client.put("/api/v1/me/articles/"+extra_id+"/state",headers=web_headers(ids),json={"state":"completed"}).status_code==200
        with app.state.sessions() as db:
            ledger=safety_manifest(db)
        pg("pg_restore","--exit-on-error","-d",target,str(archive))
        restored=create_app(prefix+"/"+target,FixtureWiki());apps.append(restored)
        with restored.state.sessions() as db:
            assert len(list(db.scalars(select(ReadingEvent))))==3
            apply_safety(db,ledger)
            assert db.get(User,credentials[1]["user_id"]) is None
            assert not list(db.scalars(select(ReadingEvent)))
            assert not list(db.scalars(select(WebSession)))
            assert not list(db.scalars(select(ManualState)))
            assert [i.provider for i in db.scalars(select(Identity).where(Identity.user_id==credentials[0]["user_id"]))]==["github"]
            for ids in (credentials[0],credentials[2]):
                assert not replay(db,ids["user_id"])["records"]
                assert not db.get(User,ids["user_id"]).collection_enabled
                assert not db.get(User,ids["user_id"]).profile_public
        with TestClient(restored) as client:
            for ids in credentials:
                assert send(client,ids,observation(ids)).status_code==401
        report={"result":"pass","database":"PostgreSQL17.6","checks":["empty-migration-upgrade-downgrade-upgrade","retained-data-migration-0002-to-0003","actual-pg-dump-restore","article-deletion-not-resurrected","account-deletion-not-resurrected","epoch-all-history-not-resurrected","all-old-device-tokens-refused","all-web-sessions-revoked","manual-states-not-resurrected","collection-and-publication-disabled","unlinked-identity-not-restored","missing-post-backup-article-safe"]}
        (evidence/"report.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
        print(json.dumps(report))
    finally:
        for app in apps:app.state.engine.dispose()
        with admin.connect() as conn:
            for name in (source,target):
                conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()
        if "original" in locals():
            if original is None:os.environ.pop("DATABASE_URL",None)
            else:os.environ["DATABASE_URL"]=original


if __name__=="__main__":main()
