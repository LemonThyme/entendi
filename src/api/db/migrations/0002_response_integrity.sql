-- 0002_response_integrity.sql
-- Adds response integrity detection: feature storage, integrity scores, user response profiles

-- Add response feature columns to assessment_events
ALTER TABLE assessment_events ADD COLUMN IF NOT EXISTS response_features jsonb;
ALTER TABLE assessment_events ADD COLUMN IF NOT EXISTS integrity_score real;

-- User response profiles for baseline comparison
CREATE TABLE IF NOT EXISTS response_profiles (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  avg_word_count real NOT NULL DEFAULT 0,
  avg_char_count real NOT NULL DEFAULT 0,
  avg_chars_per_second real NOT NULL DEFAULT 0,
  avg_formatting_score real NOT NULL DEFAULT 0,
  avg_vocab_complexity real NOT NULL DEFAULT 0,
  sample_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
