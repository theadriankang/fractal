"""FastAPI application entrypoint."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .guard import DemoGuard
from .routers import audit, capture, chat, chats, expertise, files, proposals, health, responses

app = FastAPI(title="Fractal backend", version="0.1.0")

app.add_middleware(DemoGuard)
# CORS is added last so it wraps the guard: preflights and 401/429 replies keep their CORS headers.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(chat.router)
app.include_router(files.router)
app.include_router(chats.router)
app.include_router(expertise.router)
app.include_router(proposals.router)
app.include_router(responses.router)
app.include_router(capture.router)
app.include_router(audit.router)


@app.on_event("startup")
def _repair_search_index() -> None:
    """Re-embed any approved Expertise missing from the search index, in the background."""
    import logging
    import threading

    def run():
        from .db import SessionLocal
        from .retrieval.index import sync_missing

        db = SessionLocal()
        try:
            n = sync_missing(db)
            if n:
                logging.getLogger(__name__).info("Search index repaired: %d Expertise re-embedded", n)
        except Exception as exc:  # never block or crash startup
            logging.getLogger(__name__).warning("Search index repair skipped: %s", exc)
        finally:
            db.close()

    threading.Thread(target=run, daemon=True).start()
