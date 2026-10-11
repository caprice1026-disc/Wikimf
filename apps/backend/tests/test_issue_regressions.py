"""Deterministic concurrent commits between projection SELECTs (SQLite and PG)."""
from datetime import timedelta

import pytest
from sqlalchemy import event
from sqlalchemy.engine import make_url

from conftest import observation, send, web_headers
from wikimf.db import configured_database_url, database, now


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
