"""Response ratings — the Expertise feedback loop.

A rating is saved on the response and as Feedback on every Expertise the answer used. A 👎 with a comment from an expert in that domain becomes an
open proposal adding the comment to `knowledge`.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_contributor
from ..db import get_db
from ..governance import audit, load_expertise_out, proposal_to_out
from ..models import Chat, Expertise, Feedback, Message, Profile, Proposal, Response
from ..schemas import RatingIn, RatingOut

router = APIRouter(prefix="/api/responses", tags=["responses"])


@router.post("/{response_id}/rating", response_model=RatingOut)
def rate_response(
    response_id: str,
    body: RatingIn,
    user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    r = db.get(Response, response_id)
    msg = r and db.get(Message, r.message_id)
    chat = msg and db.get(Chat, msg.chat_id)
    if not chat or chat.user_id != user.id:
        raise HTTPException(status_code=404, detail="Response not found")
    r.rating = body.rating
    out = RatingOut()

    ids = [x.get("id") for x in (r.expertise_used or []) if x.get("id")]
    used = {e.id: e for e in db.query(Expertise).filter(Expertise.id.in_(ids))} if ids else {}
    if body.rating and used:
        for e in used.values():
            db.add(Feedback(
                expertise_id=e.id, response_id=r.id, user_name=user.name, rating=body.rating,
                comment=body.comment, chat_id=chat.id, date=datetime.now(timezone.utc),
            ))
        db.flush()

        target = used.get(ids[0])
        if body.rating == "down" and body.comment.strip() and target:
            try:
                require_contributor(user, target.domain)
            except HTTPException as blocked:
                out.blocked = blocked.detail
            else:
                p = Proposal(
                    id=body.proposal_id if body.proposal_id and not db.get(Proposal, body.proposal_id) else f"prop-{uuid.uuid4().hex[:8]}",
                    expertise_id=target.id, type="revision", author=f"{user.name} (via 👎 feedback)",
                    author_id=body.author_id, reason=body.comment.strip(), chat_id=chat.id, status="open",
                    changes={"knowledge": {"add": [body.comment.strip()], "remove": []}},
                    created_at=datetime.now(timezone.utc),
                )
                db.add(p)
                db.flush()
                out.proposal = proposal_to_out(p)
                audit(db, user, "proposal.create", "proposal", p.id, expertiseId=target.id, via="feedback")

    audit(db, user, "response.rate", "response", r.id, rating=body.rating, expertise=ids)
    db.commit()
    out.expertise = load_expertise_out(db, list(used.values()))
    return out
