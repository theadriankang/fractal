"""Public-demo protection: a shared access code and a per-visitor rate limit.

Both are off unless configured (ACCESS_CODE / RATE_LIMIT_PER_MINUTE in the
environment), so local development is unchanged.
"""

import time
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from .config import settings

# Endpoints that call a model (cost money) or embed text — these get rate limited.
_AI_PATHS = ("/api/chat/stream", "/api/expertise/extract", "/api/expertise/match", "/api/files")
# Always reachable: lets the front end check the backend is up and validate a code.
_OPEN_PATHS = ("/api/health", "/api/access/check")


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")


class DemoGuard(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self._hits: dict[str, deque] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if request.method == "OPTIONS" or not path.startswith("/api") or path in _OPEN_PATHS:
            return await call_next(request)

        code = settings.access_code.strip()
        if code and request.headers.get("x-access-code", "") != code:
            return JSONResponse({"detail": "Access code required."}, status_code=401)

        limit = settings.rate_limit_per_minute
        if limit > 0 and path.startswith(_AI_PATHS):
            now = time.monotonic()
            q = self._hits[_client_ip(request)]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= limit:
                return JSONResponse(
                    {"detail": "Too many requests — please wait a minute and try again."},
                    status_code=429,
                )
            q.append(now)

        return await call_next(request)
