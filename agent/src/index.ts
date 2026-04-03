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
import { SupabaseClient as DBClient } from './db/client';
import { createInitialState } from './loop/graph';
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
      agentState = await graph.invoke({
        ...agentState,
        loopCount: globalLoopCount,
        error: null,
      });

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

    // Sleep until next interval, accounting for loop duration
    const elapsed = Date.now() - loopStart;
    const sleepMs = Math.max(0, config.loopIntervalSeconds * 1000 - elapsed);
    if (sleepMs > 0 && !shutdownRequested) {
      logger.debug(`Sleeping ${Math.round(sleepMs / 1000)}s until next loop`);
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
  await runLoop();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
