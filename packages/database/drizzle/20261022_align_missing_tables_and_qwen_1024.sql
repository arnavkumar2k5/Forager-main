-- Forager Database Migration: Align Missing Tables with 1024-dim Embeddings
-- Idempotent, safe migration that preserves existing tables and data.
-- Target missing tables: propositions, scent_metrics, veracity_audits, match_propositions RPC

-- 1. Enable pgvector extension for embedding storage and similarity indexing
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create propositions table with vector(1024)
CREATE TABLE IF NOT EXISTS "propositions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scout_id" uuid NOT NULL,
  "execution_id" uuid,
  "content" text NOT NULL,
  "source_url" text NOT NULL,
  "dom_selector" text,
  "confidence" real DEFAULT 1.0,
  "embedding" vector(1024),
  "status" text DEFAULT 'active',
  "created_at" timestamp with time zone DEFAULT now()
);

-- Foreign keys for propositions
DO $$ BEGIN
  ALTER TABLE "propositions"
    ADD CONSTRAINT "propositions_scout_id_scouts_id_fk"
    FOREIGN KEY ("scout_id") REFERENCES "public"."scouts"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "propositions"
    ADD CONSTRAINT "propositions_execution_id_scout_executions_id_fk"
    FOREIGN KEY ("execution_id") REFERENCES "public"."scout_executions"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Indexes for propositions
CREATE INDEX IF NOT EXISTS "propositions_scout_id_status_idx"
  ON "propositions" ("scout_id", "status");

CREATE INDEX IF NOT EXISTS "propositions_embedding_hnsw_idx"
  ON "propositions" USING hnsw ("embedding" vector_cosine_ops);

-- 3. Create scent_metrics table (Adaptive Scent-Driven Polling Engine)
CREATE TABLE IF NOT EXISTS "scent_metrics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scout_id" uuid NOT NULL,
  "drift_score" real NOT NULL,
  "volatility_factor" real NOT NULL,
  "base_interval_minutes" integer NOT NULL,
  "computed_interval_minutes" integer NOT NULL,
  "next_run_at" timestamp with time zone NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now()
);

-- Foreign key for scent_metrics
DO $$ BEGIN
  ALTER TABLE "scent_metrics"
    ADD CONSTRAINT "scent_metrics_scout_id_scouts_id_fk"
    FOREIGN KEY ("scout_id") REFERENCES "public"."scouts"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "scent_metrics_scout_id_idx"
  ON "scent_metrics" ("scout_id");

-- 4. Create veracity_audits table (Multi-Source Triangulation)
CREATE TABLE IF NOT EXISTS "veracity_audits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scout_id" uuid,
  "execution_id" uuid,
  "claim" text NOT NULL,
  "overall_confidence" real NOT NULL,
  "independent_sources_count" integer NOT NULL,
  "citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "has_contradiction" boolean DEFAULT false,
  "contradiction_details" text,
  "audit_passed" boolean NOT NULL,
  "created_at" timestamp with time zone DEFAULT now()
);

-- Foreign keys for veracity_audits
DO $$ BEGIN
  ALTER TABLE "veracity_audits"
    ADD CONSTRAINT "veracity_audits_scout_id_scouts_id_fk"
    FOREIGN KEY ("scout_id") REFERENCES "public"."scouts"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "veracity_audits"
    ADD CONSTRAINT "veracity_audits_execution_id_scout_executions_id_fk"
    FOREIGN KEY ("execution_id") REFERENCES "public"."scout_executions"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "veracity_audits_scout_id_idx"
  ON "veracity_audits" ("scout_id");

-- 5. RPC function for vector cosine similarity search (1024-dim Embeddings)
CREATE OR REPLACE FUNCTION match_propositions (
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.78,
  match_count int DEFAULT 10,
  filter_scout_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  scout_id uuid,
  content text,
  similarity float
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.scout_id,
    p.content,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM propositions p
  WHERE p.embedding IS NOT NULL
    AND (filter_scout_id IS NULL OR p.scout_id = filter_scout_id)
    AND 1 - (p.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;
