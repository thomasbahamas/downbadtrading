/**
 * telegram.ts — Telegram Bot API client.
 *
 * Sends formatted messages for:
 *  - Trade thesis (full formatted message with bars and Solscan links)
 *  - Position updates (TP hit, SL hit, expired)
 *  - Circuit breaker alerts
 *  - Daily P&L summary
 *  - Manual approval requests (inline keyboard for >$500 trades)
 *  - Errors
 *  - Profit routing confirmations
 */

import axios from 'axios';
import type {
  AgentConfig,
  TelegramMessage,
  TradeThesis,
  ExecutionResult,
  ApprovalPayload,
} from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('notifications/telegram');

const TELEGRAM_API = 'https://api.telegram.org';

export class TelegramClient {
  private readonly botToken: string;
  private readonly chatId: string;

  constructor(config: AgentConfig) {
    this.botToken = config.telegramBotToken;
    this.chatId = config.telegramChatId;
  }

  /**
   * Send a generic TelegramMessage.
   */
  async sendMessage(message: TelegramMessage): Promise<void> {
    await this.send(message.content);
  }

  /**
   * Formats and sends a trade thesis message.
   * Includes entry, TP/SL, confidence bar, reasoning, and Solscan link.
   */
  formatTradeThesisMessage(thesis: TradeThesis, result: ExecutionResult): TelegramMessage {
    const directionEmoji = thesis.direction === 'buy' ? '🟢' : '🔴';
    const confidenceBar = this.buildConfidenceBar(thesis.confidenceScore);
    const rrStr = thesis.riskRewardRatio.toFixed(2);
    const tpPct = (
      ((thesis.takeProfitUsd - thesis.entryPriceUsd) / thesis.entryPriceUsd) *
      100
    ).toFixed(1);
    const slPct = (
      ((thesis.entryPriceUsd - thesis.stopLossUsd) / thesis.entryPriceUsd) *
      100
    ).toFixed(1);

    const solscanLink = result.swapTxSignature
      ? `\n🔗 <a href="https://solscan.io/tx/${result.swapTxSignature}">View on Solscan</a>`
      : '';

    const content =
      `${directionEmoji} <b>NEW TRADE: ${thesis.token.symbol}</b>\n\n` +
      `<b>Entry:</b> $${thesis.entryPriceUsd.toFixed(6)}\n` +
      `<b>Take Profit:</b> $${thesis.takeProfitUsd.toFixed(6)} (+${tpPct}%)\n` +
      `<b>Stop Loss:</b> $${thesis.stopLossUsd.toFixed(6)} (-${slPct}%)\n` +
      `<b>Size:</b> $${(result.entryPriceUsd ? thesis.positionSizeUsd : 0).toFixed(2)} ` +
      `(${thesis.positionSizePct.toFixed(1)}% of portfolio)\n` +
      `<b>R/R:</b> ${rrStr}:1\n\n` +
      `<b>Confidence:</b> ${confidenceBar} ${(thesis.confidenceScore * 100).toFixed(0)}%\n\n` +
      `<b>Thesis:</b>\n${thesis.reasoning}\n\n` +
      `<b>Signals:</b>\n` +
      `  📊 Price: ${thesis.signals.priceAction}\n` +
      `  📈 Volume: ${thesis.signals.volume}\n` +
      `  💬 Sentiment: ${thesis.signals.socialSentiment}\n` +
      `  ⛓️ On-chain: ${thesis.signals.onChainMetrics}` +
      solscanLink;

    return { type: 'trade_thesis', content, priority: 'normal' };
  }

  /**
   * Sends an approval request with Approve / Reject inline keyboard.
   */
  async sendApprovalRequest(payload: ApprovalPayload): Promise<void> {
    const content =
      `⚠️ <b>APPROVAL REQUIRED</b> — ${payload.token}\n\n` +
      `Direction: ${payload.direction.toUpperCase()}\n` +
      `Size: $${payload.positionSizeUsd.toFixed(2)} (above auto limit)\n` +
      `Entry: $${payload.entryPriceUsd.toFixed(6)}\n` +
      `TP: $${payload.takeProfitUsd.toFixed(6)}\n` +
      `SL: $${payload.stopLossUsd.toFixed(6)}\n\n` +
      `Reply with the thesis ID to approve: <code>${payload.thesisId}</code>`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `approve:${payload.thesisId}` },
          { text: '❌ Reject', callback_data: `reject:${payload.thesisId}` },
        ],
      ],
    };

    await this.send(content, keyboard);
  }

  /**
   * Formats and sends the daily P&L summary.
   */
  async sendDailySummary(stats: {
    date: string;
    startingBalance: number;
    endingBalance: number;
    realizedPnl: number;
    realizedPnlPct: number;
    tradesTaken: number;
    tradesWon: number;
    tradesLost: number;
    winRate: number;
    maxDrawdownPct: number;
  }): Promise<void> {
    const pnlEmoji = stats.realizedPnl >= 0 ? '💚' : '🔴';
    const content =
      `📊 <b>Daily Summary — ${stats.date}</b>\n\n` +
      `${pnlEmoji} P&L: ${stats.realizedPnl >= 0 ? '+' : ''}$${stats.realizedPnl.toFixed(2)} ` +
      `(${stats.realizedPnlPct >= 0 ? '+' : ''}${stats.realizedPnlPct.toFixed(2)}%)\n` +
      `💰 Balance: $${stats.startingBalance.toFixed(0)} → $${stats.endingBalance.toFixed(0)}\n\n` +
      `🎯 Trades: ${stats.tradesTaken} total\n` +
      `  ✅ Won: ${stats.tradesWon}\n` +
      `  🔴 Lost: ${stats.tradesLost}\n` +
      `  📈 Win Rate: ${(stats.winRate * 100).toFixed(0)}%\n` +
      `  📉 Max Drawdown: ${stats.maxDrawdownPct.toFixed(1)}%`;

    await this.send(content);
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private async send(
    text: string,
    replyMarkup?: object
  ): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;
    const body: Record<string, unknown> = {
      chat_id: this.chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };

    if (replyMarkup) {
      body.reply_markup = JSON.stringify(replyMarkup);
    }

    try {
      await axios.post(url, body, { timeout: 10_000 });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        logger.error(
          `Telegram send failed: ${err.response?.status} — ${JSON.stringify(err.response?.data)}`
        );
      } else {
        logger.error(`Telegram send failed: ${err}`);
      }
      // Don't throw — notification failures shouldn't halt the agent
    }
  }

  /**
   * Builds a visual confidence bar, e.g. ████░░░░ 75%
   */
  private buildConfidenceBar(score: number): string {
    const filled = Math.round(score * 10);
    const empty = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }
}
