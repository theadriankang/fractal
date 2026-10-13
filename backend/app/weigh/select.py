"""Choose which approved Expertise to weigh for a question: one voice per domain.

1. Expertise the user attached always takes part.
2. Then the best search match from each domain (search runs without the usual "close to the top
   hit" cutoff, so a strong Energy match doesn't silence a weaker but relevant Tenant one).
3. Then the experts those picks already point to in *other* domains (their `related` links):
   the organisation has said these pieces of know-how belong together, so they get a seat too.
4. Last, a second voice from the *same* domain, but only when it is linked to that domain's
   pick: two Energy playbooks (say peak shaving and chiller sequencing) can pull against each
   other, and that trade-off needs weighing as much as a cross-domain one.

Only approved Expertise is ever returned (PROJECT_CONTEXT rule 4).
"""

from sqlalchemy.orm import Session

from ..models import Expertise
from ..retrieval import index
from .schemas import Expert

MAX_EXPERTS = 4  # four voices is about as many as one person can weigh at once
MAX_PER_DOMAIN = 2
SEARCH_POOL = 20


def _expert(e: Expertise, via: str, reason: str) -> Expert:
    return Expert(
        id=e.id, name=e.name, version=e.version, domain=e.domain,
        owner=e.owner or "", ownerRole=e.owner_role or "", via=via, reason=reason,
    )


def select_experts(
    db: Session, question: str, attached_ids: list[str] | None = None, max_experts: int = MAX_EXPERTS,
) -> list[tuple[Expert, Expertise]]:
    attached_ids = list(dict.fromkeys(attached_ids or []))
    hits = index.search(db, question, attached_ids=attached_ids, limit=SEARCH_POOL, relative_cutoff=None)
    wanted = list(dict.fromkeys([*attached_ids, *(h["id"] for h in hits)]))
    rows = {
        e.id: e
        for e in db.query(Expertise).filter(Expertise.id.in_(wanted), Expertise.status == "approved").all()
    } if wanted else {}

    picked: list[tuple[Expert, Expertise]] = []
    seen: set[str] = set()
    domains: dict[str, int] = {}

    def add(e: Expertise, via: str, reason: str) -> None:
        picked.append((_expert(e, via, reason), e))
        seen.add(e.id)
        domains[e.domain] = domains.get(e.domain, 0) + 1

    for aid in attached_ids:
        if aid in rows and aid not in seen and len(picked) < max_experts:
            add(rows[aid], "attached", "attached by you")

    for h in hits:
        if len(picked) >= max_experts:
            break
        e = rows.get(h["id"])
        if e is None or e.id in seen or e.domain in domains:
            continue
        add(e, "search", h.get("reason") or "matched your question")

    for _, src in list(picked):
        for rid in src.related or []:
            if len(picked) >= max_experts:
                break
            if rid in seen:
                continue
            r = db.get(Expertise, rid)
            if r is not None and r.status == "approved" and r.domain not in domains:
                add(r, "linked", f"linked from {src.name}")

    for _, src in list(picked):
        for rid in src.related or []:
            if len(picked) >= max_experts:
                break
            if rid in seen:
                continue
            r = rows.get(rid) or db.get(Expertise, rid)
            if (r is not None and r.status == "approved" and r.domain == src.domain
                    and domains.get(r.domain, 0) < MAX_PER_DOMAIN):
                add(r, "linked", f"same domain, linked from {src.name}")

    return picked
