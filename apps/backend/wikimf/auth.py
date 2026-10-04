import hashlib
import os
import secrets
from datetime import timedelta

from authlib.integrations.starlette_client import OAuth
from sqlalchemy import select

from .articles import APIError
from .db import Device, Identity, User, WebSession, now, utc

COOKIE = "wikimf_session"
RECENT_AUTH = timedelta(minutes=10)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def token():
    return secrets.token_urlsafe(32)


def hash_user_code(code, salt=None):
    salt = salt or secrets.token_hex(16)
    value = hashlib.pbkdf2_hmac("sha256", code.upper().encode(), bytes.fromhex(salt), 600_000).hex()
    return salt + ":" + value


def verify_user_code(code, saved):
    return secrets.compare_digest(hash_user_code(code, saved.split(":", 1)[0]), saved)


def require_recent_auth(web):
    if not web or not web.authenticated_at or not timedelta(0) <= now() - utc(web.authenticated_at) < RECENT_AUTH:
        raise APIError("reauthentication_required", 403)


def issue_web_session(db, user_id):
    secret = token()
    session = WebSession(token_hash=digest(secret), user_id=user_id, csrf_token=token(), authenticated_at=now(), expires_at=now() + timedelta(days=7))
    db.add(session)
    db.flush()
    return secret, session


def identify(db, provider, subject, display_name, link_user_id=None):
    linked_user = None
    if link_user_id:
        # Serialize explicit links before checking the provider's existing identity.
        linked_user = db.scalar(select(User).where(User.id == link_user_id).with_for_update().execution_options(populate_existing=True))
        if linked_user is None:
            raise APIError("authentication_required", 401)
    identity = db.scalar(select(Identity).where(Identity.provider == provider, Identity.subject == subject))
    if identity:
        if link_user_id and identity.user_id != link_user_id:
            raise APIError("identity_already_linked", 409)
        return db.get(User, identity.user_id)
    if linked_user and db.scalar(select(Identity).where(Identity.user_id == linked_user.id, Identity.provider == provider)):
        raise APIError("provider_already_linked", 409)
    user = linked_user if linked_user else User(display_name=display_name[:100] or "Reader")
    db.add(user)
    db.flush()
    db.add(Identity(user_id=user.id, provider=provider, subject=subject))
    db.flush()
    return user


def authenticate(request, db, *, web_only=False, scope="reading:read"):
    header = request.headers.get("authorization", "")
    device, web = None, None
    if header:
        if not header.startswith("Bearer ") or web_only:
            raise APIError("insufficient_scope", 403)
        device = db.scalar(select(Device).where(Device.token_hash == digest(header[7:])))
        if not device or device.revoked_at or utc(device.expires_at) <= now():
            raise APIError("invalid_device_token", 401)
        if scope not in device.scopes:
            raise APIError("insufficient_scope", 403)
        user_id = device.user_id
    else:
        secret = request.cookies.get(COOKIE)
        web = db.get(WebSession, digest(secret)) if secret else None
        if not web or utc(web.expires_at) <= now():
            raise APIError("authentication_required", 401)
        user_id = web.user_id
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            supplied = request.headers.get("x-csrf-token", "")
            if not secrets.compare_digest(supplied, web.csrf_token):
                raise APIError("csrf_failed", 403)
    user = db.get(User, user_id)
    if not user:
        raise APIError("authentication_required", 401)
    return user, device, web


def configure_oauth():
    oauth = OAuth()
    if os.getenv("GOOGLE_CLIENT_ID") and os.getenv("GOOGLE_CLIENT_SECRET"):
        oauth.register("google", client_id=os.environ["GOOGLE_CLIENT_ID"], client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
                       server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
                       client_kwargs={"scope": "openid profile", "code_challenge_method": "S256"})
    if os.getenv("GITHUB_CLIENT_ID") and os.getenv("GITHUB_CLIENT_SECRET"):
        oauth.register("github", client_id=os.environ["GITHUB_CLIENT_ID"], client_secret=os.environ["GITHUB_CLIENT_SECRET"],
                       authorize_url="https://github.com/login/oauth/authorize", access_token_url="https://github.com/login/oauth/access_token",
                       api_base_url="https://api.github.com/", client_kwargs={"scope": "read:user", "code_challenge_method": "S256"})
    return oauth
