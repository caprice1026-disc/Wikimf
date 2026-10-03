import re
from datetime import timedelta
from urllib.parse import parse_qs, unquote, urlsplit

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .db import Article, now, utc

HOSTS = {"ja.wikipedia.org": "jawiki", "ja.m.wikipedia.org": "jawiki", "en.wikipedia.org": "enwiki", "en.m.wikipedia.org": "enwiki"}
LANGUAGES = {"jawiki": "ja", "enwiki": "en"}


class APIError(Exception):
    def __init__(self, code, status=400, retryable=False):
        self.code, self.status, self.retryable = code, status, retryable


def parse_article_url(url):
    if re.search(r"[\x00-\x20\\]", url) or re.search(r"%(?![0-9a-fA-F]{2})", url):
        raise APIError("invalid_article_url")
    try:
        parts = urlsplit(url)
        if parts.scheme != "https" or parts.hostname not in HOSTS or parts.username or parts.password or parts.port not in (None, 443):
            raise APIError("invalid_article_url")
        if parts.netloc.lower() not in (parts.hostname, parts.hostname + ":443"):
            raise APIError("invalid_article_url")
        query = parse_qs(parts.query, keep_blank_values=True, strict_parsing=False)
        if any(len(values) != 1 for values in query.values()):
            raise APIError("ambiguous_article_identifier")
        # Viewing mode is an independent tracking gate, regardless of namespace.
        forbidden = {"oldid", "diff", "veaction", "search", "redirect", "curtimestamp"}
        if forbidden.intersection(query) or query.get("action", ["view"])[0] not in ("view", ""):
            raise APIError("unsupported_article_mode")
        if parts.path.startswith("/wiki/"):
            title = unquote(parts.path[6:], errors="strict").replace("_", " ")
            if not title or "title" in query or "curid" in query:
                raise APIError("ambiguous_article_identifier")
            return HOSTS[parts.hostname], {"titles": title}
        if parts.path == "/w/index.php":
            title, page = query.get("title", [None])[0], query.get("curid", [None])[0]
            if bool(title) == bool(page):
                raise APIError("ambiguous_article_identifier")
            if page and (not re.fullmatch(r"[1-9][0-9]*", page) or int(page) > 2147483647):
                raise APIError("invalid_page_id")
            return HOSTS[parts.hostname], {"pageids": page} if page else {"titles": title.replace("_", " ")}
    except (ValueError, UnicodeError):
        raise APIError("invalid_article_url") from None
    raise APIError("unsupported_article_url")


def article_json(article, stale=False):
    return {"article_id": article.id, "wiki": article.wiki, "page_id": article.page_id,
            "language": LANGUAGES[article.wiki], "title": article.title,
            "canonical_url": article.canonical_url, "namespace": article.namespace,
            "trackable": article.trackable, "untrackable_reason": article.untrackable_reason,
            "availability": article.availability, "latest_revision_id": article.latest_revision_id,
            "metadata_status": "stale" if stale else "fresh", "resolved_at": utc(article.resolved_at).isoformat()}


class MediaWikiClient:
    def __init__(self, user_agent="wikimf/0.1 (private development; https://github.com/caprice1026-disc/Wikimf)"):
        self.user_agent = user_agent

    def query(self, wiki, identifier):
        params = {"action": "query", "format": "json", "formatversion": 2,
                  "prop": "info|pageprops|revisions", "inprop": "url", "rvprop": "ids", "redirects": "1", **identifier}
        try:
            with httpx.Client(timeout=8, follow_redirects=False, trust_env=False) as client:
                response = client.get(f"https://{LANGUAGES[wiki]}.wikipedia.org/w/api.php", params=params, headers={"User-Agent": self.user_agent})
                response.raise_for_status()
                data = response.json()
            if "error" in data:
                raise APIError("wikipedia_unavailable", 503, True)
            pages = data.get("query", {}).get("pages", [])
            if len(pages) != 1:
                raise APIError("wikipedia_unavailable", 503, True)
            return pages[0]
        except (httpx.HTTPError, ValueError, KeyError):
            raise APIError("wikipedia_unavailable", 503, True) from None


def resolve(db, client, data):
    wiki, identifier = parse_article_url(data.url) if data.url else (data.wiki, {"pageids": str(data.page_id)})
    cached = db.scalar(select(Article).where(Article.wiki == wiki, Article.page_id == int(identifier["pageids"]))) if "pageids" in identifier else db.scalar(select(Article).where(Article.wiki == wiki, Article.title == identifier["titles"]))
    if cached and utc(cached.resolved_at) > now() - timedelta(hours=1):
        return article_json(cached)
    try:
        page = client.query(wiki, identifier)  # No user/event lock is held over this request.
    except APIError:
        if cached:
            return article_json(cached, stale=True)
        raise
    if "missing" in page or page.get("pageid", -1) <= 0:
        if cached:
            cached.availability, cached.trackable, cached.untrackable_reason = "missing", False, "missing"
            cached.resolved_at = now()
            db.commit()
            return article_json(cached)
        raise APIError("article_not_found", 404)
    props = page.get("pageprops", {})
    reason = "namespace" if page.get("ns") != 0 else "disambiguation" if "disambiguation" in props else "main_page" if "mainpage" in props else None
    canonical_url = page.get("canonicalurl") or page.get("fullurl")
    # Never forward arbitrary upstream URLs to readers or accept an external alias.
    if not canonical_url:
        raise APIError("wikipedia_unavailable", 503, True)
    canonical_wiki, _ = parse_article_url(canonical_url)
    if canonical_wiki != wiki:
        raise APIError("wikipedia_unavailable", 503, True)
    article = db.scalar(select(Article).where(Article.wiki == wiki, Article.page_id == page["pageid"]))
    if article is None:
        article = Article(wiki=wiki, page_id=page["pageid"])
        db.add(article)
    article.title, article.canonical_url, article.namespace = page["title"], canonical_url, page["ns"]
    article.trackable, article.untrackable_reason, article.availability = reason is None, reason, "available"
    article.latest_revision_id = (page.get("revisions") or [{}])[0].get("revid")
    article.resolved_at = now()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        article = db.scalar(select(Article).where(Article.wiki == wiki, Article.page_id == page["pageid"]))
        if not article:
            raise
    return article_json(article)
