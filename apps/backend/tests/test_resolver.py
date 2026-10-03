"""Resolver boundaries through real API/database routes and isolated upstream fixtures."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from urllib.parse import quote

import pytest
from sqlalchemy import func, select

from conftest import observation, send
from wikimf.articles import APIError
from wikimf.db import Article, ArticleAlias, now, utc


def canonical_page(wiki="jawiki", *, namespace=0, props=None):
    language = {"jawiki": "ja", "enwiki": "en"}[wiki]
    return {"pageid": 501, "ns": namespace, "title": "Canonical fixture",
            "canonicalurl": f"https://{language}.wikipedia.org/wiki/Canonical_fixture",
            "revisions": [{"revid": 321}], "pageprops": props or {}}


def install_query(app, monkeypatch, query):
    monkeypatch.setattr(app.state.mediawiki, "query", query)


@pytest.mark.parametrize("wiki,language", [("jawiki", "ja"), ("enwiki", "en")])
def test_redirect_aliases_url_and_page_id_share_canonical_article(env, monkeypatch, wiki, language):
    app, client, ids = env
    calls = []

    def query(requested_wiki, identifier):
        assert requested_wiki == wiki
        calls.append(identifier)
        return canonical_page(wiki)

    install_query(app, monkeypatch, query)
    responses = [client.post("/api/v1/articles/resolve", json={"url": url}) for url in (
        f"https://{language}.wikipedia.org/wiki/Redirect_fixture",
        f"https://{language}.m.wikipedia.org/wiki/Second_redirect#section",
        f"https://{language}.wikipedia.org/wiki/Canonical_fixture",
        f"https://{language}.wikipedia.org/w/index.php?curid=501",
    )]
    assert all(response.status_code == 200 for response in responses)
    items = [response.json() for response in responses]
    assert len({item["article_id"] for item in items}) == 1
    assert all(item["wiki"] == wiki and item["page_id"] == 501 for item in items)
    assert all(item["title"] == "Canonical fixture" for item in items)
    assert all(item["canonical_url"] == canonical_page(wiki)["canonicalurl"] for item in items)
    assert calls == [{"titles": "Redirect fixture"}, {"titles": "Second redirect"}]
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Article).where(Article.wiki == wiki, Article.page_id == 501)) == 1
    assert client.get("/api/v1/me/articles").json()["items"] == []


@pytest.mark.parametrize("namespace,props,reason", [
    (1, {}, "namespace"),
    (0, {"disambiguation": ""}, "disambiguation"),
    (0, {"mainpage": ""}, "main_page"),
])
def test_untrackable_metadata_does_not_become_reading_activity(env, monkeypatch, namespace, props, reason):
    app, client, ids = env
    install_query(app, monkeypatch, lambda wiki, identifier: canonical_page(namespace=namespace, props=props))
    response = client.post("/api/v1/articles/resolve", json={"url": "https://ja.wikipedia.org/wiki/Fixture_alias"})
    assert response.status_code == 200
    article = response.json()
    assert article["namespace"] == namespace
    assert article["availability"] == "available"
    assert article["trackable"] is False
    assert article["untrackable_reason"] == reason
    resolved_ids = {**ids, "article_id": article["article_id"]}
    event = observation(resolved_ids, page_id=501)
    assert send(client, resolved_ids, event).json()["results"][0]["code"] == "article_untrackable"
    assert client.get("/api/v1/me/articles").json()["items"] == []


def expire_article(app, article_id):
    expired_at = now() - timedelta(hours=2)
    with app.state.sessions() as db:
        db.get(Article, article_id).resolved_at = expired_at
        db.commit()
    return expired_at


def unavailable(wiki, identifier):
    raise APIError("wikipedia_unavailable", 503, True)


def test_expired_cache_upstream_unavailable_returns_stale_without_missing(env, monkeypatch):
    app, client, ids = env
    expired_at = expire_article(app, ids["article_id"])
    install_query(app, monkeypatch, unavailable)
    response = client.post("/api/v1/articles/resolve", json={"wiki": "jawiki", "page_id": 101})
    assert response.status_code == 200
    article = response.json()
    assert article["article_id"] == ids["article_id"]
    assert article["metadata_status"] == "stale"
    assert article["availability"] == "available"
    assert article["trackable"] is True
    assert article["resolved_at"] == expired_at.isoformat()
    with app.state.sessions() as db:
        assert utc(db.get(Article, ids["article_id"]).resolved_at) == expired_at


def test_resolved_redirect_alias_uses_canonical_cache_when_upstream_is_unavailable(env, monkeypatch):
    app, client, ids = env
    install_query(app, monkeypatch, lambda wiki, identifier: canonical_page("enwiki"))
    path = "https://en.wikipedia.org/wiki/Redirect_fixture"
    initial = client.post("/api/v1/articles/resolve", json={"url": path})
    assert initial.status_code == 200
    install_query(app, monkeypatch, unavailable)
    cached = client.post("/api/v1/articles/resolve", json={"url": path})
    assert cached.status_code == 200
    assert cached.json()["article_id"] == initial.json()["article_id"]
    assert cached.json()["metadata_status"] == "fresh"


@pytest.mark.parametrize("expired_component", ["alias", "canonical_metadata"])
def test_alias_freshness_requires_both_mapping_and_canonical_metadata(env, monkeypatch, expired_component):
    app, client, ids = env
    install_query(app, monkeypatch, lambda wiki, identifier: canonical_page("enwiki"))
    path = "https://en.wikipedia.org/wiki/Redirect_fixture"
    initial = client.post("/api/v1/articles/resolve", json={"url": path}).json()
    with app.state.sessions() as db:
        alias = db.scalar(select(ArticleAlias).where(ArticleAlias.wiki == "enwiki", ArticleAlias.title == "Redirect fixture"))
        metadata = db.get(Article, initial["article_id"])
        stale = alias if expired_component == "alias" else metadata
        stale.resolved_at = now() - timedelta(hours=2)
        db.commit()
    install_query(app, monkeypatch, unavailable)
    response = client.post("/api/v1/articles/resolve", json={"url": path})
    assert response.status_code == 200
    assert response.json()["article_id"] == initial["article_id"]
    assert response.json()["metadata_status"] == "stale"
    assert response.json()["availability"] == "available"


def test_expired_alias_remaps_without_reassigning_existing_reading_history(env, monkeypatch):
    app, client, ids = env
    install_query(app, monkeypatch, lambda wiki, identifier: canonical_page())
    path = "https://ja.wikipedia.org/wiki/Redirect_fixture"
    original = client.post("/api/v1/articles/resolve", json={"url": path}).json()
    original_ids = {**ids, "article_id": original["article_id"]}
    assert send(client, original_ids, observation(original_ids, page_id=501)).json()["results"][0]["status"] == "accepted"
    with app.state.sessions() as db:
        alias = db.scalar(select(ArticleAlias).where(ArticleAlias.wiki == "jawiki", ArticleAlias.title == "Redirect fixture"))
        alias.resolved_at = now() - timedelta(hours=2)
        db.commit()
    replacement = {**canonical_page(), "pageid": 502, "title": "Replacement fixture",
                   "canonicalurl": "https://ja.wikipedia.org/wiki/Replacement_fixture"}
    install_query(app, monkeypatch, lambda wiki, identifier: replacement)
    updated = client.post("/api/v1/articles/resolve", json={"url": path})
    assert updated.status_code == 200
    new = updated.json()
    assert new["article_id"] != original["article_id"] and new["page_id"] == 502
    with app.state.sessions() as db:
        alias = db.scalar(select(ArticleAlias).where(ArticleAlias.wiki == "jawiki", ArticleAlias.title == "Redirect fixture"))
        assert alias.article_id == new["article_id"]
        assert db.get(Article, original["article_id"]).page_id == 501
        assert db.get(Article, original["article_id"]).title == original["title"]
    activities = client.get("/api/v1/me/activities").json()["items"]
    assert len(activities) == 1 and activities[0]["article_id"] == original["article_id"]
    install_query(app, monkeypatch, unavailable)
    assert client.post("/api/v1/articles/resolve", json={"url": path}).json()["article_id"] == new["article_id"]


def test_missing_alias_removes_mapping_without_marking_canonical_article_missing(env, monkeypatch):
    app, client, ids = env
    install_query(app, monkeypatch, lambda wiki, identifier: canonical_page("enwiki"))
    path = "https://en.wikipedia.org/wiki/Redirect_fixture"
    original = client.post("/api/v1/articles/resolve", json={"url": path}).json()
    with app.state.sessions() as db:
        alias = db.scalar(select(ArticleAlias).where(ArticleAlias.wiki == "enwiki", ArticleAlias.title == "Redirect fixture"))
        alias.resolved_at = now() - timedelta(hours=2)
        db.commit()
    install_query(app, monkeypatch, lambda wiki, identifier: {"missing": True, "title": "Redirect fixture"})
    missing = client.post("/api/v1/articles/resolve", json={"url": path})
    assert missing.status_code == 404
    with app.state.sessions() as db:
        assert db.scalar(select(ArticleAlias).where(ArticleAlias.wiki == "enwiki", ArticleAlias.title == "Redirect fixture")) is None
        canonical = db.get(Article, original["article_id"])
        assert canonical.availability == "available" and canonical.trackable
    install_query(app, monkeypatch, unavailable)
    canonical = client.post("/api/v1/articles/resolve", json={"url": original["canonical_url"]})
    assert canonical.status_code == 200
    assert canonical.json()["article_id"] == original["article_id"]
    assert canonical.json()["availability"] == "available"


def test_missing_canonical_title_updates_article_and_refreshes_its_mapping(env, monkeypatch):
    app, client, ids = env
    install_query(app, monkeypatch, lambda wiki, identifier: canonical_page("enwiki"))
    path = canonical_page("enwiki")["canonicalurl"]
    original = client.post("/api/v1/articles/resolve", json={"url": path}).json()
    expire_article(app, original["article_id"])
    install_query(app, monkeypatch, lambda wiki, identifier: {"missing": True, "title": "Canonical fixture"})
    missing = client.post("/api/v1/articles/resolve", json={"url": path})
    assert missing.status_code == 200
    assert missing.json()["article_id"] == original["article_id"]
    assert missing.json()["availability"] == "missing"
    assert missing.json()["trackable"] is False
    install_query(app, monkeypatch, unavailable)
    cached = client.post("/api/v1/articles/resolve", json={"url": path})
    assert cached.status_code == 200
    assert cached.json()["availability"] == "missing"
    assert cached.json()["metadata_status"] == "fresh"


def test_removed_alias_does_not_fall_back_to_a_former_canonical_title(env, monkeypatch):
    app, client, ids = env
    path = "https://en.wikipedia.org/wiki/Reused_title"
    original = {**canonical_page("enwiki"), "title": "Reused title", "canonicalurl": path}
    install_query(app, monkeypatch, lambda wiki, identifier: original)
    assert client.post("/api/v1/articles/resolve", json={"url": path}).status_code == 200

    def expire_mapping():
        with app.state.sessions() as db:
            alias = db.scalar(select(ArticleAlias).where(ArticleAlias.wiki == "enwiki", ArticleAlias.title == "Reused title"))
            alias.resolved_at = now() - timedelta(hours=2)
            db.commit()

    expire_mapping()
    replacement = {**canonical_page("enwiki"), "pageid": 502}
    install_query(app, monkeypatch, lambda wiki, identifier: replacement)
    assert client.post("/api/v1/articles/resolve", json={"url": path}).json()["page_id"] == 502
    expire_mapping()
    install_query(app, monkeypatch, lambda wiki, identifier: {"missing": True, "title": "Reused title"})
    assert client.post("/api/v1/articles/resolve", json={"url": path}).status_code == 404
    assert client.post("/api/v1/articles/resolve", json={"url": path}).status_code == 404


def test_expired_cache_upstream_missing_retains_id_and_refuses_tracking(env, monkeypatch):
    app, client, ids = env
    expired_at = expire_article(app, ids["article_id"])
    install_query(app, monkeypatch, lambda wiki, identifier: {"pageid": -1, "title": "Deleted fixture", "missing": True})
    response = client.post("/api/v1/articles/resolve", json={"wiki": "jawiki", "page_id": 101})
    assert response.status_code == 200
    article = response.json()
    assert article["article_id"] == ids["article_id"]
    assert article["metadata_status"] == "fresh"
    assert article["availability"] == "missing"
    assert article["trackable"] is False
    assert article["untrackable_reason"] == "missing"
    with app.state.sessions() as db:
        assert utc(db.get(Article, ids["article_id"]).resolved_at) > expired_at
    assert send(client, ids, observation(ids)).json()["results"][0]["code"] == "article_untrackable"


@pytest.mark.parametrize("missing,status,code", [
    (False, 503, "wikipedia_unavailable"),
    (True, 404, "article_not_found"),
])
def test_uncached_missing_and_upstream_failure_have_different_errors(env, monkeypatch, missing, status, code):
    app, client, ids = env
    query = (lambda wiki, identifier: {"title": "Missing fixture", "missing": True}) if missing else unavailable
    install_query(app, monkeypatch, query)
    response = client.post("/api/v1/articles/resolve", json={"url": "https://en.wikipedia.org/wiki/Uncached_fixture"})
    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    assert response.json()["error"]["retryable"] is (not missing)
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Article)) == 1


@pytest.mark.parametrize("same_alias", [False, True])
def test_postgres_concurrent_resolve_creates_one_canonical_article(env, monkeypatch, same_alias):
    app, client, ids = env
    if app.state.engine.dialect.name != "postgresql":
        pytest.skip("requires PostgreSQL unique-constraint concurrency")
    ready = Barrier(8)

    def query(wiki, identifier):
        ready.wait(timeout=15)
        return canonical_page("enwiki")

    install_query(app, monkeypatch, query)

    def resolve_alias(index):
        alias = quote("Concurrent redirect " + str(0 if same_alias else index))
        return client.post("/api/v1/articles/resolve", json={"url": "https://en.wikipedia.org/wiki/" + alias})

    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(resolve_alias, range(8)))
    assert all(response.status_code == 200 for response in responses)
    assert len({response.json()["article_id"] for response in responses}) == 1
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Article).where(Article.wiki == "enwiki", Article.page_id == 501)) == 1
        assert db.scalar(select(func.count()).select_from(ArticleAlias).where(ArticleAlias.wiki == "enwiki")) == (2 if same_alias else 9)
    install_query(app, monkeypatch, unavailable)
    cached = [resolve_alias(index) for index in range(8)]
    assert all(response.status_code == 200 for response in cached)
    assert {response.json()["article_id"] for response in cached} == {responses[0].json()["article_id"]}
