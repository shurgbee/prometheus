-- Optional: single-model LIVE databases with EMBED_DIMENSIONS=2048 only.
-- Stop API and worker; back up DB. Confirm every existing vector has 2048 dimensions first.
-- If using another dimension, edit all four declarations below before applying.
-- Do not mix demo and live vectors in a database used by these indexes.
CREATE EXTENSION IF NOT EXISTS vectorscale CASCADE;
ALTER TABLE reports ALTER COLUMN summary_embedding TYPE vector(2048);
ALTER TABLE report_chunks ALTER COLUMN embedding TYPE vector(2048);
CREATE INDEX IF NOT EXISTS reports_summary_diskann
    ON reports USING diskann (summary_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS report_chunks_diskann
    ON report_chunks USING diskann (embedding vector_cosine_ops);
