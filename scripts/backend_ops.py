"""Closed-MVP replay, retention, deletion ledger and restore safety commands."""
import argparse
import json
import sys
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"apps/backend"))
from sqlalchemy import delete,select
from wikimf.db import DeletionMarker,Device,DeviceLink,Identity,ManualState,ReadingEvent,ReadingSession,User,WebSession,database,now,utc
from wikimf.ingest import lock_user
from wikimf.projection import replay,stats


def safety_manifest(db):
    return {"format_version":1,"captured_at":now().isoformat(),"users":[{"user_id":u.id,"recording_epoch":u.recording_epoch} for u in db.scalars(select(User))],
            "deletion_markers":[{"user_id":m.user_id,"article_id":m.article_id,"deleted_before":utc(m.deleted_before).isoformat()} for m in db.scalars(select(DeletionMarker))],
            "manual_states":[{"user_id":m.user_id,"article_id":m.article_id,"state":m.state,"updated_at":utc(m.updated_at).isoformat()} for m in db.scalars(select(ManualState))]}


def apply_safety(db,manifest):
    if manifest.get("format_version")!=1:
        raise ValueError("unsupported safety manifest")
    users = {u["user_id"]:u for u in manifest["users"]}
    # Used only with API/clients stopped. All restored credentials are revoked.
    db.execute(delete(WebSession))
    db.execute(delete(DeviceLink))
    for device in db.scalars(select(Device)):
        device.revoked_at = now()
    for user in list(db.scalars(select(User))):
        lock_user(db,user.id)
        if user.id not in users:
            for model in (ReadingEvent,ReadingSession,ManualState,DeletionMarker,Identity,Device):
                db.execute(delete(model).where(model.user_id==user.id))
            db.delete(user)
            continue
        epoch = users[user.id]["recording_epoch"]
        if epoch>user.recording_epoch:
            for model in (ReadingEvent,ReadingSession,ManualState):
                db.execute(delete(model).where(model.user_id==user.id))
            user.recording_epoch = epoch
        user.collection_enabled = False
        user.profile_public = False
    for marker in manifest["deletion_markers"]:
        if not db.get(User,marker["user_id"]):
            continue
        # Conservative restore removes all backed-up records for deleted articles.
        for model in (ReadingEvent,ReadingSession,ManualState):
            db.execute(delete(model).where(model.user_id==marker["user_id"],model.article_id==marker["article_id"]))
        old = db.scalar(select(DeletionMarker).where(DeletionMarker.user_id==marker["user_id"],DeletionMarker.article_id==marker["article_id"]))
        if old is None:
            old = DeletionMarker(user_id=marker["user_id"],article_id=marker["article_id"])
            db.add(old)
        from datetime import datetime
        cutoff = datetime.fromisoformat(marker["deleted_before"])
        old.deleted_before = max(utc(old.deleted_before),cutoff) if old.deleted_before else cutoff
    # Exact current manual states prevent resurrecting a removed self-report.
    db.execute(delete(ManualState))
    for item in manifest["manual_states"]:
        if db.get(User,item["user_id"]):
            from datetime import datetime
            db.add(ManualState(user_id=item["user_id"],article_id=item["article_id"],state=item["state"],updated_at=datetime.fromisoformat(item["updated_at"])))
    db.commit()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command",choices=["rebuild","export-safety","apply-safety","cleanup"])
    parser.add_argument("--file",type=Path)
    parser.add_argument("--user-id")
    parser.add_argument("--apply",action="store_true")
    args = parser.parse_args()
    engine,factory = database()
    with factory() as db:
        if args.command=="rebuild":
            users = list(db.scalars(select(User)))
            for user in users:
                if args.user_id and args.user_id!=user.id:
                    continue
                lock_user(db,user.id)
                first = replay(db,user.id)
                second = replay(db,user.id)
                if first!=second:
                    raise RuntimeError("non-deterministic replay")
                result = stats(first)
                print(json.dumps({"user_id":user.id,"activity":result["activity"],"quarantined_count":len(first["quarantined_sessions"])}))
        elif args.command=="export-safety":
            if not args.file:
                parser.error("--file is required")
            args.file.parent.mkdir(parents=True,exist_ok=True)
            args.file.write_text(json.dumps(safety_manifest(db),ensure_ascii=False,indent=2),encoding="utf-8")
            print("Safety ledger exported; store confidentially outside the backup volume.")
        elif args.command=="apply-safety":
            if not args.file or not args.apply:
                parser.error("requires --file and --apply with API stopped")
            apply_safety(db,json.loads(args.file.read_text(encoding="utf-8")))
            print("Safety ledger applied; all credentials revoked, collection and public profiles disabled.")
        else:
            t = now()
            counts = {}
            for model,cond in [(DeviceLink,DeviceLink.expires_at<t),(WebSession,WebSession.expires_at<t)]:
                rows = list(db.scalars(select(model).where(cond)))
                counts[model.__tablename__] = len(rows)
                if args.apply:
                    for row in rows:
                        db.delete(row)
            # Retain deletion cutoffs across all older backups. Do not expire by queue age.
            db.commit()
            print(json.dumps({"apply":args.apply,"expired":counts,"event_retention":"closed validation; until owner deletion","deletion_markers":"retained until all prior backups expire"}))
    engine.dispose()


if __name__=="__main__":
    main()
