"""Auth dependency — accepts X-User-Email or X-User-Id.

This is the single place Supabase Auth JWT verification will replace the
header-based stub later. For now it looks up a Profile by email or id.
"""

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import Profile


def get_current_user(
    db: Session = Depends(get_db),
    x_user_email: str | None = Header(default=None, alias="X-User-Email"),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
) -> Profile:
    """Return the Profile for X-User-Email (preferred) or X-User-Id.

    401 if neither header is present or the user is unknown.
    """
    if x_user_email:
        profile = db.execute(
            select(Profile).where(Profile.email == x_user_email)
        ).scalar_one_or_none()
        if not profile:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"No profile for email {x_user_email}",
            )
        return profile

    if x_user_id:
        profile = db.get(Profile, x_user_id)
        if not profile:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"No profile for user {x_user_id}",
            )
        return profile

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing X-User-Email or X-User-Id header",
    )
