-- =============================================================
-- Solana Trading Agent — Supabase Schema
-- Run this in the Supabase SQL editor after creating a project.
-- =============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- =============================================================
-- trades — Every position (open and closed)
-- =============================================================
CREATE TABLE IF NOT EXISTS trades (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thesis_id           UUID,
    token_symbol        TEXT NOT NULL,
    token_mint          TEXT NOT NULL,
    token_name          TEXT,
    direction           TEXT NOT NULL CHECK (direction IN ('buy', 'sell')),
    entry_price         NUMERIC(20,10) NOT NULL,
    exit_price          NUMERIC(20,10),
    take_profit         NUMERIC(20,10) NOT NULL,
    stop_loss           NUMERIC(20,10) NOT NULL,
    position_size_usd   NUMERIC(16,4) NOT NULL,
    entry_token_amount  NUMERIC(30,10),
    confidence_score    NUMERIC(4,3),
    reasoning           TEXT,
    signals             JSONB DEFAULT '{}',
    status              TEXT NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open','tp_hit','sl_hit','expired','manual_close','pending_approval')),
    jupiter_order_id    TEXT,
    entry_tx            TEXT,
    exit_tx             TEXT,
    realized_pnl        NUMERIC(16,4),
    realized_pnl_pct    NUMERIC(10,6),
    profit_routed       BOOLEAN DEFAULT FALSE,
    profit_route_tx     TEXT,
    opened_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trades_status        ON trades(status);
CREATE INDEX idx_trades_token_mint    ON trades(token_mint);
CREATE INDEX idx_trades_opened_at     ON trades(opened_at DESC);
CREATE INDEX idx_trades_jupiter_order ON trades(jupiter_order_id);


-- =============================================================
-- theses — Every LLM-generated thesis (executed, rejected, no-trade)
-- =============================================================
CREATE TABLE IF NOT EXISTS theses (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_symbol      TEXT NOT NULL,
    token_mint        TEXT NOT NULL,
    direction         TEXT NOT NULL CHECK (direction IN ('buy', 'sell')),
    entry_price       NUMERIC(20,10),
    take_profit       NUMERIC(20,10),
    stop_loss         NUMERIC(20,10),
    position_size_usd NUMERIC(16,4),
    confidence_score  NUMERIC(4,3),
    reasoning         TEXT,
    signals           JSONB DEFAULT '{}',
    risk_reward_ratio NUMERIC(8,4),
    disposition       TEXT NOT NULL
                          CHECK (disposition IN (
                              'executed','rejected_risk','rejected_manual',
                              'no_trade','pending_approval','execution_failed'
                          )),
    rejection_reason  TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_theses_disposition ON theses(disposition);
CREATE INDEX idx_theses_created_at  ON theses(created_at DESC);
CREATE INDEX idx_theses_token_mint  ON theses(token_mint);


-- =============================================================
-- circuit_breaker_events — Halt / resume history
-- =============================================================
CREATE TABLE IF NOT EXISTS circuit_breaker_events (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type                      TEXT NOT NULL CHECK (type IN ('halt', 'resume')),
    reason                    TEXT NOT NULL,
    daily_loss_pct            NUMERIC(8,4),
    consecutive_losses        INT,
    drawdown_from_peak_pct    NUMERIC(8,4),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cb_events_created_at ON circuit_breaker_events(created_at DESC);


-- =============================================================
-- circuit_breaker_state — Current state (single row)
-- =============================================================
CREATE TABLE IF NOT EXISTS circuit_breaker_state (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default state
INSERT INTO circuit_breaker_state (key, value) VALUES (
    'circuit_breaker_state',
    '{
        "dailyLossPct": 0,
        "consecutiveLosses": 0,
        "drawdownFromPeakPct": 0,
        "isTradingHalted": false
    }'::JSONB
) ON CONFLICT (key) DO NOTHING;


-- =============================================================
-- daily_performance — One row per calendar day
-- =============================================================
CREATE TABLE IF NOT EXISTS daily_performance (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date                  DATE NOT NULL UNIQUE,
    starting_balance_usd  NUMERIC(16,4),
    ending_balance_usd    NUMERIC(16,4),
    realized_pnl          NUMERIC(16,4),
    realized_pnl_pct      NUMERIC(10,6),
    trades_taken          INT DEFAULT 0,
    trades_won            INT DEFAULT 0,
    trades_lost           INT DEFAULT 0,
    win_rate              NUMERIC(5,4),
    avg_winner_pct        NUMERIC(8,4),
    avg_loser_pct         NUMERIC(8,4),
    max_drawdown_pct      NUMERIC(8,4),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_daily_performance_date ON daily_performance(date DESC);


-- =============================================================
-- agent_activity — Live feed of agent actions
-- =============================================================
CREATE TABLE IF NOT EXISTS agent_activity (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            TEXT NOT NULL,
    title           TEXT NOT NULL,
    details         TEXT,
    token_symbol    TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_activity_created_at ON agent_activity(created_at DESC);
CREATE INDEX idx_agent_activity_type       ON agent_activity(type);


-- =============================================================
-- Row Level Security (for dashboard access)
-- =============================================================

-- Enable RLS on all tables
ALTER TABLE trades                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE theses                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE circuit_breaker_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE circuit_breaker_state   ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_performance       ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_activity          ENABLE ROW LEVEL SECURITY;

-- Allow anonymous read-only access (for the dashboard using anon key)
-- Restrict to SELECT only — anon key cannot write
CREATE POLICY "anon_select_trades"
    ON trades FOR SELECT USING (TRUE);

CREATE POLICY "anon_select_theses"
    ON theses FOR SELECT USING (TRUE);

CREATE POLICY "anon_select_cb_events"
    ON circuit_breaker_events FOR SELECT USING (TRUE);

CREATE POLICY "anon_select_cb_state"
    ON circuit_breaker_state FOR SELECT USING (TRUE);

CREATE POLICY "anon_select_daily_performance"
    ON daily_performance FOR SELECT USING (TRUE);

CREATE POLICY "anon_select_agent_activity"
    ON agent_activity FOR SELECT USING (TRUE);

-- Service role (agent) can do everything (bypasses RLS by default)


-- =============================================================
-- daily_watchlist — Top 10 ranked candidates per day
-- Morning scan at 5 AM PST generates the initial list.
-- Regular loops re-score and re-rank throughout the day.
-- =============================================================
CREATE TABLE IF NOT EXISTS daily_watchlist (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_date           DATE NOT NULL,
    rank                INT NOT NULL CHECK (rank >= 1 AND rank <= 10),
    token_symbol        TEXT NOT NULL,
    token_mint          TEXT NOT NULL,
    token_name          TEXT,
    thesis              TEXT NOT NULL,
    signals             JSONB DEFAULT '{}',
    confidence          NUMERIC(4,3) NOT NULL,
    rr_ratio            NUMERIC(8,4) NOT NULL,
    entry_price_target  NUMERIC(20,10),
    tp_target           NUMERIC(20,10),
    sl_target           NUMERIC(20,10),
    current_price       NUMERIC(20,10),
    last_score          NUMERIC(6,3) NOT NULL DEFAULT 0,
    score_history       JSONB DEFAULT '[]',
    status              TEXT NOT NULL DEFAULT 'watching'
                            CHECK (status IN ('watching', 'taken', 'dropped')),
    trade_id            UUID REFERENCES trades(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_watchlist_date_rank ON daily_watchlist(scan_date, rank);
CREATE INDEX idx_watchlist_date ON daily_watchlist(scan_date DESC);
CREATE INDEX idx_watchlist_status ON daily_watchlist(status);
CREATE INDEX idx_watchlist_token ON daily_watchlist(token_symbol);

ALTER TABLE daily_watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_daily_watchlist"
    ON daily_watchlist FOR SELECT USING (TRUE);


-- =============================================================
-- Useful views for the dashboard
-- =============================================================

-- Win/loss stats overview
CREATE OR REPLACE VIEW trade_stats AS
SELECT
    COUNT(*) FILTER (WHERE status IN ('tp_hit','sl_hit','expired','manual_close')) AS total_closed,
    COUNT(*) FILTER (WHERE status = 'tp_hit') AS total_wins,
    COUNT(*) FILTER (WHERE status = 'sl_hit') AS total_losses,
    COUNT(*) FILTER (WHERE status = 'open') AS open_positions,
    COALESCE(
        COUNT(*) FILTER (WHERE status = 'tp_hit')::FLOAT
        / NULLIF(COUNT(*) FILTER (WHERE status IN ('tp_hit','sl_hit')), 0),
        0
    ) AS win_rate,
    COALESCE(SUM(realized_pnl) FILTER (WHERE realized_pnl IS NOT NULL), 0) AS total_pnl,
    COALESCE(AVG(realized_pnl_pct) FILTER (WHERE status = 'tp_hit'), 0) AS avg_winner_pct,
    COALESCE(AVG(realized_pnl_pct) FILTER (WHERE status = 'sl_hit'), 0) AS avg_loser_pct
FROM trades;
