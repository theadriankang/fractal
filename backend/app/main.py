"""FastAPI application entrypoint."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import capture, chat, chats, expertise, files, proposals, health, responses

app = FastAPI(title="Fractal backend", version="0.1.0")

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
