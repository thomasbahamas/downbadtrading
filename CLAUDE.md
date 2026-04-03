# Solana Autonomous Trading Agent

## Overview

An autonomous DeFi token swap trading agent on Solana. Uses an LLM (Claude/GPT-4o) to analyze
market data, generate trade theses, and execute trades through Jupiter with automated
take-profit/stop-loss management.

## Architecture

- **Agent** (`/agent`): Long-running Node.js process deployed on Railway. Runs a LangGraph state
  machine that continuously observes markets, analyzes opportunities, executes trades, and manages
  positions.
- **Dashboard** (`/dashboard`): Next.js app deployed on Vercel. Reads from shared Supabase database
  to display live portfolio, trade history, and performance metrics.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 / TypeScript 5 |
| Agent Framework | Solana Agent Kit + LangGraph (LangChain) |
| Execution | Jupiter Ultra API (swaps) + Jupiter Trigger V2 API (OCO/OTOCO orders for TP/SL) |
| Data | Birdeye API, CoinGecko API, Pyth oracle feeds, Helius Enhanced WebSockets |
| Database | Supabase (PostgreSQL) |
| Notifications | Telegram Bot API |
| Dashboard | Next.js 14 + Tailwind CSS |
| Deployment | Railway (agent) + Vercel (dashboard) |

## Solana Skills

Run these to give yourself context on each protocol before implementing:

```bash
npx skills add https://github.com/solana-foundation/solana-dev-skill  # official Solana dev skill
npx skills add jup-ag/agent-skills  # Jupiter: swaps, limit orders, DCA, lending
```

Community skills at https://solana.com/skills for: CoinGecko, Helius, Pyth, Raydium, Meteora,
Orca, Squads.

## Key Design Decisions

1. **Jupiter Trigger V2 for all exits** — Every trade entry is paired with an OCO (take-profit +
   stop-loss) order via Trigger V2. Orders are stored off-chain by Jupiter (MEV-protected). Docs:
   https://dev.jup.ag/docs/trigger

2. **Risk engine has veto power** — The LLM suggests trades; the risk engine (deterministic code)
   can reject any trade. Position limits are enforced in code, not by LLM judgment.

3. **Profit routing** — After a profitable trade closes, the profit delta is automatically
   transferred to `PROFIT_WALLET_ADDRESS`. Base capital stays in the trading wallet.

4. **Autonomous with limits** — Trades under `MAX_AUTO_TRADE_USD` (default $500) execute
   automatically. Above that, the agent sends a Telegram approval request and waits.

5. **No Drift Protocol** — Do not use or reference Drift anywhere in this codebase. It was hacked.

---

## Agent Loop (LangGraph State Machine)

```
OBSERVE → ANALYZE → DECIDE ──(rejected)──→ MONITOR → (back to OBSERVE)
                       │
                    (approved)
                       ↓
                   EXECUTE → REPORT → MONITOR → (back to OBSERVE)
```

### Node responsibilities:

| Node | File | What it does |
|---|---|---|
| OBSERVE | `loop/observe.ts` | Fetch market data from Birdeye, Pyth, Helius; build MarketSnapshot |
| ANALYZE | `loop/analyze.ts` | Pass snapshot + portfolio to LLM; get back TradeThesis (or null) |
| DECIDE | `loop/decide.ts` | Run risk engine checks; return RiskApproval |
| EXECUTE | `loop/execute.ts` | Jupiter Ultra swap + Trigger V2 OCO order |
| REPORT | `loop/report.ts` | Send to Telegram + log to Supabase |
| MONITOR | `loop/monitor.ts` | Check open positions, detect fills, route profits |

---

## Jupiter Trigger V2 API Reference

**Base URL:** `https://api.jup.ag/trigger/v2`  
**Auth:** x-api-key header + Authorization Bearer JWT (challenge-response flow)

### Authentication flow (implement in `jupiter/auth.ts`):

```
1. GET  /auth/challenge?walletPubkey=<pubkey>
2. Sign the challenge message with the trading wallet
3. POST /auth/verify { walletPubkey, signature, challenge }
4. Receive JWT → cache with expiry, refresh when expired
```

### Vault flow (implement in `jupiter/trigger.ts`):

```
1. GET  /v2/vault?userPubkey=<pubkey>         → get existing vault
   POST /v2/vault/register { userPubkey }     → create vault if 404
2. POST /v2/deposit/craft { ... }             → get deposit transaction
3. Sign deposit tx client-side
4. POST /v2/orders/price { signedTx, ...params } → create order
```

### OCO Parameters:

```typescript
{
  orderType: 'oco',
  inputMint: '<token_mint>',          // token we're holding
  inputAmount: '<lamports_string>',    // amount to sell
  outputMint: 'So11...11',            // SOL or USDC to receive
  triggerMint: '<token_mint>',        // price feed token
  tpPriceUsd: 1.25,                   // take-profit USD price
  slPriceUsd: 0.85,                   // stop-loss USD price
  tpSlippageBps: undefined,           // undefined = RTSE auto slippage
  slSlippageBps: 2000,                // 20% = execution certainty
  expiresAt: Date.now() + 7*24*3600*1000  // 7 days in ms
}
```

### Important constraints:
- Minimum order: **$10 USD**
- TP price must be **> SL price**
- `expiresAt` is required, future timestamp in milliseconds
- All requests need both `x-api-key` and `Authorization: Bearer <jwt>` headers

---

## What's Already Scaffolded

- ✅ Full project structure with all files
- ✅ Complete TypeScript type definitions (`types.ts`)
- ✅ LangGraph state machine skeleton (`graph.ts`)
- ✅ Jupiter Trigger V2 client with full auth flow skeleton
- ✅ Risk engine with all checks stubbed + circuit breakers
- ✅ Telegram notification formatting
- ✅ Supabase schema + client
- ✅ Dashboard components (Next.js 14 + Tailwind, dark theme)
- ✅ Configuration with zod env validation
- ✅ Docker + Railway deployment configs

---

## What Needs Implementation

Each file has `// TODO:` comments. Key items:

### Data feeds (all in `data/`)
- [ ] `birdeye.ts` — wire up `/defi/token_list`, `/defi/history_price`, `/defi/token_overview` endpoints
- [ ] `coingecko.ts` — wire up `/coins/markets`, `/coins/{id}/market_chart`, global metrics
- [ ] `pyth.ts` — subscribe to Pyth price feed accounts via `@pythnetwork/client`; listen for SOL/USD, ETH/USD, BTC/USD
- [ ] `helius.ts` — Enhanced WebSocket `logsSubscribe` + webhook registration for mint accounts

### LLM integration (`loop/analyze.ts`)
- [ ] Write the system prompt (market analyst persona, signal weights, output schema)
- [ ] Write the user prompt template (inject MarketSnapshot + Portfolio + recent performance)
- [ ] Parse LLM JSON response into `TradeThesis`
- [ ] Handle refusal / no-trade signals

### Jupiter execution (`jupiter/`)
- [ ] Test `ultra.ts` getQuote + getSwapTransaction flow end-to-end on devnet
- [ ] Test `trigger.ts` OCO order creation: deposit → craft → sign → submit
- [ ] Implement `editOrder()` for trailing stop updates
- [ ] Verify `getOrderHistory()` filters and parses fill events correctly

### Position management (`loop/monitor.ts`)
- [ ] Poll `getOrderHistory()` every 30s; detect filled OCO orders
- [ ] Update position status in Supabase on fill
- [ ] Trigger profit routing on profitable closes
- [ ] Implement trailing stop: when price moves 10% above entry, shift SL to breakeven via `editOrder()`

### Dashboard (`dashboard/`)
- [ ] Wire Supabase real-time subscriptions in `ActivePositions.tsx` (postgres_changes)
- [ ] Build performance chart in `PerformanceMetrics.tsx` (use Recharts LineChart)
- [ ] Add approval response endpoint: Telegram webhook → approve/reject pending trade

### Scripts
- [ ] `scripts/paper-trade.ts` — run full loop, skip execute node, log to paper_trades table

---

## Environment Variables

See `.env.example` at the project root and `agent/.env.example`.

```
SOLANA_PRIVATE_KEY          base58-encoded trading wallet private key
PROFIT_WALLET_ADDRESS       Solana pubkey where profits are sent
HELIUS_RPC_URL              wss://mainnet.helius-rpc.com/?api-key=<key>
HELIUS_API_KEY              for REST Enhanced API calls
JUPITER_API_KEY             for Trigger V2 (x-api-key header)
ANTHROPIC_API_KEY           Claude API key (primary LLM)
OPENAI_API_KEY              GPT-4o fallback
BIRDEYE_API_KEY             Birdeye market data API
COINGECKO_API_KEY           CoinGecko Pro API
TELEGRAM_BOT_TOKEN          @BotFather token
TELEGRAM_CHAT_ID            your chat ID for notifications
SUPABASE_URL                https://<project>.supabase.co
SUPABASE_SERVICE_KEY        service_role key (for agent writes)
SUPABASE_ANON_KEY           anon key (for dashboard reads)
```

---

## Running Locally

```bash
# Install all workspaces
npm install

# Copy env and fill in keys
cp .env.example .env

# Run agent in dev mode (with hot reload)
npm run dev:agent

# Run dashboard
npm run dev:dashboard

# Paper trading (no real transactions)
npm run paper-trade
```

## Deployment

```bash
# Agent → Railway
railway link
railway up

# Dashboard → Vercel
cd dashboard
vercel --prod
```

---

## Database Setup

1. Create a Supabase project at https://supabase.com
2. Run `agent/src/db/schema.sql` in the SQL editor
3. Enable Row Level Security if exposing dashboard to the public
4. Copy `SUPABASE_URL` and keys to `.env`

---

## Security Notes

- Never commit `.env` — it's in `.gitignore`
- Private key should be the trading wallet only (keep minimal SOL/USDC balance)
- Profit wallet should be a separate cold wallet
- `SUPABASE_SERVICE_KEY` (used by agent) has full DB access — never expose to frontend
- Dashboard uses `SUPABASE_ANON_KEY` with RLS policies
