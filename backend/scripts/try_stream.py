#!/usr/bin/env python3
"""Test script: stream one prompt to two available models concurrently against
the running server, and show that an unavailable model returns a clean error.

Usage:
    cd backend && python scripts/try_stream.py
    # (uvicorn must already be running on http://localhost:8000)

Expects at least one model to be available (ANTHROPIC_API_KEY set). It
automatically picks two available models to stream and one unavailable one to
demonstrate the 400 error.
"""

import asyncio
import json
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = "http://localhost:8000"

PROMPT = "Give me one tip for reducing HVAC energy use in a Singapore office building."


def fetch_json(path: str, method: str = "GET", body: dict | None = None):
    data = json.dumps(body).encode() if body else None
    req = Request(f"{BASE}{path}", data=data, method=method)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except HTTPError as e:
        return e.code, json.loads(e.read())


def fetch_sse(path: str, body: dict, label: str):
    """Sends a POST and reads the SSE stream synchronously, printing events."""
    data = json.dumps(body).encode()
    req = Request(f"{BASE}{path}", data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urlopen(req, timeout=120) as resp:
            print(f"\n{'='*60}")
            print(f"[{label}] model={body['model']} -> {resp.status}")
            print(f"{'='*60}")
            buf = ""
            for raw in iter(lambda: resp.read(1), b""):
                buf += raw.decode("utf-8", errors="replace")
                while "\n\n" in buf:
                    block, buf = buf.split("\n\n", 1)
                    _print_sse_block(block)
    except HTTPError as e:
        detail = e.read().decode()
        print(f"\n{'='*60}")
        print(f"[{label}] model={body['model']} -> HTTP {e.code}")
        print(f"  Error: {detail}")
        print(f"{'='*60}")
    except Exception as e:
        print(f"\n[{label}] Connection error: {e}")


def _print_sse_block(block: str):
    event = "message"
    data = ""
    for line in block.split("\n"):
        if line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: "):
            data += line[6:]
    if not data:
        return
    try:
        obj = json.loads(data)
    except json.JSONDecodeError:
        obj = {"raw": data}
    if event == "delta":
        sys.stdout.write(obj.get("text", ""))
        sys.stdout.flush()
    elif event == "done":
        print(f"\n  [done] {obj}")
    elif event == "error":
        print(f"\n  [error] {obj}")
    elif event == "meta":
        print(f"  [meta] {obj}")


async def stream_concurrent(models_to_stream: list[str], prompt: str):
    """Streams one prompt to multiple models concurrently using threads."""
    loop = asyncio.get_event_loop()
    tasks = []
    for i, mid in enumerate(models_to_stream):
        body = {
            "model": mid,
            "messages": [{"role": "user", "content": prompt}],
            "expertise": [],
        }
        label = f"stream-{i+1}"
        tasks.append(loop.run_in_executor(None, fetch_sse, "/api/chat/stream", body, label))
    await asyncio.gather(*tasks)


def main():
    # 1. Fetch the model list
    status, models = fetch_json("/api/models")
    if status != 200:
        print(f"Failed to GET /api/models: {status}")
        sys.exit(1)

    print("Available models from GET /api/models:")
    for m in models:
        flag = "+" if m["available"] else "-"
        print(f"  {flag} {m['id']:20s} provider={m['provider']}")

    available = [m["id"] for m in models if m["available"]]
    unavailable = [m["id"] for m in models if not m["available"]]

    if len(available) < 2:
        print(f"\nOnly {len(available)} model(s) available. Need at least 2 for concurrent stream test.")
        if not available:
            print("Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY in backend/.env and restart uvicorn.")
            sys.exit(1)

    # 2. Stream the same prompt to two available models concurrently
    stream_models = available[:2]
    print(f"\nStreaming prompt to {stream_models} concurrently...")
    print(f"Prompt: {PROMPT}")
    asyncio.run(stream_concurrent(stream_models, PROMPT))

    # 3. Show that an unavailable model returns a clean 400 error
    if unavailable:
        test_model = unavailable[0]
        print(f"\n{'='*60}")
        print(f"[unavailable] model={test_model} (expecting HTTP 400)")
        print(f"{'='*60}")
        body = {
            "model": test_model,
            "messages": [{"role": "user", "content": "hello"}],
            "expertise": [],
        }
        fetch_sse("/api/chat/stream", body, "unavailable")
    else:
        print("\nAll models are available — skipping the unavailable-model error test.")

    # 4. Test "auto" model id
    if available:
        print(f"\n{'='*60}")
        print(f"[auto] model=auto (resolves to claude-sonnet)")
        print(f"{'='*60}")
        body = {
            "model": "auto",
            "messages": [{"role": "user", "content": "Say hello in one sentence."}],
            "expertise": [],
        }
        fetch_sse("/api/chat/stream", body, "auto")

    print("\nDone.")


if __name__ == "__main__":
    main()
