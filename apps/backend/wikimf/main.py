import base64
import json
import os
import secrets
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from authlib.integrations.base_client.errors import OAuthError
from fastapi import Depends, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError
from starlette.middleware.sessions import SessionMiddleware

from .articles import APIError, MediaWikiClient, article_json, resolve
from .auth import COOKIE, authenticate, configure_oauth, digest, identify, issue_web_session, token
from .contracts import BatchGet, DeleteAccount, EventBatch, PairApproval, PairExchange, PairInput, PrivacyInput, ResolveInput, StateInput
from .db import Article, Base, DeletionMarker, Device, DeviceLink, Identity, ManualState, ReadingEvent, ReadingSession, User, WebSession, database, now, utc
from .ingest import accept_batch, lock_user
from .projection import achievements, replay, stamp, stats

PREFIX = "/api/v1"


def create_app(database_url=None, mediawiki=None):
    app = FastAPI(title="wikimf",version="0.1.0")
    engine, factory = database(database_url)
    app.state.engine, app.state.sessions = engine, factory
    app.state.mediawiki = mediawiki or MediaWikiClient(os.getenv("WIKIMEDIA_USER_AGENT", "wikimf/0.1 (https://github.com/caprice1026-disc/Wikimf)"))
    production = os.getenv("ENVIRONMENT", "development") == "production"
    api_origin = os.getenv("API_ORIGIN", "http://localhost:8000").rstrip("/")
    dashboard = os.getenv("DASHBOARD_ORIGIN", "http://localhost:5173").rstrip("/")
    if production and (not api_origin.startswith("https://") or not dashboard.startswith("https://") or not os.getenv("SESSION_SECRET") or engine.dialect.name != "postgresql"):
        raise RuntimeError("production requires HTTPS origins, SESSION_SECRET and PostgreSQL")
    oauth = configure_oauth()
    app.state.oauth = oauth
    app.add_middleware(SessionMiddleware,secret_key=os.getenv("SESSION_SECRET") or token(),session_cookie="wikimf_oauth",max_age=600,same_site="lax",https_only=production)
    app.add_middleware(CORSMiddleware,allow_origins=[dashboard],allow_credentials=True,allow_methods=["GET","POST","PUT","PATCH","DELETE"],allow_headers=["Content-Type","Authorization","X-CSRF-Token"])
    throttles = defaultdict(list)

    def throttle(request, action, limit=30, window=60):
        # ponytail: process-local abuse limit; front proxy must limit aggregate traffic with multiple workers.
        key = (request.client.host if request.client else "unknown",action)
        t = time.monotonic()
        values = [v for v in throttles[key] if v > t-window]
        throttles[key] = values
        if len(values) >= limit:
            raise APIError("rate_limited",429,True)
        values.append(t)
        if len(throttles)>10000:
            for old in list(throttles):
                if not throttles[old] or throttles[old][-1] <= t-window:
                    del throttles[old]

    def db_session():
        with factory() as session:
            yield session

    @app.middleware("http")
    async def boundaries(request, call_next):
        request.state.request_id = secrets.token_hex(12)
        if request.method not in ("GET","HEAD","OPTIONS"):
            body = await request.body()
            if len(body)>262144:
                return error_response(request,APIError("request_too_large",413))
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        return response

    def error_response(request, exc):
        return JSONResponse(status_code=exc.status,content={"error":{"code":exc.code,"message":"操作を完了できませんでした。","retryable":exc.retryable,"request_id":getattr(request.state,"request_id",None)}})

    @app.exception_handler(APIError)
    async def api_error(request, exc):
        return error_response(request,exc)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return error_response(request,APIError("invalid_request",422))

    @app.exception_handler(Exception)
    async def internal_error(request, exc):
        return error_response(request,APIError("internal_error",500,True))

    @app.get("/health")
    def health(db=Depends(db_session)):
        try:
            db.execute(text("SELECT 1"))
        except Exception:
            raise APIError("database_unavailable",503,True) from None
        return {"status":"ok","schema_version":1,"measurement_policy_version":"reading-v1"}

    @app.get(PREFIX+"/config")
    def public_config():
        return {"dashboard_url":dashboard}

    def user_json(user, device=None, web=None):
        return {"user_id":user.id,"display_name":user.display_name,"timezone":user.timezone,"recording_epoch":user.recording_epoch,
                "collection_enabled":user.collection_enabled,"csrf_token":web.csrf_token if web else None,"device_id":device.id if device else None}

    @app.get(PREFIX+"/auth/{provider}/start")
    async def oauth_start(provider, request: Request):
        throttle(request,"oauth",10)
        client = oauth.create_client(provider) if provider in ("google","github") else None
        if not client:
            raise APIError("provider_not_configured",503)
        return_to = request.query_params.get("return_to", "/home")
        target = urlsplit(return_to)
        allowed = target.path in ("/home", "/app", "/device-link") or target.path.startswith(("/link-device/","/device-link/","/app/"))
        if len(return_to)>2000 or target.scheme or target.netloc or target.fragment or not allowed:
            raise APIError("invalid_return_url")
        if "\\" in return_to or "//" in return_to or any(ord(c)<32 for c in return_to) or {"token","device_secret","code"}.intersection(parse_qs(target.query)):
            raise APIError("invalid_return_url")
        intent = request.session.pop("link_intent",None)
        link_user_id = None
        supplied_intent = request.query_params.get("link")
        if supplied_intent:
            if not intent or intent["provider"]!=provider or time.time()-intent["created_at"]>600 or not secrets.compare_digest(supplied_intent,intent["nonce"]):
                raise APIError("invalid_identity_link",400)
            link_user_id = intent["user_id"]
        state = token()
        flows = {key:value for key,value in request.session.get("oauth_flows",{}).items() if time.time()-value["started_at"]<600}
        if len(flows)>=4:
            raise APIError("too_many_oauth_flows",429)
        flows[state] = {"provider":provider,"link_user_id":link_user_id,"return_to":return_to,"started_at":time.time()}
        request.session["oauth_flows"] = flows
        return await client.authorize_redirect(request,api_origin+PREFIX+f"/auth/{provider}/callback",state=state,code_verifier=secrets.token_urlsafe(48))

    @app.get(PREFIX+"/auth/{provider}/callback")
    async def oauth_callback(provider, request: Request, db=Depends(db_session)):
        client = oauth.create_client(provider) if provider in ("google","github") else None
        state = request.query_params.get("state","")
        flows = request.session.get("oauth_flows",{})
        flow = flows.pop(state,None)
        request.session["oauth_flows"] = flows
        if not client or not flow or flow["provider"]!=provider or time.time()-flow["started_at"]>600:
            raise APIError("oauth_invalid_state",400)
        try:
            grant = await client.authorize_access_token(request)
            if provider == "google":
                info = grant.get("userinfo")
                if not info or not info.get("sub"):
                    raise APIError("oauth_invalid_identity",400)
                subject,name = str(info["sub"]),info.get("name","Reader")
            else:
                response = await client.get("user",token=grant,headers={"Accept":"application/vnd.github+json"})
                response.raise_for_status()
                info = response.json()
                if not isinstance(info.get("id"),int):
                    raise APIError("oauth_invalid_identity",400)
                subject,name = str(info["id"]),info.get("name") or info.get("login") or "Reader"
        except (OAuthError,httpx.HTTPError,ValueError):
            raise APIError("oauth_failed",400) from None
        link_user_id = flow["link_user_id"]
        if link_user_id:
            current,_,_ = authenticate(request,db,web_only=True)
            if current.id != link_user_id:
                raise APIError("identity_link_session_changed",403)
            lock_user(db,current.id)
        try:
            user = identify(db,provider,subject,name,link_user_id)
            old_secret = request.cookies.get(COOKIE)
            if old_secret:
                db.execute(delete(WebSession).where(WebSession.token_hash == digest(old_secret)))
            secret,session = issue_web_session(db,user.id)
            db.commit()
        except IntegrityError:
            db.rollback()
            raise APIError("identity_conflict",409) from None
        return_to = flow["return_to"]
        response = RedirectResponse(dashboard+return_to,status_code=303)
        response.set_cookie(COOKIE,secret,max_age=7*86400,httponly=True,secure=production,samesite="lax",path="/")
        return response

    @app.post(PREFIX+"/auth/logout")
    def logout(request: Request,db=Depends(db_session)):
        user,device,web = authenticate(request,db,web_only=True)
        db.delete(web)
        db.commit()
        response = JSONResponse({"logged_out":True})
        response.delete_cookie(COOKIE,path="/")
        return response

    @app.get(PREFIX+"/me")
    def me(request: Request,db=Depends(db_session)):
        return user_json(*authenticate(request,db,scope="profile:read"))

    @app.get(PREFIX+"/me/recording-control")
    def controls(request: Request,db=Depends(db_session)):
        user,device,web = authenticate(request,db)
        markers = db.scalars(select(DeletionMarker).where(DeletionMarker.user_id == user.id))
        return {"user_id":user.id,"device_id":device.id if device else None,"recording_epoch":user.recording_epoch,"collection_enabled":user.collection_enabled,
                "deletion_markers":[{"article_id":m.article_id,"deleted_before":utc(m.deleted_before).isoformat()} for m in markers]}

    @app.post(PREFIX+"/device-links")
    def start_link(data: PairInput,request: Request,db=Depends(db_session)):
        throttle(request,"pair",10,300)
        secret = token()
        link = DeviceLink(source=data.source,display_name=data.display_name,secret_hash=digest(secret),
                          user_code=secrets.token_hex(4).upper(),expires_at=now()+timedelta(minutes=5))
        db.add(link)
        db.commit()
        return {"link_id":link.id,"device_secret":secret,"user_code":link.user_code,"verification_url":dashboard+"/link-device/"+link.id,
                "expires_at":utc(link.expires_at).isoformat(),"poll_interval_seconds":5}

    def get_link(db,link_id):
        link = db.scalar(select(DeviceLink).where(DeviceLink.id == str(link_id)).with_for_update())
        if not link or utc(link.expires_at)<=now() or link.exchanged:
            raise APIError("device_link_expired",410)
        return link

    @app.get(PREFIX+"/device-links/{link_id}")
    def view_link(link_id: UUID,request: Request,db=Depends(db_session)):
        authenticate(request,db,web_only=True)
        link = get_link(db,link_id)
        return {"link_id":link.id,"display_name":link.display_name,"source":link.source,"user_code":link.user_code,
                "scopes":["reading:write","reading:read","profile:read"],"expires_at":utc(link.expires_at).isoformat(),"approved":link.user_id is not None}

    @app.post(PREFIX+"/device-links/{link_id}/approve")
    def approve_link(link_id: UUID,data: PairApproval,request: Request,db=Depends(db_session)):
        user,_,_ = authenticate(request,db,web_only=True)
        user = lock_user(db,user.id)
        link = get_link(db,link_id)
        if link.user_id and link.user_id != user.id:
            raise APIError("device_link_already_approved",409)
        if not secrets.compare_digest(data.user_code.upper(),link.user_code):
            link.attempts += 1
            if link.attempts >= 5:
                link.expires_at = now()
            db.commit()
            raise APIError("invalid_user_code",400)
        link.user_id = user.id
        db.commit()
        return {"approved":True}

    @app.post(PREFIX+"/device-links/{link_id}/exchange")
    def exchange_link(link_id: UUID,data: PairExchange,request: Request,db=Depends(db_session)):
        throttle(request,"exchange",30)
        link = get_link(db,link_id)
        if not secrets.compare_digest(digest(data.device_secret),link.secret_hash):
            link.attempts += 1
            if link.attempts >= 5:
                link.expires_at = now()
            db.commit()
            raise APIError("invalid_device_secret",403)
        if link.last_polled_at and now()-utc(link.last_polled_at)<timedelta(seconds=5):
            raise APIError("slow_down",429,True)
        link.last_polled_at = now()
        if not link.user_id:
            db.commit()
            raise APIError("authorization_pending",409,True)
        user = db.get(User,link.user_id)
        if not user:
            raise APIError("authentication_required",401)
        secret = token()
        device = Device(user_id=user.id,source=link.source,display_name=link.display_name,token_hash=digest(secret),expires_at=now()+timedelta(days=90))
        db.add(device)
        link.exchanged = True
        db.commit()
        return {"token":secret,"user_id":user.id,"device_id":device.id,"recording_epoch":user.recording_epoch,"display_name":user.display_name}

    @app.get(PREFIX+"/me/identities")
    def identities(request: Request,db=Depends(db_session)):
        user,_,_ = authenticate(request,db,web_only=True)
        return {"items":[{"provider":i.provider,"linked_at":utc(i.linked_at).isoformat()} for i in db.scalars(select(Identity).where(Identity.user_id == user.id))]}

    @app.post(PREFIX+"/me/identities/{provider}/link")
    def link_identity(provider,request: Request,db=Depends(db_session)):
        user,_,_ = authenticate(request,db,web_only=True)
        if provider not in ("google","github") or not oauth.create_client(provider):
            raise APIError("provider_not_configured",503)
        user = lock_user(db,user.id)
        if db.scalar(select(Identity).where(Identity.user_id == user.id,Identity.provider == provider)):
            raise APIError("provider_already_linked",409)
        nonce = token()
        request.session["link_intent"] = {"user_id":user.id,"provider":provider,"nonce":nonce,"created_at":time.time()}
        return {"authorization_url":api_origin+PREFIX+f"/auth/{provider}/start?link="+nonce}

    @app.delete(PREFIX+"/me/identities/{provider}")
    def unlink_identity(provider,request: Request,db=Depends(db_session)):
        user,_,_ = authenticate(request,db,web_only=True)
        lock_user(db,user.id)
        items = list(db.scalars(select(Identity).where(Identity.user_id == user.id)))
        matches = [i for i in items if i.provider == provider]
        if not matches:
            raise APIError("identity_not_found",404)
        if len(matches)==len(items):
            raise APIError("last_identity",409)
        for identity in matches:
            db.delete(identity)
        db.commit()
        return {"unlinked":True}

    @app.get(PREFIX+"/me/devices")
    def devices(request: Request,db=Depends(db_session)):
        user,_,_ = authenticate(request,db,web_only=True)
        return {"items":[{"device_id":d.id,"display_name":d.display_name,"source":d.source,"created_at":utc(d.created_at).isoformat(),
                          "expires_at":utc(d.expires_at).isoformat(),"last_used_at":utc(d.last_used_at).isoformat() if d.last_used_at else None,"revoked":d.revoked_at is not None} for d in db.scalars(select(Device).where(Device.user_id == user.id))]}

    @app.delete(PREFIX+"/me/devices/{device_id}")
    def revoke(device_id: UUID,request: Request,db=Depends(db_session)):
        user,_,_ = authenticate(request,db,web_only=True)
        lock_user(db,user.id)
        device = db.scalar(select(Device).where(Device.id == str(device_id),Device.user_id == user.id))
        if not device:
            raise APIError("device_not_found",404)
        device.revoked_at = now()
        db.commit()
        return {"revoked":True}

    @app.post(PREFIX+"/articles/resolve")
    def resolve_article(data: ResolveInput,request: Request,db=Depends(db_session)):
        throttle(request,"resolve",60)
        return resolve(db,app.state.mediawiki,data)

    @app.get(PREFIX+"/articles/{article_id}")
    def get_article(article_id: UUID,db=Depends(db_session)):
        article = db.get(Article,str(article_id))
        if not article:
            raise APIError("article_not_found",404)
        return article_json(article,utc(article.resolved_at)<now()-timedelta(hours=1))

    @app.get(PREFIX+"/wikis/{wiki}/pages/{page_id}")
    def get_page(wiki:str,page_id:int,request: Request,db=Depends(db_session)):
        throttle(request,"resolve",60)
        if wiki not in ("jawiki","enwiki") or not 0<page_id<=2147483647:
            raise APIError("invalid_article_identifier")
        return resolve(db,app.state.mediawiki,ResolveInput(wiki=wiki,page_id=page_id))

    @app.post(PREFIX+"/articles/batch-get")
    def batch_get(data:BatchGet,db=Depends(db_session)):
        rows = {a.id:a for a in db.scalars(select(Article).where(Article.id.in_([str(x) for x in data.article_ids])))}
        return {"items":[article_json(rows[str(x)]) for x in data.article_ids if str(x) in rows]}

    @app.post(PREFIX+"/reading-events/batch")
    def reading_batch(data: EventBatch,request: Request,db=Depends(db_session)):
        user,device,_ = authenticate(request,db,scope="reading:write")
        if not device:
            raise APIError("device_token_required",403)
        return accept_batch(db,user,device,data)

    def period(start,end):
        for d in (start,end):
            if d and (d.tzinfo is None or d.utcoffset().total_seconds()!=0):
                raise APIError("invalid_period")
        if start and end and start>=end:
            raise APIError("invalid_period")

    def paginated(items,cursor,limit,key):
        items.sort(key=key,reverse=True)
        if cursor:
            try:
                point = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
                items = [item for item in items if list(key(item))<point]
            except (ValueError,TypeError,UnicodeError):
                raise APIError("invalid_cursor") from None
        selected = items[:limit]
        next_cursor = base64.urlsafe_b64encode(json.dumps(key(selected[-1])).encode()).decode() if len(items)>limit else None
        return {"items":selected,"next_cursor":next_cursor}

    @app.get(PREFIX+"/me/articles")
    def library(request: Request,wiki:str|None=None,state:str|None=None,query:str|None=Query(None,max_length=200),sort:str="last_read",cursor:str|None=None,limit:int=Query(50,ge=1,le=100),db=Depends(db_session)):
        user,_,_ = authenticate(request,db)
        if wiki not in (None,"jawiki","enwiki") or state not in (None,"viewed","partial","completed") or sort not in ("last_read","active_ms","title"):
            raise APIError("invalid_filter")
        items = [r for r in replay(db,user.id)["records"] if (not wiki or r["article"]["wiki"] == wiki) and (not state or r["effective_state"] == state) and (not query or query.casefold() in r["article"]["title"].casefold())]
        key = (lambda r:(r["active_ms"],r["article_id"])) if sort == "active_ms" else (lambda r:(r["article"]["title"],r["article_id"])) if sort == "title" else (lambda r:(r["last_read_at"] or "",r["article_id"]))
        return paginated(items,cursor,limit,key)

    @app.get(PREFIX+"/me/activities")
    def activity(request: Request,wiki:str|None=None,source:str|None=None,from_:datetime|None=Query(None,alias="from"),to:datetime|None=None,cursor:str|None=None,limit:int=Query(50,ge=1,le=100),db=Depends(db_session)):
        user,_,_ = authenticate(request,db)
        period(from_,to)
        if wiki not in (None,"jawiki","enwiki") or source not in (None,"android_reader","chrome_extension"):
            raise APIError("invalid_filter")
        items = [a for a in replay(db,user.id)["activities"] if (not wiki or a["article"]["wiki"]==wiki) and (not source or a["source"]==source) and (not from_ or stamp(a["session_started_at"])>=from_.timestamp()*1000) and (not to or stamp(a["session_started_at"])<to.timestamp()*1000)]
        return paginated(items,cursor,limit,lambda a:(a["session_started_at"],a["session_id"]))

    @app.get(PREFIX+"/me/articles/{article_id}")
    def record(article_id:UUID,request:Request,db=Depends(db_session)):
        user,_,_ = authenticate(request,db)
        projected = replay(db,user.id)
        rec = next((r for r in projected["records"] if r["article_id"]==str(article_id)),None)
        if not rec:
            raise APIError("record_not_found",404)
        return {**rec,"activities":[a for a in projected["activities"] if a["article_id"]==str(article_id)]}

    @app.put(PREFIX+"/me/articles/{article_id}/state")
    def set_state(article_id:UUID,data:StateInput,request:Request,db=Depends(db_session)):
        user,_,_ = authenticate(request,db,web_only=True)
        lock_user(db,user.id)
        article = db.get(Article,str(article_id))
        if not article:
            raise APIError("article_not_found",404)
        state = db.scalar(select(ManualState).where(ManualState.user_id==user.id,ManualState.article_id==article.id))
        if not state:
            state = ManualState(user_id=user.id,article_id=article.id,state=data.state)
            db.add(state)
        state.state,state.updated_at = data.state,now()
        db.commit()
        return record(article_id,request,db)

    @app.delete(PREFIX+"/me/articles/{article_id}/state")
    def restore_auto(article_id:UUID,request:Request,db=Depends(db_session)):
        user,_,_ = authenticate(request,db,web_only=True)
        lock_user(db,user.id)
        db.execute(delete(ManualState).where(ManualState.user_id==user.id,ManualState.article_id==str(article_id)))
        db.commit()
        return {"restored":True}

    @app.get(PREFIX+"/me/stats")
    def get_stats(request:Request,from_:datetime|None=Query(None,alias="from"),to:datetime|None=None,wiki:str|None=None,timezone:str|None=None,db=Depends(db_session)):
        user,_,_ = authenticate(request,db)
        period(from_,to)
        tz = timezone or user.timezone
        try:
            ZoneInfo(tz)
        except (ZoneInfoNotFoundError,ValueError):
            raise APIError("invalid_timezone") from None
        if wiki not in (None,"jawiki","enwiki"):
            raise APIError("invalid_filter")
        return stats(replay(db,user.id),from_,to,wiki,tz)

    @app.get(PREFIX+"/me/achievements")
    def get_achievements(request:Request,db=Depends(db_session)):
        user,_,_ = authenticate(request,db)
        return {"items":achievements(replay(db,user.id))}

    def privacy_json(user):
        return {key:getattr(user,key) for key in ("collection_enabled","consent_version","profile_public","publish_total_time","publish_achievements","timezone","display_name")}

    @app.get(PREFIX+"/me/privacy")
    def privacy(request:Request,db=Depends(db_session)):
        user,_,_ = authenticate(request,db,web_only=True)
        return privacy_json(user)

    @app.patch(PREFIX+"/me/privacy")
    def patch_privacy(data:PrivacyInput,request:Request,db=Depends(db_session)):
        user,_,_ = authenticate(request,db,web_only=True)
        user = lock_user(db,user.id)
        updates = data.model_dump(exclude_unset=True)
        if any(v is None for v in updates.values()):
            raise APIError("invalid_privacy_settings")
        if updates.get("collection_enabled") and (updates.get("consent_version") or user.consent_version)!="privacy-v1":
            raise APIError("consent_required")
        if "timezone" in updates:
            try:
                ZoneInfo(updates["timezone"])
            except (ZoneInfoNotFoundError,ValueError):
                raise APIError("invalid_timezone") from None
        for key,value in updates.items():
            setattr(user,key,value)
        db.commit()
        return privacy_json(user)

    def clear_history(db,user_id,article_id=None):
        for model in (ReadingEvent,ReadingSession,ManualState):
            stmt = delete(model).where(model.user_id==user_id)
            if article_id:
                stmt = stmt.where(model.article_id==article_id)
            db.execute(stmt)

    @app.delete(PREFIX+"/me/articles/{article_id}/history")
    def delete_article_history(article_id:UUID,request:Request,db=Depends(db_session)):
        user,_,_ = authenticate(request,db,web_only=True)
        user = lock_user(db,user.id)
        article = db.get(Article,str(article_id))
        if not article:
            raise APIError("article_not_found",404)
        clear_history(db,user.id,article.id)
        marker = db.scalar(select(DeletionMarker).where(DeletionMarker.user_id==user.id,DeletionMarker.article_id==article.id))
        if not marker:
            marker = DeletionMarker(user_id=user.id,article_id=article.id)
            db.add(marker)
        # Cover every pre-delete observation accepted within the clock-skew window.
        from .ingest import CLOCK_SKEW
        marker.deleted_before = now()+CLOCK_SKEW
        db.commit()
        return {"deleted":True,"recording_epoch":user.recording_epoch}

    @app.delete(PREFIX+"/me/history")
    def delete_history(request:Request,db=Depends(db_session)):
        user,_,_ = authenticate(request,db,web_only=True)
        user = lock_user(db,user.id)
        clear_history(db,user.id)
        user.recording_epoch += 1
        db.commit()
        return {"deleted":True,"recording_epoch":user.recording_epoch}

    @app.post(PREFIX+"/me/export")
    def export(request:Request,db=Depends(db_session)):
        user,_,_ = authenticate(request,db,web_only=True)
        lock_user(db,user.id)
        data = replay(db,user.id)
        return {"export_version":1,"user":{"user_id":user.id,"display_name":user.display_name,"timezone":user.timezone},"privacy":privacy_json(user),
                "articles":data["records"],"activities":data["activities"],"events":[e.payload for e in db.scalars(select(ReadingEvent).where(ReadingEvent.user_id==user.id).order_by(ReadingEvent.id))]}

    @app.delete(PREFIX+"/me")
    def delete_account(data:DeleteAccount,request:Request,db=Depends(db_session)):
        user,_,_ = authenticate(request,db,web_only=True)
        user = lock_user(db,user.id)
        clear_history(db,user.id)
        for model in (DeletionMarker,Identity,WebSession,DeviceLink,Device):
            db.execute(delete(model).where(model.user_id==user.id))
        db.delete(user)
        db.commit()
        response = JSONResponse({"deleted":True})
        response.delete_cookie(COOKIE,path="/")
        return response

    @app.get(PREFIX+"/profiles/{user_id}")
    def profile(user_id:UUID,db=Depends(db_session)):
        user = db.get(User,str(user_id))
        if not user or not user.profile_public:
            raise APIError("profile_not_found",404)
        data = replay(db,user.id)
        return {"user_id":user.id,"display_name":user.display_name,"active_ms":stats(data)["activity"]["active_ms"] if user.publish_total_time else None,
                "achievements":[a for a in achievements(data) if a["earned"]] if user.publish_achievements else None}

    return app


app = create_app()
