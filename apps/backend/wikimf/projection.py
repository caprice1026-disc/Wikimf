"""Deterministic replay from immutable events, preserving receipt-order attribution."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select

from .articles import article_json
from .db import Article, ManualState, ReadingEvent, ReadingInterval, ReadingSession, now, utc

RANK = {None: 0, "viewed": 1, "partial": 2, "completed": 3}
RATES = {"jawiki": 600, "enwiki": 1000}


def stamp(value):
    return round(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def iso(value):
    return datetime.fromtimestamp(value / 1000, timezone.utc).isoformat()


def union(spans):
    result = []
    for a, b in sorted(spans):
        if a >= b:
            continue
        if result and a <= result[-1][1]:
            result[-1] = (result[-1][0], max(b, result[-1][1]))
        else:
            result.append((a, b))
    return result


def subtract(span, occupied):
    a, b = span
    result = []
    for x, y in occupied:
        if y <= a:
            continue
        if x >= b:
            break
        if x > a:
            result.append((a, min(x, b)))
        a = max(a, y)
        if a >= b:
            break
    if a < b:
        result.append((a, b))
    return result


def infer(document, covered, active_ms, wiki):
    n = document["text_chars"]
    if n:
        c = sum(document["chunk_chars"][i] for i in covered)
        # Integer comparisons avoid rounding at 80% and time boundaries.
        if c * 5 >= n * 4 and active_ms >= 30000 and active_ms * RATES[wiki] >= 60000 * n * 4 // 5:
            return "completed"
        if active_ms >= 30000 and c >= min(200, n):
            return "partial"
    return "viewed" if active_ms >= 10000 else None


def contradictory(events):
    previous = None
    covered = set()
    for row in sorted(events, key=lambda row: row.seq):
        p, e = row.payload["progress"], row.payload
        current = set(p["covered_chunk_ids"])
        if not covered.issubset(current):
            return True
        total = p["active_ms_total"]
        if total > stamp(e["occurred_at"]) - stamp(e["session_started_at"]):
            return True
        if previous:
            old = previous.payload["progress"]["active_ms_total"]
            interval_active = sum(b-a for a,b in e["interval"]["active_spans_ms"])
            if total < old or total-old < interval_active:
                return True
            if row.seq == previous.seq + 1 and total-old != interval_active:
                return True
            if stamp(e["interval"]["start_at"]) < stamp(previous.payload["interval"]["end_at"]):
                return True
        previous, covered = row, current
    return False


def replay(db, user_id):
    rows = list(db.scalars(select(ReadingEvent).where(ReadingEvent.user_id == user_id).order_by(ReadingEvent.id)))
    sessions = {s.session_id: s for s in db.scalars(select(ReadingSession).where(ReadingSession.user_id == user_id))}
    groups = defaultdict(list)
    for row in rows:
        groups[row.session_id].append(row)
    valid = {key for key, s in sessions.items() if not s.quarantined and not contradictory(groups[key])}
    occupied, allocations = [], {}
    raw_intervals = defaultdict(list)
    for interval in db.scalars(select(ReadingInterval).where(ReadingInterval.user_id == user_id)):
        raw_intervals[interval.event_receipt_id].append((round(utc(interval.start_at).timestamp()*1000), round(utc(interval.end_at).timestamp()*1000)))
    for row in rows:
        if row.session_id not in valid:
            continue
        e = row.payload
        assigned = []
        for span in sorted(raw_intervals[row.id]):
            assigned.extend(subtract(span, occupied))
        allocations[row.id] = assigned
        occupied = union(occupied + assigned)
    articles = {a.id: a for a in db.scalars(select(Article).where(Article.id.in_({s.article_id for s in sessions.values()} or {""})))}
    activities, spans, increments = [], [], []
    for key in valid:
        s, events = sessions[key], groups[key]
        a = articles[s.article_id]
        doc = s.document
        active_ms = sum(b-a for row in events for a,b in allocations.get(row.id, []))
        covered = set(i for row in events for i in row.payload["progress"]["covered_chunk_ids"])
        state = infer(doc, covered, active_ms, a.wiki)
        expected = max((r.payload["progress"]["active_ms_total"] for r in events), default=0)
        raw_time = sum(b-a for a,b in union([(stamp(row.payload["interval"]["start_at"])+x,stamp(row.payload["interval"]["start_at"])+y) for row in events for x,y in row.payload["interval"]["active_spans_ms"]]))
        chars = min(sum(doc["chunk_chars"][i] for i in covered), active_ms * RATES[a.wiki] // 60000) if doc["text_chars"] else 0
        item = {"session_id": key, "article": article_json(a), "article_id": a.id,
                "source": events[0].payload["source"], "session_started_at": iso(stamp(events[0].payload["session_started_at"])),
                "state": state, "evidence": "inferred", "active_ms": active_ms, "estimated_read_chars": chars,
                "coverage": sum(doc["chunk_chars"][i] for i in covered)/doc["text_chars"] if doc["text_chars"] else None,
                "measurement_status": "ok" if doc["text_chars"] else "time_only", "pending_sync": expected > raw_time,
                "quarantined": False, "judgement_policy_version": s.policy_version}
        if state:
            activities.append(item)
        elapsed, seen = 0, set()
        for row in sorted(events, key=lambda r: (stamp(r.payload["occurred_at"]), r.id)):
            assigned = allocations.get(row.id, [])
            elapsed += sum(b-a for a,b in assigned)
            seen.update(row.payload["progress"]["covered_chunk_ids"])
            if state:
                for x,y in assigned:
                    spans.append((x,y,a.id,a.wiki,key))
            if state and doc["text_chars"]:
                estimate = min(sum(doc["chunk_chars"][i] for i in seen), elapsed * RATES[a.wiki] // 60000)
                increments.append((stamp(row.payload["occurred_at"]),row.id,a.id,a.wiki,estimate))
    maxima, char_increments = {}, []
    for t, receipt, article_id, wiki, estimate in sorted(increments):
        before = maxima.get(article_id, 0)
        if estimate > before:
            char_increments.append((t,article_id,wiki,estimate-before))
            maxima[article_id] = estimate
    records = {}
    for activity in activities:
        key = activity["article_id"]
        if key not in records:
            records[key] = {"article": activity["article"], "article_id": key, "inferred_state": None, "manual_state": None,
                            "active_ms": 0, "estimated_read_chars": 0, "coverage": None, "last_read_at": None, "activity_count": 0, "pending_sync": False}
        rec = records[key]
        if RANK[activity["state"]] > RANK[rec["inferred_state"]]:
            rec["inferred_state"] = activity["state"]
        rec["estimated_read_chars"] = maxima.get(key, 0)
        rec["coverage"] = max(rec["coverage"] or 0, activity["coverage"] or 0) if activity["coverage"] is not None else rec["coverage"]
        rec["activity_count"] += 1
        rec["pending_sync"] |= activity["pending_sync"]
        rec["last_read_at"] = max(rec["last_read_at"] or "", activity["session_started_at"])
    # All accepted time, including short non-qualified sessions, has one attribution.
    for x,y,key,wiki,session_key in spans:
        if key in records:
            records[key]["active_ms"] += y-x
    for manual in db.scalars(select(ManualState).where(ManualState.user_id == user_id)):
        if manual.article_id not in records:
            article = db.get(Article, manual.article_id)
            records[manual.article_id] = {"article": article_json(article), "article_id": article.id, "inferred_state": None,
                                        "active_ms": 0,"estimated_read_chars":0,"coverage":None,"last_read_at":None,"activity_count":0,"pending_sync":False}
        records[manual.article_id]["manual_state"] = manual.state
    for record in records.values():
        record.setdefault("manual_state", None)
        record["effective_state"] = record["manual_state"] or record["inferred_state"]
        record["evidence"] = "self_reported" if record["manual_state"] else "inferred"
    return {"records": list(records.values()), "activities": activities, "spans": spans, "increments": char_increments,
            "quarantined_sessions": [key for key in sessions if key not in valid]}


def stats(projection, start=None, end=None, wiki=None, tz="Asia/Tokyo"):
    lower = round(start.timestamp()*1000) if start else -10**16
    upper = round(end.timestamp()*1000) if end else 10**16
    records = [r for r in projection["records"] if not wiki or r["article"]["wiki"] == wiki]
    activities = [a for a in projection["activities"] if lower <= stamp(a["session_started_at"]) < upper and (not wiki or a["article"]["wiki"] == wiki)]
    by_wiki = {w:{"activity_count":sum(a["article"]["wiki"] == w for a in activities),"active_ms":0,"estimated_unique_read_chars":0} for w in RATES}
    days = defaultdict(lambda:{"active_ms":0,"estimated_unique_read_chars":0})
    zone = ZoneInfo(tz)
    for x,y,aid,w,session_id in projection["spans"]:
        if wiki and wiki != w:
            continue
        x,y = max(x,lower),min(y,upper)
        if x >= y:
            continue
        by_wiki[w]["active_ms"] += y-x
        while x < y:
            local = datetime.fromtimestamp(x/1000, timezone.utc).astimezone(zone)
            next_date = local.date()+timedelta(days=1)
            boundary = round(datetime.combine(next_date,datetime.min.time(),tzinfo=zone).timestamp()*1000)
            stop = min(boundary,y)
            days[local.date().isoformat()]["active_ms"] += stop-x
            x = stop
    for t,aid,w,value in projection["increments"]:
        if lower <= t < upper and (not wiki or wiki == w):
            by_wiki[w]["estimated_unique_read_chars"] += value
            date = datetime.fromtimestamp(t/1000,timezone.utc).astimezone(zone).date().isoformat()
            days[date]["estimated_unique_read_chars"] += value
    counts = {s:sum(r["effective_state"] == s for r in records) for s in ("viewed","partial","completed")}
    return {"library":{"recorded_article_count":len(records),"qualified_article_count":sum(r["inferred_state"] is not None for r in records),"state_counts":counts,
                       "completed_inferred_count":sum(r["effective_state"] == "completed" and r["evidence"] == "inferred" for r in records),
                       "completed_self_reported_count":sum(r["effective_state"] == "completed" and r["evidence"] == "self_reported" for r in records)},
            "activity":{"activity_count":len(activities),"qualified_article_count":len({a["article_id"] for a in activities}),
                        "active_ms":sum(v["active_ms"] for v in by_wiki.values()),"estimated_unique_read_chars":sum(v["estimated_unique_read_chars"] for v in by_wiki.values())},
            "by_wiki":by_wiki,"daily":[{"date":d,**v} for d,v in sorted(days.items())],"pending_recalculation":False,"as_of":now().isoformat(),"timezone":tz}


def achievements(projection):
    summary = stats(projection)
    values = [("footprints","読書の足跡","自動閲覧10記事",summary["library"]["qualified_article_count"],10),
              ("reading-hour","継続した読書","アクティブ時間60分",summary["activity"]["active_ms"],3600000),
              ("two-languages","二つの言語","日英それぞれ1件の読書活動",sum(summary["by_wiki"][w]["activity_count"]>0 for w in RATES),2)]
    return [{"id":key,"name":name,"description":desc,"earned":value>=target,"progress":value,"target":target} for key,name,desc,value,target in values]
