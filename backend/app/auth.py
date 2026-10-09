"""Auth dependency — stub.

Reads the ``X-User-Id`` header and looks up the matching profile.
Prompt 8 will replace this with Supabase JWT verification.
"""

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from .db import get_db
from .models import Profile


def get_current_user(
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
) -> Profile:
    """Return the Profile for the ``X-User-Id`` header (stub)."""
    if not x_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-User-Id header",
        )
    profile = db.get(Profile, x_user_id)
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No profile for user {x_user_id}",
        )
    return profile
