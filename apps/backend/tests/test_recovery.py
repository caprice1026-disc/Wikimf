"""Adverse restore cases using the real safety ledger and transaction."""
from sqlalchemy import delete,select

from conftest import observation,send,web_headers
from scripts.backend_ops import apply_safety,safety_manifest
from wikimf.auth import identify
from wikimf.db import Article,DeletionMarker,Device,Identity,ManualState,ReadingEvent,User,WebSession


def test_restore_does_not_restore_unlinked_identity(env):
    app,client,ids = env
    with app.state.sessions() as db:
        identify(db,"github","restore-github","Reader",ids["user_id"])
        original = db.scalar(select(Identity).where(Identity.user_id==ids["user_id"],Identity.provider=="google"))
        backup_identity = {k:getattr(original,k) for k in ("id","user_id","provider","subject","linked_at")}
        db.commit()
    assert client.delete("/api/v1/me/identities/google",headers=web_headers(ids)).status_code == 200
    with app.state.sessions() as db:
        ledger = safety_manifest(db)
        db.add(Identity(**backup_identity))  # Simulate the older backup's login method.
        db.commit()
        apply_safety(db,ledger)
        assert [i.provider for i in db.scalars(select(Identity).where(Identity.user_id==ids["user_id"]))] == ["github"]
        assert not list(db.scalars(select(WebSession)))
        assert all(d.revoked_at for d in db.scalars(select(Device)))


def test_restore_missing_new_article_cannot_rollback_safety(env):
    app,client,ids = env
    event = observation(ids,seconds=30)
    assert send(client,ids,event).json()["results"][0]["status"] == "accepted"
    with app.state.sessions() as db:
        extra = Article(wiki="jawiki",page_id=999,title="Post-backup article",canonical_url="https://ja.wikipedia.org/wiki/New",namespace=0,trackable=True)
        db.add(extra);db.commit()
        extra_id = extra.id
    assert client.delete("/api/v1/me/history",headers=web_headers(ids)).status_code == 200
    assert client.delete("/api/v1/me/articles/"+extra_id+"/history",headers=web_headers(ids)).status_code == 200
    assert client.put("/api/v1/me/articles/"+extra_id+"/state",headers=web_headers(ids),json={"state":"completed"}).status_code == 200
    with app.state.sessions() as db:
        ledger = safety_manifest(db)
        # Older backups contain neither this article nor its new self-report/cutoff.
        db.execute(delete(ManualState).where(ManualState.article_id==extra_id))
        db.execute(delete(DeletionMarker).where(DeletionMarker.article_id==extra_id))
        db.execute(delete(Article).where(Article.id==extra_id))
        db.get(User,ids["user_id"]).recording_epoch = 1
        db.commit()
    assert send(client,ids,event).json()["results"][0]["status"] == "accepted"
    with app.state.sessions() as db:
        apply_safety(db,ledger)
        assert db.get(User,ids["user_id"]).recording_epoch == 2
        assert not list(db.scalars(select(ReadingEvent)))
        assert not list(db.scalars(select(WebSession)))
        assert not list(db.scalars(select(ManualState)))
        assert not db.get(User,ids["user_id"]).collection_enabled
