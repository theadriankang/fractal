"""Auth dependency — stub, plus the role rules from src/lib/permissions.js.

Reads the ``X-User-Id`` header (a profile UUID) or, for the front end's demo sign-in, the
``X-User-Email`` header, and looks up the matching profile.
Prompt 8 will replace this with Supabase JWT verification.
"""

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from .db import get_db
from .models import Profile


def get_current_user(
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    x_user_email: str | None = Header(default=None, alias="X-User-Email"),
) -> Profile:
    """Return the Profile for the ``X-User-Id`` or ``X-User-Email`` header (stub)."""
    if x_user_id:
        profile = db.get(Profile, x_user_id)
    elif x_user_email:
        profile = db.query(Profile).filter(func.lower(Profile.email) == x_user_email.strip().lower()).first()
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-User-Id or X-User-Email header",
        )
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No profile for user {x_user_id or x_user_email}. Run backend/seed.py to create the demo accounts.",
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
