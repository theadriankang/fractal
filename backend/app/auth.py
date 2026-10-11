"""Auth dependency, plus the role rules from src/lib/permissions.js.

Verifies a Supabase JWT when the request carries one (``Authorization: Bearer <token>``),
and falls back to the unverified ``X-User-Id`` / ``X-User-Email`` header stub when it
doesn't — the front end's demo sign-in (src/pages/Login.jsx) doesn't call Supabase Auth
yet, so both paths stay supported until that migration ships. Once every request carries
a verified JWT, the header fallback becomes dead code safe to delete.

Supabase projects created with the newer "JWT signing keys" setup (Settings -> API ->
JWT Keys) sign access tokens asymmetrically (ES256, occasionally RS256) with a key that
rotates; there is no shared secret to copy for these, so we verify against the project's
public JWKS instead (fetched from ``<SUPABASE_URL>/auth/v1/.well-known/jwks.json`` and
cached by ``kid``). Older projects that still sign with the legacy shared HS256 secret
(``SUPABASE_JWT_SECRET``) are supported too — the algorithm in the token's own header
picks which path we use, since a token never carries a shared secret in it.

SECURITY NOTE: the header fallback trusts whatever the client sends with no verification —
anyone who can reach the API can claim to be any profile id. It exists only so the current
front end keeps working; it must not be relied on once this is public with real user data.
"""

import logging
import ssl

import certifi
import jwt
from fastapi import Depends, Header, HTTPException, status
from jwt import PyJWKClient
from sqlalchemy import func
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import Profile

logger = logging.getLogger(__name__)

# Cached lazily so we only hit the network the first time a JWKS-signed (ES256/RS256)
# token shows up, and PyJWKClient itself caches individual keys by kid after that.
_jwks_client: PyJWKClient | None = None

# PyJWKClient fetches the JWKS with urllib, which defaults to the OS trust store. That's
# missing or incomplete on a lot of machines (python.org installs on macOS that skipped
# "Install Certificates.command", slim Docker images on Cloud Run), which fails as an opaque
# "unable to get local issuer certificate" — not a token problem, just no CA bundle to check
# against. Pointing it at certifi's bundled-with-pip CA bundle sidesteps the OS store entirely,
# so this works the same in a fresh venv, in CI and in the container we deploy.
_SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())


def _get_jwks_client() -> PyJWKClient | None:
    global _jwks_client
    if _jwks_client is None and settings.supabase_url:
        jwks_url = settings.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json"
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True, lifespan=3600, ssl_context=_SSL_CONTEXT)
    return _jwks_client


def prewarm_jwks() -> None:
    """Fetch and cache the JWKS once, eagerly, instead of waiting for the first real request.

    Without this, the first sign-in after a backend restart pays for the JWKS network round
    trip (and, under React StrictMode, several *concurrent* requests all pay for it at once,
    since the lazily-created client isn't populated yet) inline with the user's own request —
    slow enough on a cold connection to occasionally time out or error, which the front end
    then (correctly, but confusingly) reports as "couldn't load from Supabase" even though a
    retry a moment later succeeds once the key is cached. Called from main.py's startup hook,
    in a background thread so a slow or unreachable JWKS endpoint never delays startup itself.
    """
    client = _get_jwks_client()
    if client is None:
        return
    try:
        client.get_jwk_set()  # populates PyJWKClient's own key cache; return value unused here
    except Exception as exc:  # network hiccup at startup — the lazy path on first request still works
        logger.warning("JWKS prewarm failed (will retry lazily on first request): %s", exc)


def _verify_jwt(token: str) -> str | None:
    """Returns the Supabase user id (the ``sub`` claim) for a validly signed, unexpired
    JWT, or None if it's missing, malformed, expired, or fails verification.

    Picks the verification path from the token's own ``alg`` header: ES256/RS256 (the
    current Supabase default) is checked against the project's JWKS; HS256 (legacy
    projects) against ``SUPABASE_JWT_SECRET``. Never trusts the header's ``alg`` beyond
    that routing decision — ``jwt.decode`` is always given an explicit allow-list.
    """
    try:
        alg = jwt.get_unverified_header(token).get("alg")
    except jwt.InvalidTokenError as exc:
        logger.warning("rejected a malformed bearer token: %s", exc)
        return None

    try:
        if alg in ("ES256", "RS256"):
            client = _get_jwks_client()
            if client is None:
                return None
            signing_key = client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token, signing_key.key, algorithms=["ES256", "RS256"], audience="authenticated",
            )
        elif alg == "HS256":
            if not settings.supabase_jwt_secret:
                return None
            payload = jwt.decode(
                token, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated",
            )
        else:
            logger.warning("rejected a bearer token with unsupported alg %r", alg)
            return None
    except jwt.InvalidTokenError as exc:
        logger.warning("rejected an invalid bearer token: %s", exc)
        return None
    except Exception as exc:  # JWKS fetch/network errors, etc. — never raise into the caller.
        logger.warning("bearer token verification failed: %s", exc)
        return None
    return payload.get("sub")


def get_current_user(
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    x_user_email: str | None = Header(default=None, alias="X-User-Email"),
) -> Profile:
    """Return the Profile making this request.

    Prefers a verified Supabase JWT. Falls back to the unverified ``X-User-Id`` /
    ``X-User-Email`` headers only when no bearer token is presented (see module docstring).
    """
    verified_user_id = None
    if authorization and authorization.lower().startswith("bearer "):
        verified_user_id = _verify_jwt(authorization[len("bearer "):].strip())
        if verified_user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired session token.",
            )

    if verified_user_id:
        profile = db.get(Profile, verified_user_id)
    elif x_user_id:
        profile = db.get(Profile, x_user_id)
    elif x_user_email:
        profile = db.query(Profile).filter(func.lower(Profile.email) == x_user_email.strip().lower()).first()
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization, X-User-Id or X-User-Email header",
        )
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No profile for user {verified_user_id or x_user_id or x_user_email}. "
                   f"Run backend/seed.py to create the demo accounts.",
        )
    return profile


# --- role rules (mirror src/lib/permissions.js) -------------------------------

def _forbid(detail: str):
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def in_domain(user: Profile, domain: str | None) -> bool:
    return bool(domain) and domain in (user.domains or [])


def require_contributor(user: Profile, domain: str | None) -> None:
    """Domain experts may contribute, only in their own domains."""
    if user.role == "intern":
        _forbid("Interns can use Expertise but can't contribute to it.")
    if user.role == "reviewer":
        _forbid("Reviewers approve know-how but don't contribute it.")
    if not in_domain(user, domain):
        _forbid(f"Only {domain} experts can contribute here.")


def is_own_contribution(user: Profile, who: str | None) -> bool:
    """``who`` is the item's capturer / author / owner, e.g. "Priya S. (captured from chat)"."""
    who = who or ""
    return bool(user.name) and (who == user.name or who.startswith(f"{user.name} ("))


def require_reviewer_for(user: Profile, domain: str | None, who: str | None = None) -> None:
    """The Reviewer decides everything; a domain expert decides queue items in their domains,
    never their own contribution (four eyes)."""
    if user.role == "reviewer":
        return
    if user.role == "intern":
        _forbid("Interns can't review Expertise.")
    if not in_domain(user, domain):
        _forbid(f"Only {domain} experts or the Reviewer can decide this.")
    if is_own_contribution(user, who):
        _forbid("You can't approve your own contribution — another expert or the Reviewer must.")


def require_governor(user: Profile) -> None:
    """Rollback, deprecate and restore change what is live for everyone: Reviewer only."""
    if user.role != "reviewer":
        _forbid("Only the Reviewer can do this.")
