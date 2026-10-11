"""Auth dependency, plus the role rules from src/lib/permissions.js.

Verifies a Supabase JWT when the request carries one (``Authorization: Bearer <token>``),
and falls back to the unverified ``X-User-Id`` / ``X-User-Email`` header stub when it
doesn't — the front end's demo sign-in (src/pages/Login.jsx) doesn't call Supabase Auth
yet, so both paths stay supported until that migration ships. Once every request carries
a verified JWT, the header fallback becomes dead code safe to delete.

SECURITY NOTE: the header fallback trusts whatever the client sends with no verification —
anyone who can reach the API can claim to be any profile id. It exists only so the current
front end keeps working; it must not be relied on once this is public with real user data.
"""

import logging

import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import Profile

logger = logging.getLogger(__name__)


def _verify_jwt(token: str) -> str | None:
    """Returns the Supabase user id (the ``sub`` claim) for a validly signed, unexpired
    JWT, or None if it's missing, malformed, expired, or signed with the wrong secret."""
    if not settings.supabase_jwt_secret:
        return None
    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.InvalidTokenError as exc:
        logger.warning("rejected an invalid bearer token: %s", exc)
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
