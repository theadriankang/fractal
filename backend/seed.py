#!/usr/bin/env python3
"""
Seed the Supabase database from backend/seed_data.json.

Idempotent: upserts by id. Also creates two demo users via the Supabase
Admin API (service role key) and matching profiles rows.

Run from the backend/ directory:
    python seed.py

Prerequisites:
    - supabase/migrations/ applied (npx supabase db push)
    - backend/.env with DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
    - pip install -r requirements.txt
"""

import json
import os
import re
import sys

# Ensure app package is importable when running from backend/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from app.config import settings
from app.db import SessionLocal
from app.models import (
    Profile, Chat, Message, Response,
    Expertise, ExpertiseVersion, Proposal, Feedback,
)


# --- camelCase → snake_case helpers ------------------------------------------

_CAMEL_RE = re.compile(r'(?<!^)(?=[A-Z])')


def camel_to_snake(name: str) -> str:
    return _CAMEL_RE.sub('_', name).lower()


def _model_columns(model):
    """Return the set of column attribute names for an ORM model."""
    return {col.name for col in model.__table__.columns}


def map_keys(model, data: dict) -> dict:
    """Convert camelCase keys in *data* to snake_case and keep only
    columns that exist on *model*."""
    cols = _model_columns(model)
    out = {}
    for k, v in data.items():
        snake = camel_to_snake(k)
        if snake in cols:
            out[snake] = v
    return out

# --- Supabase Admin API (for user creation) ---------------------------------

def get_supabase_client():
    try:
        from supabase import create_client
        return create_client(settings.supabase_url, settings.supabase_service_role_key)
    except Exception as e:
        print(f"  [warn] Could not init Supabase client: {e}")
        return None


def _find_user_by_email(sb, email: str):
    """Page through all users to find one by email."""
    page = 1
    per_page = 1000
    while True:
        try:
            resp = sb.auth.admin.list_users(page=page, per_page=per_page)
        except Exception:
            break
        # The supabase-py version may return a list directly or an object
        # with a .users attribute.
        if isinstance(resp, list):
            users = resp
        else:
            users = getattr(resp, "users", []) or []
        if not users:
            break
        for u in users:
            if getattr(u, "email", None) == email:
                return u
        if len(users) < per_page:
            break
        page += 1
    return None


def upsert_user(sb, email: str, password: str, name: str, role: str, domains: list[str] | None = None) -> str | None:
    """Create or update a demo user via Supabase Admin API. Returns user id."""
    domains = domains or []
    if not sb:
        print(f"  [skip] No Supabase client — cannot create {email}")
        return None

    existing = _find_user_by_email(sb, email)

    if existing:
        uid = existing.id
        print(f"  [exists] {email} → {uid}")
    else:
        try:
            res = sb.auth.admin.create_user(
                {
                    "email": email,
                    "password": password,
                    "email_confirm": True,
                }
            )
            uid = res.user.id
            print(f"  [created] {email} → {uid}")
        except Exception as e:
            # User might have been created between the check and the create;
            # do one more lookup.
            existing = _find_user_by_email(sb, email)
            if existing:
                uid = existing.id
                print(f"  [exists] {email} → {uid}")
            else:
                print(f"  [error] Could not create {email}: {e}")
                return None

    # Upsert profile (including email + domains)
    db = SessionLocal()
    try:
        p = db.get(Profile, uid)
        if p:
            p.name = name
            p.email = email
            p.role = role
            p.domains = domains
        else:
            p = Profile(id=uid, name=name, email=email, role=role, domains=domains)
            db.add(p)
        db.commit()
    finally:
        db.close()

    return uid


# --- Seed data loader --------------------------------------------------------

def seed_expertise(db, items):
    for e in items:
        versions = e.pop("versions", [])
        row = db.get(Expertise, e["id"])
        mapped = map_keys(Expertise, e)
        if row:
            for k, v in mapped.items():
                setattr(row, k, v)
        else:
            row = Expertise(**mapped)
            db.add(row)
        db.flush()

        for v in versions:
            existing = (
                db.query(ExpertiseVersion)
                .filter(
                    ExpertiseVersion.expertise_id == e["id"],
                    ExpertiseVersion.version == v["version"],
                )
                .first()
            )
            if existing:
                existing.date = v.get("date") or existing.date
                existing.author = v.get("author", existing.author)
                existing.approved_by = v.get("approvedBy")
                existing.note = v.get("note", existing.note)
                existing.snapshot = v.get("snapshot", existing.snapshot)
            else:
                db.add(
                    ExpertiseVersion(
                        expertise_id=e["id"],
                        version=v["version"],
                        date=v["date"],
                        author=v.get("author", ""),
                        approved_by=v.get("approvedBy"),
                        note=v.get("note", ""),
                        snapshot=v.get("snapshot", {}),
                    )
                )
    db.commit()


def seed_proposals(db, items):
    for p in items:
        mapped = map_keys(Proposal, p)
        row = db.get(Proposal, p["id"])
        if row:
            for k, v in mapped.items():
                setattr(row, k, v)
        else:
            row = Proposal(**mapped)
            db.add(row)
    db.commit()


def seed_chats(db, items, default_user_id: str):
    for c in items:
        messages = c.pop("messages", [])
        # Seed chats don't have a user_id in the mock data; assign the
        # reviewer (adrian) as owner so they show up in the demo.
        c["user_id"] = default_user_id

        mapped = map_keys(Chat, c)
        row = db.get(Chat, c["id"])
        if row:
            for k, v in mapped.items():
                setattr(row, k, v)
        else:
            row = Chat(**mapped)
            db.add(row)
        db.flush()

        # Clear existing messages for this chat and re-create (simpler upsert)
        db.query(Message).filter(Message.chat_id == c["id"]).delete()
        db.flush()

        for m in messages:
            responses = m.pop("responses", [])
            msg = Message(
                id=m["id"],
                chat_id=c["id"],
                role=m["role"],
                content=m.get("content", ""),
                files=m.get("files", []),
                attached_expertise=m.get("attachedExpertise", []),
                web_search=m.get("webSearch", False),
                detection=m.get("detection"),
                detection_state=m.get("detectionState"),
                created_at=m.get("createdAt"),
            )
            db.add(msg)
            db.flush()

            for r in responses:
                db.add(
                    Response(
                        message_id=m["id"],
                        model_id=r.get("modelId", ""),
                        auto=r.get("auto"),
                        expertise_used=r.get("expertiseUsed", []),
                        content=r.get("content", ""),
                        rating=r.get("rating"),
                        created_at=m.get("createdAt"),
                    )
                )
    db.commit()


# --- Main -------------------------------------------------------------------

def main():
    seed_path = os.path.join(os.path.dirname(__file__), "seed_data.json")
    if not os.path.exists(seed_path):
        print(f"seed_data.json not found at {seed_path}")
        print("Run: node scripts/export-seed.mjs")
        sys.exit(1)

    with open(seed_path) as f:
        data = json.load(f)

    print("=== Seeding Supabase ===")

    # Create demo users — all 8 from src/data/users.js
    print("\n[1/3] Creating demo users...")
    sb = get_supabase_client()
    demo_users = [
        ("adrian@fractal.demo", "Adrian Kang", "reviewer", []),
        ("hafiz@fractal.demo", "Hafiz Rahman", "contributor", ["Technical Services"]),
        ("priya@fractal.demo", "Priya S.", "contributor", ["Technical Services"]),
        ("nurul@fractal.demo", "Nurul Huda", "contributor", ["Energy Optimisation", "Sustainability"]),
        ("daniel@fractal.demo", "Daniel Koh", "contributor", ["Asset Operations"]),
        ("jasmine@fractal.demo", "Jasmine Ong", "contributor", ["Tenant Experience"]),
        ("marcus@fractal.demo", "Marcus Teo", "contributor", ["Leasing"]),
        ("intern@fractal.demo", "Ethan Lim", "intern", []),
    ]
    user_ids: dict[str, str | None] = {}
    for email, name, role, domains in demo_users:
        user_ids[email] = upsert_user(sb, email, "demo1234", name, role, domains)

    default_user = user_ids.get("adrian@fractal.demo") or "00000000-0000-0000-0000-000000000000"

    db = SessionLocal()
    try:
        print("\n[2/3] Seeding expertise + versions...")
        seed_expertise(db, data.get("expertise", []))
        print(f"  {len(data.get('expertise', []))} expertise upserted")

        print("\n[3/3] Seeding proposals + chats...")
        seed_proposals(db, data.get("proposals", []))
        print(f"  {len(data.get('proposals', []))} proposals upserted")
        seed_chats(db, data.get("chats", []), default_user)
        print(f"  {len(data.get('chats', []))} chats upserted")
    finally:
        db.close()

    print("\n=== Seed complete ===")
    print(f"  Demo users: {len(demo_users)} accounts created (see src/data/users.js)")
    print(f"  Password: demo1234")


if __name__ == "__main__":
    main()
