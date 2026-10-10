"""Chats router — CRUD for chats and their nested messages + responses.

CamelCase JSON matches the front-end shapes.
"""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from ..auth import get_current_user
from ..db import get_db
from ..models import AuditLog, Chat, Message, Response, Profile, Expertise, Proposal
from ..schemas import ChatCreate, ChatOut, ChatPatch, MessageCreate, MessageOut, ResponseOut
from ..governance import audit

router = APIRouter(prefix="/api/chats", tags=["chats"])


def _chat_to_out(chat: Chat, *, owner_id: str | None = None, owner_name: str | None = None) -> ChatOut:
    """Serialise a Chat ORM object to the front-end shape."""
    messages = []
    for m in chat.messages:
        responses = [
            ResponseOut(
                id=r.id,
                model_id=r.model_id,
                auto=r.auto,
                expertise_used=r.expertise_used or [],
                content=r.content,
                rating=r.rating,
            )
            for r in m.responses
        ]
        messages.append(
            MessageOut(
                id=m.id,
                role=m.role,
                content=m.content,
                files=m.files or [],
                attached_expertise=m.attached_expertise or [],
                web_search=m.web_search,
                detection=m.detection,
                detection_state=m.detection_state,
                detection_result=m.detection_result,
                detection_missing=m.detection_missing or [],
                responses=responses,
                created_at=m.created_at,
            )
        )
    return ChatOut(
        id=chat.id,
        title=chat.title,
        folder=chat.folder,
        pinned=chat.pinned,
        owner_id=owner_id or chat.user_id,
        owner_name=owner_name,
        created_at=chat.created_at,
        updated_at=chat.updated_at,
        messages=messages,
    )


# --- list + create ----------------------------------------------------------

@router.get("", response_model=list[ChatOut])
def list_chats(user: Profile = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(Chat)
        .filter(Chat.user_id == user.id)
        .order_by(Chat.updated_at.desc())
        .options(selectinload(Chat.messages).selectinload(Message.responses))
        .all()
    )
    return [_chat_to_out(c) for c in rows]


@router.post("", response_model=ChatOut, status_code=status.HTTP_201_CREATED)
def create_chat(
    body: ChatCreate,
    user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    chat = Chat(
        id=body.id or f"chat-{uuid.uuid4().hex[:8]}",
        user_id=user.id,
        title=body.title,
        folder=body.folder,
        pinned=body.pinned,
    )
    db.add(chat)
    db.commit()
    db.refresh(chat)
    chat.messages = []
    return _chat_to_out(chat)


def _owned(db: Session, chat_id: str, user: Profile) -> Chat | None:
    chat = db.get(Chat, chat_id)
    if chat and chat.user_id != user.id:
        # Chat ids are global; never let one account write into another's conversation.
        raise HTTPException(status_code=404, detail="Chat not found")
    return chat


# --- upserts (the front end creates ids locally and saves as it goes) --------

@router.put("/{chat_id}", response_model=ChatOut)
def upsert_chat(
    chat_id: str,
    body: ChatCreate,
    user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    chat = _owned(db, chat_id, user)
    if not chat:
        chat = Chat(id=chat_id, user_id=user.id)
        db.add(chat)
    chat.title = body.title
    chat.folder = body.folder
    chat.pinned = body.pinned
    chat.updated_at = datetime.now(timezone.utc)
    db.commit()
    return get_chat(chat_id, user, db)


@router.put("/{chat_id}/messages/{msg_id}", response_model=MessageOut)
def upsert_message(
    chat_id: str,
    msg_id: str,
    body: MessageCreate,
    user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Creates or replaces one message and its responses (matched by response id)."""
    chat = _owned(db, chat_id, user)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    msg = db.get(Message, msg_id)
    if msg and msg.chat_id != chat_id:
        raise HTTPException(status_code=409, detail="Message id belongs to another chat")
    if not msg:
        msg = Message(id=msg_id, chat_id=chat_id, created_at=body.created_at or datetime.now(timezone.utc))
        db.add(msg)
    for field in ("role", "content", "files", "attached_expertise", "web_search", "detection",
                  "detection_state", "detection_result", "detection_missing"):
        setattr(msg, field, getattr(body, field))

    existing = {r.id: r for r in db.query(Response).filter(Response.message_id == msg_id)}
    keep = set()
    for i, r in enumerate(body.responses):
        rid = r.id or f"r-{uuid.uuid4().hex[:10]}"
        keep.add(rid)
        row = existing.get(rid)
        if not row:
            # created_at keeps compare-mode answers in the order the UI shows them
            row = Response(id=rid, message_id=msg_id, created_at=msg.created_at + timedelta(milliseconds=i))
            db.add(row)
        row.model_id, row.auto, row.expertise_used = r.model_id, r.auto, r.expertise_used
        row.content, row.rating = r.content, r.rating
    for rid, row in existing.items():
        if rid not in keep:
            db.delete(row)
    chat.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(msg)
    return next(m for m in get_chat(chat_id, user, db).messages if m.id == msg_id)


# --- single chat get / patch / delete ---------------------------------------

def _source_chat_domains(db: Session, chat_id: str) -> set[str]:
    """Domains where this chat is the source of an Expertise or open proposal.

    Checked: Expertise.sources (chatId), Proposal.chat_id, and
    Proposal.sources (chatId). Meetings are out of scope.
    """
    domains: set[str] = set()
    # Expertise whose sources reference this chat.
    for e in db.query(Expertise).all():
        for src in e.sources or []:
            if src.get("chatId") == chat_id or src.get("chat_id") == chat_id:
                domains.add(e.domain)
    # Proposals linked to this chat (direct chat_id or via sources).
    for p in db.query(Proposal).filter(Proposal.chat_id == chat_id).all():
        e = db.get(Expertise, p.expertise_id)
        if e:
            domains.add(e.domain)
    for p in db.query(Proposal).all():
        for src in p.sources or []:
            if src.get("chatId") == chat_id or src.get("chat_id") == chat_id:
                e = db.get(Expertise, p.expertise_id)
                if e:
                    domains.add(e.domain)
    return domains


@router.get("/{chat_id}", response_model=ChatOut)
def get_chat(
    chat_id: str,
    user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    chat = (
        db.query(Chat)
        .filter(Chat.id == chat_id)
        .options(selectinload(Chat.messages).selectinload(Message.responses))
        .first()
    )
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    is_owner = chat.user_id == user.id

    if not is_owner:
        # Interns never see other people's chats.
        if user.role == "intern":
            raise HTTPException(status_code=404, detail="Chat not found")
        # Reviewers can see any chat (it's the source of a review item).
        if user.role == "reviewer":
            pass
        # Domain experts can see it only when it's the source of an Expertise
        # or proposal in one of their domains.
        elif user.role == "contributor":
            domains = _source_chat_domains(db, chat_id)
            if not (domains & set(user.domains or [])):
                raise HTTPException(status_code=404, detail="Chat not found")
        else:
            raise HTTPException(status_code=404, detail="Chat not found")

        # Audit: a non-owner opened someone else's conversation.
        owner = db.get(Profile, chat.user_id)
        owner_name = owner.name if owner else None
        # One entry per person per conversation per 10 minutes, so reloads don't flood the log.
        recent = (
            db.query(AuditLog.id)
            .filter(AuditLog.action == "chat.view_source", AuditLog.target_id == chat_id,
                    AuditLog.actor == user.id,
                    AuditLog.at >= datetime.now(timezone.utc) - timedelta(minutes=10))
            .first()
        )
        if not recent:
            audit(db, user, "chat.view_source", "chat", chat_id,
                  owner_id=chat.user_id, owner_name=owner_name)
            db.commit()
        return _chat_to_out(chat, owner_id=chat.user_id, owner_name=owner_name)

    return _chat_to_out(chat, owner_id=user.id, owner_name=user.name)


@router.patch("/{chat_id}", response_model=ChatOut)
def patch_chat(
    chat_id: str,
    body: ChatPatch,
    user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    chat = (
        db.query(Chat)
        .filter(Chat.id == chat_id, Chat.user_id == user.id)
        .options(selectinload(Chat.messages).selectinload(Message.responses))
        .first()
    )
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if body.title is not None:
        chat.title = body.title
    if body.folder is not None:
        chat.folder = body.folder
    if body.pinned is not None:
        chat.pinned = body.pinned
    chat.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(chat)
    return _chat_to_out(chat)


@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_chat(
    chat_id: str,
    user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    chat = db.query(Chat).filter(Chat.id == chat_id, Chat.user_id == user.id).first()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    db.delete(chat)
    db.commit()
