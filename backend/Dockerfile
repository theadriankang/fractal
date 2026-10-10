# Fractal backend container (Google Cloud Run; also runs anywhere Docker does).
# Build context: backend/   e.g.  docker build -t fractal-backend backend
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FASTEMBED_CACHE_PATH=/opt/fastembed \
    PORT=8080

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Bake the local embedding model into the image so cold starts don't download it.
RUN python -c "from app.retrieval.embedder import embed_text; embed_text('warm up')" \
    && chmod -R a+rX /opt/fastembed

# Cloud Run sends traffic to $PORT and terminates TLS in front of the container.
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips '*'
