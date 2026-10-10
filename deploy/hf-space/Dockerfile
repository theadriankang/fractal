# Fractal backend for a Hugging Face Space (SDK: Docker, port 7860).
# The Space only needs this Dockerfile + README.md: it pulls the code from GitHub at build time.
# To ship new backend code: merge to main, then Space → Settings → "Factory reboot".
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Spaces run containers as uid 1000.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    FASTEMBED_CACHE_PATH=/home/user/.cache/fastembed
WORKDIR /home/user

ARG REPO=https://github.com/theadriankang/fractal.git
ARG REF=main
# Changes whenever main moves, so a rebuild picks up new commits instead of a cached clone.
ADD --chown=user https://api.github.com/repos/theadriankang/fractal/git/refs/heads/main /tmp/fractal-main.json
RUN git clone --depth 1 --branch "$REF" "$REPO" fractal

WORKDIR /home/user/fractal/backend
RUN pip install --no-cache-dir --user -r requirements.txt

# Download the local embedding model at build time so the first search isn't slow.
RUN python -c "from app.retrieval.embedder import embed_text; embed_text('warm up')" || echo "embedding warm-up skipped"

EXPOSE 7860
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860", "--proxy-headers", "--forwarded-allow-ips", "*"]
