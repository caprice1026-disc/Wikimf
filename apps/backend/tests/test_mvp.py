import copy
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from conftest import observation,send,web_headers
from wikimf.articles import APIError,parse_article_url
from wikimf.auth import digest,identify,issue_web_session,token
from wikimf.db import Article,Device,Identity,ReadingEvent,User,now
from wikimf.projection import infer,replay,stats,subtract,union


@pytest.mark.parametrize("url",[
    "https://ja.wikipedia.org.evil.test/wiki/Foo","https://user@ja.wikipedia.org/wiki/Foo","javascript:alert(1)",
    "file:///wiki/Foo","https://ja.wikipedia.org:444/wiki/Foo","https://ja.wikipedia.org./wiki/Foo",
    "https://ja.wikipedia.org/wiki/Foo?oldid=1","https://ja.wikipedia.org/wiki/Foo?diff=1",
    "https://ja.wikipedia.org/wiki/Foo?title=Bar","https://ja.wikipedia.org/wiki/%zz",
    "https://ja.wikipedia.org/w/index.php?title=Foo&curid=1","https://ja.wikipedia.org/w/index.php?curid=-1",
    "https://ja.wikipedia.org/w/index.php?title=A&title=B","https://ja.wikipedia.org\\evil/wiki/Foo",
    "https://ja.wikipedia.org/w/index.php?title=%ff","https://ja.wikipedia.org/w/index.php?title=Foo%00",
    "https://ja.wikipedia.org/wiki/Foo%0a",
])
def test_url_security(url):
    with pytest.raises(APIError):
        parse_article_url(url)


def test_url_normalization():
    assert parse_article_url("https://ja.m.wikipedia.org/wiki/Foo_bar#x") == ("jawiki",{"titles":"Foo bar"})
    assert parse_article_url("https://en.wikipedia.org/w/index.php?curid=123") == ("enwiki",{"pageids":"123"})


def test_interval_union_and_state_boundaries():
    assert union([(0,60),(30,90)]) == [(0,90)]
    assert subtract((30,90),[(0,60)]) == [(60,90)]
    doc = {"text_chars":1000,"chunk_chars":[200]*5}
    assert infer(doc,{0},9999,"jawiki") is None
    assert infer(doc,{0},10000,"jawiki") == "viewed"
    assert infer(doc,{0},30000,"jawiki") == "partial"
    assert infer(doc,{0,1,2,3},79999,"jawiki") == "partial"
    assert infer(doc,{0,1,2,3},80000,"jawiki") == "completed"
    assert infer({"text_chars":None,"chunk_chars":[]},set(),100000,"enwiki") == "viewed"


def test_health_resolver_public_metadata(env):
    app,client,ids = env
    assert client.get("/health").json()["status"] == "ok"
    r = client.post("/api/v1/articles/resolve",json={"url":"https://en.wikipedia.org/wiki/Fixture"})
    assert r.status_code == 200
    a = r.json()
    assert a["wiki"] == "enwiki" and a["page_id"] == 202
    assert "user_id" not in a and "state" not in a
    assert client.get("/api/v1/wikis/enwiki/pages/202").json()["article_id"] == a["article_id"]
    assert client.get("/api/v1/wikis/enwiki/pages/2147483648").status_code == 400
    assert client.post("/api/v1/articles/resolve",json={"url":"https://en.wikipedia.org/wiki/Missing"}).status_code == 404


def test_duplicate_conflict_and_user_separation(env):
    app,client,ids = env
    event = observation(ids)
    for i in range(10):
        r = send(client,ids,event)
        assert r.status_code == 200
        assert r.json()["results"][0]["status"] == ("accepted" if i==0 else "duplicate")
    other = copy.deepcopy(event)
    other["progress"]["max_scroll_ratio"] = 0.7
    assert send(client,ids,other).json()["results"][0]["code"] == "event_conflict"
    assert client.get("/api/v1/me/stats").json()["activity"]["active_ms"] == 10000
    with app.state.sessions() as db:
        user = identify(db,"github","different-subject","Other reader")
        secret,web = issue_web_session(db,user.id)
        db.commit()
    client.cookies.set("wikimf_session",secret)
    assert client.get("/api/v1/me/articles").json()["items"] == []
    assert client.get("/api/v1/me/articles/"+ids["article_id"]).status_code == 404


def test_item_ack_does_not_discard_good_event(env):
    app,client,ids = env
    bad = observation(ids)
    bad["user_id"] = str(uuid4())
    good = observation(ids)
    ack = send(client,ids,bad,good).json()["results"]
    assert [x["status"] for x in ack] == ["rejected","accepted"]


def test_invalid_unicode_item_does_not_poison_good_event(env):
    app,client,ids = env
    bad,good = observation(ids),observation(ids)
    bad["client_version"] = "broken-\ud800"
    response = client.post("/api/v1/reading-events/batch",headers={"Authorization":"Bearer "+ids["token"],"Content-Type":"application/json"},
                           content=json.dumps({"schema_version":1,"events":[bad,good]},ensure_ascii=True).encode("ascii"))
    assert response.status_code == 200
    assert [(x["status"],x["code"]) for x in response.json()["results"]] == [("rejected","invalid_event"),("accepted",None)]


def test_article_deletion_blocks_clock_skewed_old_outbox(env):
    app,client,ids = env
    event = observation(ids,start=now()+timedelta(minutes=1),seconds=10)
    assert send(client,ids,event).json()["results"][0]["status"] == "accepted"
    assert client.delete("/api/v1/me/articles/"+ids["article_id"]+"/history",headers=web_headers(ids)).status_code == 200
    assert send(client,ids,event).json()["results"][0]["code"] == "history_deleted"
    assert client.get("/api/v1/me/articles").json()["items"] == []


def test_missing_intervals_reverse_order_quarantine(env):
    app,client,ids = env
    a = observation(ids,seq=1,seconds=10,total=10000)
    b = copy.deepcopy(a)
    b.update(event_id=str(uuid4()),seq=3)
    start = now()-timedelta(minutes=4)
    b["interval"] = {"start_at":start.isoformat(),"end_at":(start+timedelta(seconds=10)).isoformat(),"active_spans_ms":[[0,10000]]}
    b["occurred_at"] = b["interval"]["end_at"]
    b["progress"].update(active_ms_total=30000,covered_chunk_ids=[0,1])
    assert send(client,ids,b,a).json()["results"][1]["status"] == "accepted"
    summary = client.get("/api/v1/me/stats").json()
    assert summary["activity"]["active_ms"] == 20000
    assert client.get("/api/v1/me/activities").json()["items"][0]["pending_sync"]
    c = copy.deepcopy(b)
    c.update(event_id=str(uuid4()),seq=2)
    c["interval"] = {"start_at":(start-timedelta(seconds=10)).isoformat(),"end_at":start.isoformat(),"active_spans_ms":[[0,10000]]}
    c["occurred_at"] = start.isoformat()
    c["progress"]["active_ms_total"] = 40000
    assert send(client,ids,c).json()["results"][0]["status"] == "quarantined"
    assert client.get("/api/v1/me/stats").json()["activity"]["active_ms"] == 0


def test_multidevice_overlap_and_replay(env):
    app,client,ids = env
    with app.state.sessions() as db:
        second_secret = token()
        d = Device(user_id=ids["user_id"],source="android_reader",display_name="Phone",token_hash=digest(second_secret),expires_at=now()+timedelta(days=90))
        a = Article(wiki="enwiki",page_id=202,title="Fixture",canonical_url="https://en.wikipedia.org/wiki/Fixture",trackable=True,namespace=0)
        db.add_all([d,a])
        db.commit()
        second = {**ids,"device_id":d.id,"article_id":a.id,"token":second_secret}
    start = now()-timedelta(minutes=5)
    assert send(client,ids,observation(ids,start=start,seconds=60,chunks=(0,1,2,3))).status_code == 200
    assert send(client,second,observation(second,start=start+timedelta(seconds=30),seconds=60,chunks=(0,1,2,3),wiki="enwiki",page_id=202,source="android_reader")).status_code == 200
    summary = client.get("/api/v1/me/stats").json()
    assert summary["activity"]["active_ms"] == 90000
    assert sum(r["active_ms"] for r in client.get("/api/v1/me/articles").json()["items"]) == 90000
    with app.state.sessions() as db:
        x,y = replay(db,ids["user_id"]),replay(db,ids["user_id"])
        assert x==y


def test_manual_state_and_deletion_no_resurrection(env):
    app,client,ids = env
    event = observation(ids,seconds=30)
    send(client,ids,event)
    path = "/api/v1/me/articles/"+ids["article_id"]
    assert client.put(path+"/state",json={"state":"completed"}).status_code == 403
    r = client.put(path+"/state",headers=web_headers(ids),json={"state":"completed"}).json()
    assert r["evidence"] == "self_reported" and r["active_ms"] == 30000
    assert client.delete(path+"/state",headers=web_headers(ids)).status_code==200
    assert client.get(path).json()["effective_state"] == "partial"
    assert client.delete(path+"/history",headers=web_headers(ids)).status_code==200
    assert send(client,ids,event).json()["results"][0]["code"] == "history_deleted"
    assert client.get("/api/v1/me/articles").json()["items"] == []
    assert client.delete("/api/v1/me/history",headers=web_headers(ids)).json()["recording_epoch"] == 2
    assert send(client,ids,event).json()["results"][0]["code"] == "recording_epoch_mismatch"


def test_identity_link_privacy_export_revoke_account(env):
    app,client,ids = env
    assert client.get("/api/v1/profiles/"+ids["user_id"]).status_code == 404
    with app.state.sessions() as db:
        same = identify(db,"github","same-reader","Same name",ids["user_id"])
        separate = identify(db,"google","different-reader","Same name")
        assert same.id != separate.id
        db.commit()
    assert len(client.get("/api/v1/me/identities").json()["items"])==2
    assert client.delete("/api/v1/me/identities/github",headers=web_headers(ids)).status_code == 200
    assert client.delete("/api/v1/me/identities/google",headers=web_headers(ids)).json()["error"]["code"] == "last_identity"
    headers = web_headers(ids)
    assert client.patch("/api/v1/me/privacy",headers=headers,json={"profile_public":True,"publish_total_time":True}).status_code == 200
    public = client.get("/api/v1/profiles/"+ids["user_id"]).json()
    assert set(public)=={"user_id","display_name","active_ms","achievements"}
    exported = client.post("/api/v1/me/export",headers=headers).text
    for secret in (ids["token"],ids["web_secret"],ids["csrf"],"token_hash","subject"):
        assert secret not in exported
    assert client.delete("/api/v1/me/devices/"+ids["device_id"],headers=headers).status_code==200
    assert send(client,ids,observation(ids)).status_code == 401
    assert client.request("DELETE","/api/v1/me",headers=headers,json={"confirmation":"DELETE"}).status_code==200
    assert client.get("/api/v1/me").status_code==401


def test_pairing_once_scope_csrf(env):
    app,client,ids = env
    grant = client.post("/api/v1/device-links",json={"source":"android_reader","display_name":"My phone"}).json()
    assert grant["device_secret"] not in grant["verification_url"]
    path = "/api/v1/device-links/"+grant["link_id"]
    assert client.get(path).status_code == 200
    assert client.post(path+"/approve",headers=web_headers(ids),json={"user_code":grant["user_code"]}).status_code==200
    exchange = client.post(path+"/exchange",json={"device_secret":grant["device_secret"]})
    assert exchange.status_code == 200
    access = exchange.json()
    assert client.post(path+"/exchange",json={"device_secret":grant["device_secret"]}).status_code==410
    headers = {"Authorization":"Bearer "+access["token"]}
    assert client.get("/api/v1/me",headers=headers).json()["user_id"]==ids["user_id"]
    assert client.patch("/api/v1/me/privacy",headers=headers,json={"profile_public":True}).status_code==403


def test_time_only_unknown_schema_times_and_control(env):
    app,client,ids = env
    event = observation(ids,seconds=30,chunks=())
    event["document"].update(fingerprint=None,text_chars=None,chunk_chars=[])
    event["progress"].update(measurement_status="time_only",reason_code="no_body")
    assert send(client,ids,event).json()["results"][0]["status"]=="accepted"
    assert client.get("/api/v1/me/articles").json()["items"][0]["effective_state"]=="viewed"
    event = observation(ids,start=now()+timedelta(minutes=6))
    assert send(client,ids,event).json()["results"][0]["code"]=="invalid_event_time"
    event = observation(ids)
    event["document"]["fingerprint"] = "bad"
    assert send(client,ids,event).json()["results"][0]["code"]=="invalid_event"
    assert client.patch("/api/v1/me/privacy",headers=web_headers(ids),json={"collection_enabled":False}).status_code==200
    assert send(client,ids,observation(ids)).json()["results"][0]["code"]=="collection_disabled"
    assert not client.get("/api/v1/me/recording-control").json()["collection_enabled"]


def test_reread_char_increment_day_split(env):
    app,client,ids = env
    start = (now()-timedelta(days=3)).replace(hour=14,minute=59,second=50,microsecond=0)
    send(client,ids,observation(ids,start=start,seconds=30,chunks=(0,1,2)))
    send(client,ids,observation(ids,start=start+timedelta(days=1),seconds=50,chunks=(0,1,2)))
    send(client,ids,observation(ids,start=start+timedelta(days=2),seconds=40,chunks=(0,1,2)))
    summary = client.get("/api/v1/me/stats?timezone=Asia/Tokyo").json()
    assert summary["activity"]["estimated_unique_read_chars"]==500
    assert summary["activity"]["activity_count"]==3
    assert summary["library"]["qualified_article_count"]==1
    assert sum(d["active_ms"] for d in summary["daily"])==summary["activity"]["active_ms"]
    assert sum(d["estimated_unique_read_chars"] for d in summary["daily"])==500


@pytest.mark.parametrize("field,value", [("schema_version",True),("progress.max_scroll_ratio",True),("progress.max_scroll_ratio","0.5"),
    ("session_started_at",1791000000),("occurred_at",1791000000),("interval.start_at",1791000000),("interval.end_at",1791000000)])
def test_contract_rejects_json_type_coercion(env,field,value):
    app,client,ids=env
    event=observation(ids)
    pieces=field.split(".")
    target=event if len(pieces)==1 else event[pieces[0]]
    target[pieces[-1]]=value
    assert send(client,ids,event).json()["results"][0]["code"]=="invalid_event"
    assert client.get("/api/v1/me/stats").json()["activity"]["active_ms"]==0


def test_short_sessions_have_no_public_metrics(env):
    app,client,ids=env
    first=observation(ids,seconds=10)
    second=observation(ids,start=now()-timedelta(minutes=4),seconds=5)
    send(client,ids,first,second)
    summary=client.get("/api/v1/me/stats").json()
    records=client.get("/api/v1/me/articles").json()["items"]
    assert summary["activity"]["active_ms"]==sum(r["active_ms"] for r in records)==10000
    assert summary["activity"]["activity_count"]==1


def test_postgres_parallel_duplicate_and_delete(env):
    app,client,ids = env
    if app.state.engine.dialect.name != "postgresql":
        pytest.skip("requires PostgreSQL, not evidence from SQLite")
    event = observation(ids,seconds=30)
    with ThreadPoolExecutor(max_workers=8) as pool:
        replies = list(pool.map(lambda _:send(client,ids,event),range(16)))
    assert all(r.status_code==200 for r in replies)
    assert sum(r.json()["results"][0]["status"]=="accepted" for r in replies)==1
    assert client.get("/api/v1/me/stats").json()["activity"]["active_ms"]==30000
    with ThreadPoolExecutor(max_workers=2) as pool:
        one = pool.submit(send,client,ids,event)
        two = pool.submit(client.delete,"/api/v1/me/articles/"+ids["article_id"]+"/history",headers=web_headers(ids))
        assert one.result().status_code==200 and two.result().status_code==200
    assert client.get("/api/v1/me/articles").json()["items"]==[]
    assert send(client,ids,event).json()["results"][0]["code"]=="history_deleted"
