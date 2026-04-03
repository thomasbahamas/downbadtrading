#!/usr/bin/env bash
# =============================================================
# setup.sh — One-command project setup
# =============================================================
set -euo pipefail

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║   Solana Trading Agent — Setup       ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# ── Check prerequisites ────────────────────────────────────────────────────

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "  ❌ Required tool not found: $1"
    echo "     Install it and re-run setup."
    exit 1
  fi
}

check_cmd node
check_cmd npm

NODE_VERSION=$(node --version | cut -d. -f1 | tr -d 'v')
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "  ❌ Node.js 20+ required (found v$(node --version))"
  exit 1
fi

echo "  ✓ Node.js $(node --version)"
echo "  ✓ npm $(npm --version)"
echo ""

# ── Install dependencies ───────────────────────────────────────────────────

echo "  📦 Installing dependencies…"
npm install --workspaces
echo "  ✓ Dependencies installed"
echo ""

# ── Create .env files ──────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

if [ ! -f "$ROOT_DIR/.env" ]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  echo "  ✓ Created .env from .env.example"
else
  echo "  · .env already exists, skipping"
fi

if [ ! -f "$ROOT_DIR/dashboard/.env.local" ]; then
  cp "$ROOT_DIR/dashboard/.env.example" "$ROOT_DIR/dashboard/.env.local"
  echo "  ✓ Created dashboard/.env.local"
fi

echo ""
echo "  ════════════════════════════════════════"
echo "  ✅ Setup complete!"
echo ""
echo "  Next steps:"
echo ""
echo "  1. Open .env and fill in your API keys:"
echo "     - SOLANA_PRIVATE_KEY       (base58 trading wallet key)"
echo "     - PROFIT_WALLET_ADDRESS    (cold wallet pubkey)"
echo "     - HELIUS_API_KEY           (from helius.dev)"
echo "     - JUPITER_API_KEY          (request at dev.jup.ag)"
echo "     - ANTHROPIC_API_KEY        (claude.ai/api)"
echo "     - BIRDEYE_API_KEY          (birdeye.so)"
echo "     - COINGECKO_API_KEY        (coingecko.com/api)"
echo "     - TELEGRAM_BOT_TOKEN       (@BotFather)"
echo "     - TELEGRAM_CHAT_ID         (@userinfobot)"
echo "     - SUPABASE_URL / keys      (supabase.com)"
echo ""
echo "  2. Run the database schema:"
echo "     Copy agent/src/db/schema.sql → Supabase SQL editor"
echo ""
echo "  3. Start the agent in paper trade mode first:"
echo "     npm run paper-trade"
echo ""
echo "  4. When ready for live trading:"
echo "     npm run dev:agent"
echo ""
echo "  5. Start the dashboard:"
echo "     npm run dev:dashboard"
echo ""
echo "  See CLAUDE.md for full documentation."
echo "  ════════════════════════════════════════"
echo ""
