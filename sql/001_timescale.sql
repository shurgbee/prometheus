-- Optional Tiger optimization. Run AFTER starting the API once to create the base tables.
-- Run with psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/001_timescale.sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
SELECT create_hypertable('prices', 'ts', if_not_exists => TRUE, migrate_data => TRUE);
SELECT create_hypertable('net_worth_snapshots', 'ts', if_not_exists => TRUE, migrate_data => TRUE);
SELECT create_hypertable('trigger_evaluations', 'ts', if_not_exists => TRUE, migrate_data => TRUE);

-- Keep signal_events relational for exact UNIQUE(trigger_id, source, external_id) replay deduplication.
-- A hypertable would require ts in the unique key and weaken this invariant.
CREATE INDEX IF NOT EXISTS prices_latest ON prices (ticker, ts DESC);
CREATE INDEX IF NOT EXISTS evaluations_trigger_time ON trigger_evaluations (trigger_id, ts DESC);
CREATE INDEX IF NOT EXISTS alerts_trigger_time ON alerts (trigger_id, created_at DESC);

ALTER TABLE prices SET (timescaledb.compress, timescaledb.compress_segmentby = 'ticker');
SELECT add_compression_policy('prices', INTERVAL '7 days', if_not_exists => TRUE);

CREATE MATERIALIZED VIEW IF NOT EXISTS net_worth_daily
WITH (timescaledb.continuous) AS
SELECT time_bucket(INTERVAL '1 day', ts) AS day,
       last(total, ts) AS total, last(cash, ts) AS cash,
       last(cd, ts) AS cd, last(stocks, ts) AS stocks
FROM net_worth_snapshots GROUP BY day WITH NO DATA;
SELECT add_continuous_aggregate_policy('net_worth_daily',
    start_offset => INTERVAL '40 days', end_offset => INTERVAL '0 days',
    schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);
-- API history works without this optimization and groups the daily snapshot table directly.
