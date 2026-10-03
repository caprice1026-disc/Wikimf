import json
from datetime import timedelta

from pydantic import ValidationError
from sqlalchemy import or_, select

from .auth import digest
from .contracts import ReadingEventInput
from .db import Article, DeletionMarker, Device, ReadingEvent, ReadingInterval, ReadingSession, User, now, utc
from .projection import contradictory
from .articles import APIError

CLOCK_SKEW = timedelta(minutes=5)


def lock_user(db, user_id):
    # PostgreSQL row locks coordinate ingestion, privacy changes, deletion and revocation.
    user = db.scalar(select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True))
    if user is None:
        raise APIError("authentication_required", 401)
    return user


def accept_batch(db, user, device, batch):
    user = lock_user(db, user.id)
    device = db.scalar(select(Device).where(Device.id == device.id).execution_options(populate_existing=True))
    if not device or device.revoked_at or utc(device.expires_at) <= now():
        raise APIError("invalid_device_token", 401)
    results = []
    for item in batch.events:
        event_id = item.get("event_id") if isinstance(item.get("event_id"), str) else None
        result = {"event_id":event_id,"status":"rejected","code":None,"retryable":False}
        try:
            if len(json.dumps(item,ensure_ascii=False).encode()) > 65536:
                raise APIError("event_too_large")
            e = ReadingEventInput.model_validate(item)
            event_id = str(e.event_id)
            result["event_id"] = event_id
            if str(e.device_id) != device.id or e.source != device.source:
                raise APIError("device_mismatch")
            if e.recording_epoch != user.recording_epoch:
                raise APIError("recording_epoch_mismatch")
            if not user.collection_enabled:
                raise APIError("collection_disabled")
            at = now()
            if e.occurred_at > at+CLOCK_SKEW or e.session_started_at > at+CLOCK_SKEW or e.occurred_at < at-timedelta(days=7) or e.session_started_at < at-timedelta(days=7):
                raise APIError("invalid_event_time")
            article = db.get(Article,str(e.article_id))
            if not article or article.wiki != e.wiki or article.page_id != e.page_id:
                raise APIError("article_mismatch")
            if not article.trackable or article.availability != "available":
                raise APIError("article_untrackable")
            marker = db.scalar(select(DeletionMarker).where(DeletionMarker.user_id == user.id,DeletionMarker.article_id == article.id))
            if marker and e.session_started_at <= utc(marker.deleted_before):
                raise APIError("history_deleted")
            payload = e.model_dump(mode="json")
            payload["progress"]["covered_chunk_ids"].sort()
            payload_hash = digest(json.dumps(payload,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False))
            old = db.scalar(select(ReadingEvent).where(ReadingEvent.user_id == user.id,or_(ReadingEvent.event_id == event_id,
                            (ReadingEvent.device_id == device.id)&(ReadingEvent.session_id == str(e.session_id))&(ReadingEvent.seq == e.seq))))
            if old:
                if old.digest != payload_hash:
                    raise APIError("event_conflict")
                result["status"] = "duplicate"
            else:
                session = db.scalar(select(ReadingSession).where(ReadingSession.user_id == user.id,ReadingSession.session_id == str(e.session_id)))
                doc = e.document.model_dump(mode="json")
                if session:
                    if session.device_id != device.id or session.article_id != article.id or session.document != doc or utc(session.started_at) != e.session_started_at or session.policy_version != e.measurement_policy_version:
                        raise APIError("session_conflict")
                else:
                    session = ReadingSession(user_id=user.id,session_id=str(e.session_id),device_id=device.id,article_id=article.id,
                                             started_at=e.session_started_at,document=doc,policy_version=e.measurement_policy_version)
                    db.add(session)
                    # No ORM relationship graph: make parent insertion explicit before FK child.
                    db.flush()
                receipt = ReadingEvent(user_id=user.id,event_id=event_id,device_id=device.id,session_id=str(e.session_id),article_id=article.id,seq=e.seq,digest=payload_hash,payload=payload)
                db.add(receipt)
                db.flush()
                for a,b in e.interval.active_spans_ms:
                    db.add(ReadingInterval(event_receipt_id=receipt.id,user_id=user.id,article_id=article.id,session_id=str(e.session_id),
                                           start_at=e.interval.start_at+timedelta(milliseconds=a),end_at=e.interval.start_at+timedelta(milliseconds=b)))
                rows = list(db.scalars(select(ReadingEvent).where(ReadingEvent.user_id == user.id,ReadingEvent.session_id == str(e.session_id))))
                if contradictory(rows):
                    session.quarantined = True
                result["status"] = "quarantined" if session.quarantined else "accepted"
                result["code"] = "session_quarantined" if session.quarantined else None
        except (ValidationError,UnicodeError):
            result["code"] = "invalid_event"
        except APIError as exc:
            result["code"] = exc.code
        results.append(result)
    device.last_used_at = now()
    db.commit()  # ACK is constructed only after this transaction succeeds.
    return {"results":results,"recording_epoch":user.recording_epoch,"server_time":now().isoformat()}
