"""Deterministic concurrent commits between projection SELECTs (SQLite and PG)."""
from datetime import timedelta

import pytest
from sqlalchemy import event
from sqlalchemy.engine import make_url

from conftest import observation, send, web_headers
from wikimf.db import DeletionMarker, configured_database_url, database, now


@pytest.mark.parametrize("mutation", ["new", "append", "article_delete", "all_delete", "manual"])
def test_projection_keeps_one_snapshot_during_independent_commit(env, mutation):
    app, client, ids = env
    if app.state.engine.dialect.name == "sqlite":
        with app.state.engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA journal_mode=WAL")
    first = observation(ids, seconds=30)
    if mutation != "new":
        assert send(client, ids, first).json()["results"][0]["status"] == "accepted"
    before = 0 if mutation == "new" else 30000
    committed = False

    def insert_commit_between_selects(connection, cursor, statement, parameters, context, many):
        nonlocal committed
        if committed or "FROM reading_sessions" not in statement:
            return
        committed = True
        if mutation == "new":
            assert send(client, ids, first).json()["results"][0]["status"] == "accepted"
        elif mutation == "append":
            extra = observation(ids, session_id=first["session_id"], seq=2,
                                start=now()-timedelta(minutes=4), seconds=10, total=40000)
            extra["session_started_at"] = first["session_started_at"]
            extra["interval"]["start_at"] = first["interval"]["end_at"]
            from datetime import datetime
            extra["occurred_at"] = extra["interval"]["end_at"] = (datetime.fromisoformat(first["interval"]["end_at"])+timedelta(seconds=10)).isoformat()
            assert send(client, ids, extra).json()["results"][0]["status"] == "accepted"
        elif mutation == "manual":
            assert client.put(f'/api/v1/me/articles/{ids["article_id"]}/state',
                              headers=web_headers(ids), json={"state": "completed"}).status_code == 200
        else:
            path = f'/api/v1/me/articles/{ids["article_id"]}/history' if mutation == "article_delete" else "/api/v1/me/history"
            assert client.delete(path, headers=web_headers(ids)).status_code == 200

    event.listen(app.state.engine, "before_cursor_execute", insert_commit_between_selects)
    try:
        response = client.get("/api/v1/me/stats")
    finally:
        event.remove(app.state.engine, "before_cursor_execute", insert_commit_between_selects)
    assert committed
    assert response.status_code == 200, response.text
    assert response.json()["activity"]["active_ms"] == before
    assert response.json()["library"]["completed_self_reported_count"] == 0
    after = client.get("/api/v1/me/stats").json()
    assert after["activity"]["active_ms"] == {"new": 30000, "append": 40000, "article_delete": 0, "all_delete": 0, "manual": 30000}[mutation]
    assert after["library"]["completed_self_reported_count"] == (1 if mutation == "manual" else 0)


@pytest.mark.parametrize("password", ["synthetic_plain_123", "synthetic@pass", "synthetic%40pass", "synthetic@%40:/?# pass"])
def test_database_components_preserve_raw_password(monkeypatch, password):
    monkeypatch.setenv("DATABASE_HOST", "db")
    monkeypatch.setenv("DATABASE_PASSWORD", password)
    monkeypatch.setenv("DATABASE_URL", "sqlite:///ignored.db")
    url = configured_database_url()
    assert url.password == password
    round_trip = make_url(url.render_as_string(hide_password=False))
    assert (round_trip.password, round_trip.host, round_trip.database) == (password, "db", "wikimf")
    engine, _ = database()
    try:
        assert engine.url.password == password
        assert password not in str(engine.url)
    finally:
        engine.dispose()


def test_article_deletion_rejects_old_session_and_accepts_post_cutoff_session(env):
    app, client, ids = env
    cutoff = now()-timedelta(seconds=30)
    with app.state.sessions() as db:
        db.add(DeletionMarker(user_id=ids["user_id"], article_id=ids["article_id"], deleted_before=cutoff))
        db.commit()
    old = observation(ids, start=cutoff-timedelta(seconds=5), seconds=10)
    fresh = observation(ids, start=cutoff+timedelta(milliseconds=1), seconds=10)
    results = send(client, ids, old, fresh).json()["results"]
    assert (results[0]["status"], results[0]["code"], results[0]["retryable"]) == ("rejected", "history_deleted", False)
    assert results[1]["status"] == "accepted"
    assert client.get("/api/v1/me/stats").json()["activity"]["active_ms"] == 10000


@pytest.fixture
def limited_pool_env(env, monkeypatch, request):
    """Keep real transactions, but fail quickly if a request holds two slots."""
    from fastapi.testclient import TestClient
    from wikimf import db as db_module
    from wikimf.auth import COOKIE
    from wikimf.main import create_app

    original_app, _, ids = env
    create_engine = db_module.create_engine
    capacity = getattr(request, "param", 1)

    def limited_engine(*args, **kwargs):
        return create_engine(*args, **kwargs, pool_size=capacity, max_overflow=0, pool_timeout=0.25)

    monkeypatch.setattr(db_module, "create_engine", limited_engine)
    app = create_app(original_app.state.engine.url, original_app.state.mediawiki)
    try:
        with TestClient(app) as client:
            client.cookies.set(COOKIE, ids["web_secret"])
            yield app, client, ids
    finally:
        app.state.engine.dispose()


@pytest.mark.parametrize("endpoint", ["articles", "activities", "record", "stats", "achievements", "profile", "export", "state"])
def test_projection_endpoints_work_with_one_pool_connection(limited_pool_env, endpoint):
    from wikimf.db import User

    app, client, ids = limited_pool_env
    assert send(client, ids, observation(ids, seconds=30)).json()["results"][0]["status"] == "accepted"
    with app.state.sessions() as db:
        db.get(User, ids["user_id"]).profile_public = True
        db.commit()
    checkouts = []

    def checked_out(connection, record, proxy):
        checkouts.append(connection)

    event.listen(app.state.engine, "checkout", checked_out)
    try:
        if endpoint == "record":
            response = client.get(f'/api/v1/me/articles/{ids["article_id"]}')
        elif endpoint == "profile":
            response = client.get(f'/api/v1/profiles/{ids["user_id"]}')
        elif endpoint == "export":
            response = client.post("/api/v1/me/export", headers=web_headers(ids))
        elif endpoint == "state":
            response = client.put(f'/api/v1/me/articles/{ids["article_id"]}/state',
                                  headers=web_headers(ids), json={"state": "completed"})
        else:
            response = client.get("/api/v1/me/"+endpoint)
    finally:
        event.remove(app.state.engine, "checkout", checked_out)
    assert response.status_code == 200, response.text
    # State writes commit first and then read back in a new, sequential snapshot.
    assert len(checkouts) == (2 if endpoint == "state" else 1)
    assert app.state.engine.pool.checkedout() == 0
    if endpoint == "export":
        assert len(response.json()["events"]) == len(response.json()["activities"]) == 1
        assert response.json()["articles"][0]["active_ms"] == 30000
    elif endpoint == "state":
        assert response.json()["effective_state"] == "completed"
        assert response.json()["active_ms"] == 30000


@pytest.mark.parametrize("limited_pool_env", [3], indirect=True)
@pytest.mark.parametrize("credential", ["web", "device"])
def test_concurrent_projections_do_not_exhaust_pool(limited_pool_env, monkeypatch, credential):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from wikimf import main

    app, client, ids = limited_pool_env
    barrier = Barrier(3)
    replay = main.replay

    def synchronized_replay(db, user_id):
        # Every request has authenticated and holds a connection before replay.
        barrier.wait(timeout=5)
        return replay(db, user_id)

    monkeypatch.setattr(main, "replay", synchronized_replay)
    headers = {"Authorization": "Bearer "+ids["token"]} if credential == "device" else {}
    with ThreadPoolExecutor(max_workers=3) as executor:
        responses = list(executor.map(lambda _: client.get("/api/v1/me/stats", headers=headers), range(3)))
    assert [response.status_code for response in responses] == [200, 200, 200]
    assert app.state.engine.pool.checkedout() == 0


def test_export_keeps_user_lock_and_write_isolation(env):
    from sqlalchemy import text
    from sqlalchemy.exc import OperationalError
    from wikimf.db import User
    from wikimf.ingest import lock_user

    app, client, ids = env
    if app.state.engine.dialect.name != "postgresql":
        pytest.skip("requires PostgreSQL row locks and isolation")
    assert send(client, ids, observation(ids, seconds=30)).json()["results"][0]["status"] == "accepted"
    # A previous snapshot must not leave pooled writer connections at RR.
    assert client.get("/api/v1/me/stats").status_code == 200
    checked = False

    def check_lock_during_replay(connection, cursor, statement, parameters, context, many):
        nonlocal checked
        if checked or "FROM reading_sessions" not in statement:
            return
        checked = True
        assert connection.get_isolation_level() == "READ COMMITTED"
        with app.state.sessions() as writer:
            writer.execute(text("SET LOCAL lock_timeout = '100ms'"))
            with pytest.raises(OperationalError) as failure:
                lock_user(writer, ids["user_id"])
            assert failure.value.orig.sqlstate == "55P03"
            writer.rollback()

    event.listen(app.state.engine, "before_cursor_execute", check_lock_during_replay)
    try:
        response = client.post("/api/v1/me/export", headers=web_headers(ids))
    finally:
        event.remove(app.state.engine, "before_cursor_execute", check_lock_during_replay)
    assert checked
    assert response.status_code == 200, response.text
    assert len(response.json()["events"]) == len(response.json()["activities"]) == 1
    # Ending the read response releases the lock, without changing writer isolation.
    with app.state.sessions() as writer:
        assert writer.connection().get_isolation_level() == "READ COMMITTED"
        writer.execute(text("SET LOCAL lock_timeout = '100ms'"))
        user = lock_user(writer, ids["user_id"])
        assert isinstance(user, User)


@pytest.mark.parametrize("mutation", ["new", "append", "article_delete", "all_delete", "manual"])
def test_sqlite_export_keeps_one_snapshot_during_independent_commit(monkeypatch, request, mutation):
    # Exercise SQLite even when the rest of the suite uses TEST_DATABASE_URL.
    monkeypatch.delenv("TEST_DATABASE_URL", raising=False)
    app, client, ids = request.getfixturevalue("env")
    with app.state.engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
    first = observation(ids, seconds=30)
    if mutation != "new":
        assert send(client, ids, first).json()["results"][0]["status"] == "accepted"
    before = client.post("/api/v1/me/export", headers=web_headers(ids)).json()
    committed = False

    def commit_during_replay(connection, cursor, statement, parameters, context, many):
        nonlocal committed
        if committed or "FROM reading_sessions" not in statement:
            return
        committed = True
        if mutation == "new":
            assert send(client, ids, first).json()["results"][0]["status"] == "accepted"
        elif mutation == "append":
            from datetime import datetime
            extra = observation(ids, session_id=first["session_id"], seq=2,
                                start=datetime.fromisoformat(first["interval"]["end_at"]), seconds=10, total=40000)
            extra["session_started_at"] = first["session_started_at"]
            assert send(client, ids, extra).json()["results"][0]["status"] == "accepted"
        elif mutation == "manual":
            assert client.put(f'/api/v1/me/articles/{ids["article_id"]}/state',
                              headers=web_headers(ids), json={"state": "completed"}).status_code == 200
        else:
            path = f'/api/v1/me/articles/{ids["article_id"]}/history' if mutation == "article_delete" else "/api/v1/me/history"
            assert client.delete(path, headers=web_headers(ids)).status_code == 200

    event.listen(app.state.engine, "before_cursor_execute", commit_during_replay)
    try:
        response = client.post("/api/v1/me/export", headers=web_headers(ids))
    finally:
        event.remove(app.state.engine, "before_cursor_execute", commit_during_replay)
    assert committed
    assert response.status_code == 200, response.text
    # Raw events and projected records must come from the same pre-commit state.
    assert response.json() == before
    after = client.post("/api/v1/me/export", headers=web_headers(ids)).json()
    assert after != before
    assert len(after["events"]) == {"new": 1, "append": 2, "article_delete": 0, "all_delete": 0, "manual": 1}[mutation]
    assert sum(a["active_ms"] for a in after["activities"]) == {"new": 30000, "append": 40000, "article_delete": 0, "all_delete": 0, "manual": 30000}[mutation]
