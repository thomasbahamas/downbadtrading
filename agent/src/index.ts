/**
 * index.ts — Agent entry point.
 *
 * Responsibilities:
 *  1. Validate config (fails fast)
 *  2. Start a minimal HTTP server for Railway health checks
 *  3. Initialize all clients (Supabase, Telegram, Jupiter, etc.)
 *  4. Run the LangGraph agent loop on a configured interval
 *  5. Handle graceful shutdown on SIGTERM/SIGINT
 */

import { config } from './config';
import { createLogger } from './utils/logger';
import { createAgentGraph } from './loop/graph';
import { TelegramClient } from './notifications/telegram';
import { getSupabaseClient } from './db/client';
import { logActivity } from './db/activity';
import { createInitialState } from './loop/graph';
import { scheduleMorningScan } from './loop/scheduler';
import http from 'http';

const logger = createLogger('index');

// ─── Health server ──────────────────────────────────────────────────────────

function startHealthServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          uptime: process.uptime(),
          loopCount: globalLoopCount,
          paperTrade: config.paperTrade,
          timestamp: new Date().toISOString(),
        })
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port, () => {
    logger.info(`Health server listening on port ${port}`);
  });
  return server;
}

// ─── Loop state ────────────────────────────────────────────────────────────

let globalLoopCount = 0;
let isRunning = false;
let shutdownRequested = false;

// ─── Main loop ─────────────────────────────────────────────────────────────

async function runLoop(): Promise<void> {
  const telegram = new TelegramClient(config);
  const graph = await createAgentGraph(config);
  let agentState = createInitialState(config.profitWalletAddress);

  // Load any existing open positions from DB at startup
  try {
    const db = new (await import('./db/trades')).TradeRepository(config);
    const openPositions = await db.getOpenPositions();
    agentState.activePositions = openPositions;
    if (openPositions.length > 0) {
      logger.info(`Loaded ${openPositions.length} open positions from DB at startup`);
    }
  } catch (err) {
    logger.debug(`Failed to load positions at startup: ${err instanceof Error ? err.message : String(err)}`);
  }

  logger.info(
    `Agent starting. paper_trade=${config.paperTrade} ` +
      `interval=${config.loopIntervalSeconds}s ` +
      `max_auto_usd=$${config.maxAutoTradeUsd}`
  );

  if (config.paperTrade) {
    logger.warn('⚠️  PAPER TRADE MODE — no real transactions will be sent');
    await telegram.sendMessage({
      type: 'error',
      content: '🟡 Agent started in PAPER TRADE mode. Monitoring markets only.',
      priority: 'normal',
    });
  } else {
    await telegram.sendMessage({
      type: 'trade_thesis',
      content: '🟢 Trading agent started.',
      priority: 'low',
    });
  }

  while (!shutdownRequested) {
    isRunning = true;
    globalLoopCount++;
    const loopStart = Date.now();

    try {
      logger.info(`--- Loop #${globalLoopCount} ---`);
      const result = await graph.invoke({
        ...agentState,
        loopCount: globalLoopCount,
        rotationTarget: null,
        error: null,
      });
      agentState = result as unknown as import('./types').AgentState;

      // Write heartbeat to Supabase so dashboard can read agent status
      try {
        const supabase = getSupabaseClient(config);
        await supabase.from('circuit_breaker_state').upsert({
          key: 'agent_heartbeat',
          value: {
            status: 'running',
            loopCount: globalLoopCount,
            paperTrade: config.paperTrade,
            uptime: Math.floor(process.uptime()),
            activePositions: agentState.activePositions?.length ?? 0,
            portfolioValueUsd: agentState.portfolio?.totalValueUsd ?? 0,
            usdcBalance: agentState.portfolio?.usdcBalance ?? 0,
            solBalance: agentState.portfolio?.solBalance ?? 0,
            holdings: (agentState.portfolio?.holdings ?? [])
              .filter(h => h.valueUsd > 0)
              .map(h => ({ symbol: h.symbol, mint: h.mint, amount: h.amount, valueUsd: h.valueUsd })),
            timestamp: new Date().toISOString(),
            lastError: agentState.error ?? null,
          },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });
      } catch (hbErr) {
        logger.debug(`Heartbeat write failed: ${hbErr instanceof Error ? hbErr.message : String(hbErr)}`);
      }

      // Write loop summary for the dashboard journal
      const loopSummary = buildLoopSummary(agentState, globalLoopCount);
      await logActivity(config, 'loop_summary', loopSummary.title, loopSummary.details, loopSummary.token, loopSummary.metadata);

      if (agentState.error) {
        logger.error(`Loop #${globalLoopCount} completed with error: ${agentState.error}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Unhandled error in loop #${globalLoopCount}: ${message}`, { err });
      await telegram.sendMessage({
        type: 'error',
        content: `⚠️ Agent loop error #${globalLoopCount}: ${message}`,
        priority: 'high',
      });
    } finally {
      isRunning = false;
    }

    // Sleep until next interval, accounting for loop duration.
    // Interval is adaptive — see computeAdaptiveInterval for the rules.
    const elapsed = Date.now() - loopStart;
    const intervalSeconds = computeAdaptiveInterval(agentState, config.loopIntervalSeconds);
    const sleepMs = Math.max(0, intervalSeconds * 1000 - elapsed);
    if (sleepMs > 0 && !shutdownRequested) {
      if (intervalSeconds !== config.loopIntervalSeconds) {
        logger.info(`Sleeping ${Math.round(sleepMs / 1000)}s (adaptive, base ${config.loopIntervalSeconds}s)`);
      } else {
        logger.debug(`Sleeping ${Math.round(sleepMs / 1000)}s until next loop`);
      }
      await sleep(sleepMs);
    }
  }

  logger.info('Agent loop exited cleanly.');
}

// ─── Shutdown handler ──────────────────────────────────────────────────────

function setupGracefulShutdown(server: http.Server): void {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Initiating graceful shutdown…`);
    shutdownRequested = true;

    // Wait for current loop iteration to finish
    const waitStart = Date.now();
    while (isRunning && Date.now() - waitStart < 30_000) {
      await sleep(500);
    }

    server.close(() => {
      logger.info('Health server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { err });
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
    process.exit(1);
  });
}

// ─── Entrypoint ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const server = startHealthServer(config.port);
  setupGracefulShutdown(server);

  // Schedule daily morning scan at 5 AM PST
  scheduleMorningScan(config);

  await runLoop();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Adaptive loop interval ──────────────────────────────────────────────
// Extends the sleep between loops when nothing is happening — cuts LLM call
// frequency (and spend) on quiet days without compromising responsiveness
// when positions are open or volatility is elevated.
//
// Rules (longest wins):
//  - Open positions → never slower than base (positions need monitoring)
//  - Volatile market (hot token mover or CEX listing) → base interval
//  - Quiet market (no hot tokens, neutral F&G) → 1.5× base
//  - Dead market (extreme fear/greed, no movers) → 2× base
//  - Hard ceiling: 600s (10 min) regardless
function computeAdaptiveInterval(
  state: import('./types').AgentState,
  baseSeconds: number
): number {
  // If positions are open, always use base interval — we need to catch fills
  // and rotation opportunities responsively.
  const openPositions = state.activePositions?.length ?? 0;
  if (openPositions > 0) return baseSeconds;

  const snapshot = state.marketSnapshot;
  if (!snapshot) return baseSeconds; // no data → default

  const fg = snapshot.globalMetrics.fearGreedIndex;
  const hasHotToken = snapshot.tokens.some(
    (t) => Math.abs(t.priceChange1h ?? 0) > 5
  );
  const hasCexListing = (snapshot.newListings?.length ?? 0) > 0;

  // Volatility signal — keep base interval
  if (hasHotToken || hasCexListing) return baseSeconds;

  // Dead market — fear/greed extreme AND no movers → slowest
  if (fg > 0 && (fg < 20 || fg > 80)) {
    return Math.min(baseSeconds * 2, 600);
  }

  // Quiet but not dead — slow down slightly
  return Math.min(Math.round(baseSeconds * 1.5), 600);
}

function buildLoopSummary(state: import('./types').AgentState, loopNum: number): {
  title: string;
  details: string;
  token: string | undefined;
  metadata: Record<string, unknown>;
} {
  const tokensScanned = state.marketSnapshot?.tokens.length ?? 0;
  const hadThesis = !!state.thesis;
  const wasApproved = !!state.riskApproval?.approved;
  const wasExecuted = !!state.executionResult?.success;
  const wasRotation = !!state.rotationTarget;
  const token = state.thesis?.token.symbol;
  const rotatedFrom = state.rotationTarget?.token.symbol;

  let title: string;
  if (wasExecuted && wasRotation) {
    title = `Loop #${loopNum}: Scanned ${tokensScanned} tokens → Rotated: closed ${rotatedFrom} → entered ${token}`;
  } else if (wasExecuted) {
    title = `Loop #${loopNum}: Scanned ${tokensScanned} tokens → Generated thesis on ${token} → Approved → Executed`;
  } else if (hadThesis && !wasApproved) {
    title = `Loop #${loopNum}: Scanned ${tokensScanned} tokens → Generated thesis on ${token} → Rejected by risk engine`;
  } else if (hadThesis && wasApproved) {
    title = `Loop #${loopNum}: Scanned ${tokensScanned} tokens → Generated thesis on ${token} → Approved (execution pending)`;
  } else {
    title = `Loop #${loopNum}: Scanned ${tokensScanned} tokens → No trade opportunity identified`;
  }

  const details = [
    `${tokensScanned} tokens scanned`,
    hadThesis ? `Thesis: ${token}` : 'No thesis generated',
    wasApproved ? 'Risk: approved' : hadThesis ? `Risk: rejected — ${state.riskApproval?.reason ?? 'unknown'}` : '',
    wasExecuted ? 'Execution: success' : '',
    `${state.activePositions?.length ?? 0} open positions`,
  ].filter(Boolean).join(' | ');

  return {
    title,
    details,
    token,
    metadata: {
      loopNumber: loopNum,
      tokensScanned,
      hadThesis,
      thesisToken: token ?? null,
      thesisConfidence: state.thesis?.confidenceScore ?? null,
      wasApproved,
      rejectionReason: (!wasApproved && hadThesis) ? (state.riskApproval?.reason ?? null) : null,
      wasExecuted,
      wasRotation,
      rotatedFrom: rotatedFrom ?? null,
      openPositions: state.activePositions?.length ?? 0,
    },
  };
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
