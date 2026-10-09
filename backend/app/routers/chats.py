"""Chats router — CRUD for chats and their nested messages + responses.

CamelCase JSON matches the front-end shapes.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from ..auth import get_current_user
from ..db import get_db
from ..models import Chat, Message, Response, Profile
from ..schemas import ChatCreate, ChatOut, ChatPatch, MessageOut, ResponseOut

router = APIRouter(prefix="/api/chats", tags=["chats"])


def _chat_to_out(chat: Chat) -> ChatOut:
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
                responses=responses,
                created_at=m.created_at,
            )
        )
    return ChatOut(
        id=chat.id,
        title=chat.title,
        folder=chat.folder,
        pinned=chat.pinned,
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


# --- single chat get / patch / delete ---------------------------------------

@router.get("/{chat_id}", response_model=ChatOut)
def get_chat(
    chat_id: str,
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
    return _chat_to_out(chat)


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
