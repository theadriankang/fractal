-- Expertise embeddings for semantic retrieval.
-- Uses pgvector (384-dim, BAAI/bge-small-en-v1.5 via fastembed).

create extension if not exists vector;

create table if not exists public.expertise_embeddings (
    expertise_id  text primary key references public.expertise(id) on delete cascade,
    version       text,
    content_hash  text,
    embedding     extensions.vector(384),
    updated_at    timestamptz not null default now()
);

-- HNSW cosine index for fast ANN search.
create index if not exists expertise_embeddings_hnsw_idx
    on public.expertise_embeddings using hnsw (embedding extensions.vector_cosine_ops);

-- Row Level Security: service role only (all writes go through FastAPI).
alter table public.expertise_embeddings enable row level security;
-- No SELECT/INSERT/UPDATE/DELETE policies for authenticated — the table
-- is only accessible via the FastAPI service role (which bypasses RLS).
