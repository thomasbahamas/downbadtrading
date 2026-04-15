-- =============================================================
-- Migration 001: Read-only pools scaffolding
-- =============================================================
--
-- Adds a `pools` table and a `pool_id` column on every user-facing
-- table. All existing rows are backfilled into a single default pool
-- named "main" so nothing breaks. The agent still runs as a single
-- instance with a single wallet — this migration is ONLY the data
-- model scaffolding to support showing multiple pools in the
-- dashboard later.
--
-- This migration is intentionally safe to run on a live database:
--  - All new columns are nullable (then defaulted) and backfilled
--  - No data is deleted or moved
--  - RLS policies on anon access are unchanged (still public read)
--
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================


-- =============================================================
-- pools — Trading pools the dashboard can switch between
-- =============================================================
CREATE TABLE IF NOT EXISTS pools (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    description     TEXT,
    wallet_address  TEXT,          -- trading wallet for this pool (nullable for now)
    profit_wallet   TEXT,          -- profit-routing destination (nullable for now)
    is_public       BOOLEAN NOT NULL DEFAULT FALSE,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    display_order   INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one row may be the default; enforce via partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_pools_single_default
    ON pools (is_default)
    WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_pools_display_order ON pools(display_order);
CREATE INDEX IF NOT EXISTS idx_pools_slug          ON pools(slug);

ALTER TABLE pools ENABLE ROW LEVEL SECURITY;

-- Dashboard (anon key) can read pools; writes require service role
DROP POLICY IF EXISTS "anon_select_pools" ON pools;
CREATE POLICY "anon_select_pools"
    ON pools FOR SELECT USING (TRUE);


-- =============================================================
-- Seed the default "main" pool if missing
-- =============================================================
INSERT INTO pools (slug, name, description, is_default, is_public, display_order)
VALUES (
    'main',
    'Main Pool',
    'Primary DownBad trading pool — autonomous Solana DeFi agent',
    TRUE,
    FALSE,
    0
)
ON CONFLICT (slug) DO NOTHING;


-- =============================================================
-- Add pool_id to every table that stores trading activity
-- =============================================================

-- Shared helper: add a nullable pool_id, backfill to main, add FK + index.
-- We can't wrap ALTER TABLE in a function, so we just repeat the pattern.

-- trades
ALTER TABLE trades              ADD COLUMN IF NOT EXISTS pool_id UUID;
UPDATE trades              SET pool_id = (SELECT id FROM pools WHERE slug = 'main')
    WHERE pool_id IS NULL;
ALTER TABLE trades
    DROP CONSTRAINT IF EXISTS fk_trades_pool;
ALTER TABLE trades
    ADD CONSTRAINT fk_trades_pool FOREIGN KEY (pool_id)
        REFERENCES pools(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_trades_pool_id ON trades(pool_id);

-- theses
ALTER TABLE theses              ADD COLUMN IF NOT EXISTS pool_id UUID;
UPDATE theses              SET pool_id = (SELECT id FROM pools WHERE slug = 'main')
    WHERE pool_id IS NULL;
ALTER TABLE theses
    DROP CONSTRAINT IF EXISTS fk_theses_pool;
ALTER TABLE theses
    ADD CONSTRAINT fk_theses_pool FOREIGN KEY (pool_id)
        REFERENCES pools(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_theses_pool_id ON theses(pool_id);

-- daily_performance
ALTER TABLE daily_performance   ADD COLUMN IF NOT EXISTS pool_id UUID;
UPDATE daily_performance   SET pool_id = (SELECT id FROM pools WHERE slug = 'main')
    WHERE pool_id IS NULL;
ALTER TABLE daily_performance
    DROP CONSTRAINT IF EXISTS fk_daily_performance_pool;
ALTER TABLE daily_performance
    ADD CONSTRAINT fk_daily_performance_pool FOREIGN KEY (pool_id)
        REFERENCES pools(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_daily_performance_pool_id ON daily_performance(pool_id);

-- agent_activity
ALTER TABLE agent_activity      ADD COLUMN IF NOT EXISTS pool_id UUID;
UPDATE agent_activity      SET pool_id = (SELECT id FROM pools WHERE slug = 'main')
    WHERE pool_id IS NULL;
ALTER TABLE agent_activity
    DROP CONSTRAINT IF EXISTS fk_agent_activity_pool;
ALTER TABLE agent_activity
    ADD CONSTRAINT fk_agent_activity_pool FOREIGN KEY (pool_id)
        REFERENCES pools(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_agent_activity_pool_id ON agent_activity(pool_id);

-- daily_watchlist
ALTER TABLE daily_watchlist     ADD COLUMN IF NOT EXISTS pool_id UUID;
UPDATE daily_watchlist     SET pool_id = (SELECT id FROM pools WHERE slug = 'main')
    WHERE pool_id IS NULL;
ALTER TABLE daily_watchlist
    DROP CONSTRAINT IF EXISTS fk_daily_watchlist_pool;
ALTER TABLE daily_watchlist
    ADD CONSTRAINT fk_daily_watchlist_pool FOREIGN KEY (pool_id)
        REFERENCES pools(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_daily_watchlist_pool_id ON daily_watchlist(pool_id);


-- =============================================================
-- pool_stats view — aggregated per-pool numbers for the dashboard
-- =============================================================
CREATE OR REPLACE VIEW pool_stats AS
SELECT
    p.id                                                              AS pool_id,
    p.slug,
    p.name,
    p.is_default,
    COUNT(t.id)                                                        AS total_trades,
    COUNT(t.id) FILTER (WHERE t.status = 'open')                       AS open_positions,
    COUNT(t.id) FILTER (WHERE t.status = 'tp_hit')                     AS wins,
    COUNT(t.id) FILTER (WHERE t.status = 'sl_hit')                     AS losses,
    COALESCE(
        COUNT(t.id) FILTER (WHERE t.status = 'tp_hit')::FLOAT
        / NULLIF(COUNT(t.id) FILTER (WHERE t.status IN ('tp_hit','sl_hit')), 0),
        0
    )                                                                  AS win_rate,
    COALESCE(SUM(t.realized_pnl) FILTER (WHERE t.realized_pnl IS NOT NULL), 0) AS total_pnl
FROM pools p
LEFT JOIN trades t ON t.pool_id = p.id
GROUP BY p.id, p.slug, p.name, p.is_default, p.display_order
ORDER BY p.display_order;
