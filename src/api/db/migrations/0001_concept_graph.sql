-- Migration: concept graph normalization, embeddings, and enrichment
-- Depends on: initial schema (concepts, concept_edges tables)

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Concept embeddings (bge-base-en-v1.5 = 768 dimensions)
CREATE TABLE IF NOT EXISTS concept_embeddings (
  concept_id TEXT PRIMARY KEY REFERENCES concepts(id) ON DELETE CASCADE,
  embedding vector(768) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- IVFFlat index for cosine similarity search
-- Note: requires sufficient rows to build effectively; commented until population grows
-- CREATE INDEX idx_concept_embeddings_ivfflat
--   ON concept_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Concept aliases for normalization
CREATE TABLE IF NOT EXISTS concept_aliases (
  alias TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_concept_aliases_canonical ON concept_aliases(canonical_id);

-- Add description to concepts (for enrichment output / embedding generation)
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

-- Add source to concept_edges (track how the edge was created: 'llm', 'manual', 'data')
ALTER TABLE concept_edges ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
