"""Server-side permission checks — mirrors src/lib/permissions.js exactly.

Same roles, same rules, same wording in 403 messages.

  Reviewer (Adrian)  — sees every queue item in every domain; approves, rejects,
                       rolls back, deprecates, restores. Never authors content.
  Domain expert       — contributes AND reviews, but only in their own domains,
                       and never their own contribution (four eyes).
  Intern              — uses approved Expertise in chat and reads it; can rate
                       answers but cannot contribute or review anything.
"""

from __future__ import annotations

from .models import Profile


def is_contributor(user: Profile) -> bool:
    return user.role == "contributor"


def is_reviewer(user: Profile) -> bool:
    return user.role == "reviewer"


def is_intern(user: Profile) -> bool:
    return user.role == "intern"


def _in_domain(user: Profile, domain: str | None) -> bool:
    return bool(domain) and domain in (user.domains or [])


def can_contribute(user: Profile, domain: str | None) -> bool:
    return is_contributor(user) and _in_domain(user, domain)


def contribute_block(user: Profile, domain: str | None) -> str | None:
    """Human-readable reason the user can't contribute to *domain*, or None."""
    if is_intern(user):
        return "Interns can use Expertise but can't contribute to it."
    if is_reviewer(user):
        return "Reviewers approve know-how but don't contribute it."
    if not can_contribute(user, domain):
        domains = ", ".join(user.domains or []) or "none"
        return f"Only {domain} experts can contribute here. Your domains: {domains}."
    return None


def can_edit(user: Profile, domain: str | None) -> bool:
    return can_contribute(user, domain)


def is_own_contribution(user: Profile, owner: str | None, author: str | None) -> bool:
    """True when *user* authored this expertise or proposal."""
    if owner and owner == user.name:
        return True
    if author and (author == user.name or author.startswith(f"{user.name} (")):
        return True
    return False


def sees_queue(user: Profile, domain: str | None) -> bool:
    return is_reviewer(user) or (is_contributor(user) and _in_domain(user, domain))


def can_open_queue(user: Profile) -> bool:
    return is_reviewer(user) or is_contributor(user)


def review_block(
    user: Profile, domain: str | None, owner: str | None = None, author: str | None = None
) -> str | None:
    """Reason the user can't review this item, or None if allowed."""
    if is_intern(user):
        return "Interns can't review Expertise."
    if is_reviewer(user):
        return None
    if not _in_domain(user, domain):
        return f"Only {domain} experts or the Reviewer can decide this."
    if is_own_contribution(user, owner, author):
        return (
            "You can't approve your own contribution — "
            "another expert or the Reviewer must."
        )
    return None


def can_review(
    user: Profile, domain: str | None, owner: str | None = None, author: str | None = None
) -> bool:
    return review_block(user, domain, owner, author) is None


def can_govern(user: Profile) -> bool:
    """Rollback, deprecate and restore: reviewer only."""
    return is_reviewer(user)
