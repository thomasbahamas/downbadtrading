/**
 * types.ts — Complete shared type definitions for the Solana Trading Agent.
 *
 * All types used across agent loop, Jupiter clients, risk engine, wallet,
 * notifications, and database are defined here to ensure consistency.
 */

// ============================================================
// Trade Thesis — LLM output
// ============================================================

export interface TradeThesis {
  /** UUID v4 */
  id: string;
  /** Unix timestamp ms */
  timestamp: number;
  token: {
    symbol: string;
    /** Solana token mint address */
    mint: string;
    name: string;
  };
  direction: 'buy' | 'sell';
  /** Current price at time of thesis generation */
  entryPriceUsd: number;
  /** Take-profit trigger price in USD */
  takeProfitUsd: number;
  /** Stop-loss trigger price in USD */
  stopLossUsd: number;
  /** Absolute USD size of the position */
  positionSizeUsd: number;
  /** Position as % of total portfolio value */
  positionSizePct: number;
  /** 0.0 – 1.0, LLM-generated confidence */
  confidenceScore: number;
  /** LLM-generated reasoning (1-3 sentences) */
  reasoning: string;
  signals: {
    priceAction: string;
    volume: string;
    socialSentiment: string;
    onChainMetrics: string;
  };
  /** (takeProfitUsd - entryPriceUsd) / (entryPriceUsd - stopLossUsd) */
  riskRewardRatio: number;
}

// ============================================================
// Agent State — flows through LangGraph nodes
// ============================================================

export type AgentNodeName =
  | 'observe'
  | 'analyze'
  | 'decide'
  | 'execute'
  | 'report'
  | 'monitor';

export interface AgentState {
  /** Snapshot collected in OBSERVE node */
  marketSnapshot: MarketSnapshot | null;
  /** Current portfolio from on-chain + Supabase */
  portfolio: Portfolio;
  /** All currently open positions */
  activePositions: Position[];
  /** Trade thesis from ANALYZE node (null = no-trade) */
  thesis: TradeThesis | null;
  /** Risk engine decision from DECIDE node */
  riskApproval: RiskApproval | null;
  /** Result from EXECUTE node */
  executionResult: ExecutionResult | null;
  /** How many full loops have completed */
  loopCount: number;
  /** Timestamp of last OBSERVE run */
  lastObserveTime: number;
  /** Any error that should abort this loop iteration */
  error: string | null;
}

// ============================================================
// Market Data
// ============================================================

export interface MarketSnapshot {
  /** Unix timestamp ms of data collection */
  timestamp: number;
  /** Array of token data for universe under consideration */
  tokens: TokenData[];
  globalMetrics: GlobalMetrics;
  /** Mints of tokens trending by volume on Birdeye */
  trendingTokens: string[];
  /** Recent on-chain events from Helius */
  recentEvents: MarketEvent[];
  /** Newly detected CEX listings since last scan */
  newListings: CEXListing[];
}

export interface CEXListing {
  exchange: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  detectedAt: number;
}

export interface GlobalMetrics {
  solPriceUsd: number;
  solVolume24h: number;
  totalDexVolume24h: number;
  /** 0–100 */
  fearGreedIndex: number;
  btcDominancePct: number;
  totalMarketCapUsd: number;
}

export interface TokenData {
  mint: string;
  symbol: string;
  name: string;
  priceUsd: number;
  /** Percent change, e.g. 5.2 = +5.2% */
  priceChange1h: number;
  priceChange24h: number;
  volume24h: number;
  volumeChange24h: number;
  marketCap: number;
  /** On-chain liquidity in USD (Birdeye) */
  liquidity: number;
  holderCount: number;
  /** Unix timestamp ms of token creation */
  createdAt: number;
  /** Pyth oracle data (if available) */
  pythPrice?: PythPriceData;
  /** Birdeye trade data */
  tradeCount24h?: number;
  buyVolume24h?: number;
  sellVolume24h?: number;
}

export interface PythPriceData {
  /** Current price */
  price: number;
  /** 95% confidence interval half-width */
  confidence: number;
  /** Unix timestamp of last publish */
  publishTime: number;
  /** EMA price */
  emaPrice?: number;
}

export interface MarketEvent {
  type: 'new_token' | 'volume_spike' | 'whale_trade' | 'price_alert' | 'large_transfer';
  /** Token mint address */
  token: string;
  tokenSymbol?: string;
  details: string;
  /** USD value (for whale trades / transfers) */
  valueUsd?: number;
  /** Transaction signature */
  txSignature?: string;
  timestamp: number;
}

// ============================================================
// Portfolio & Holdings
// ============================================================

export interface Portfolio {
  walletAddress: string;
  solBalance: number;
  usdcBalance: number;
  /** Sum of all holdings + liquid balances */
  totalValueUsd: number;
  holdings: Holding[];
  /** P&L since start of UTC day */
  dailyPnl: number;
  dailyPnlPct: number;
  /** Lifetime P&L */
  totalPnl: number;
  /** Peak total value ever seen (for drawdown calculation) */
  peakValueUsd: number;
}

export interface Holding {
  mint: string;
  symbol: string;
  /** Raw token amount (human-readable, not lamports) */
  amount: number;
  valueUsd: number;
  avgEntryPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
}

// ============================================================
// Positions
// ============================================================

export type PositionStatus =
  | 'open'
  | 'tp_hit'
  | 'sl_hit'
  | 'expired'
  | 'manual_close'
  | 'pending_approval';

export interface Position {
  /** UUID v4 */
  id: string;
  /** References TradeThesis.id */
  thesisId: string;
  token: { symbol: string; mint: string; name: string };
  direction: 'long' | 'short';
  entryPriceUsd: number;
  entrySizeUsd: number;
  /** Entry token amount (human-readable) */
  entryTokenAmount: number;
  entryTxSignature: string;
  takeProfitUsd: number;
  stopLossUsd: number;
  /** Jupiter Trigger V2 OCO order ID */
  jupiterOrderId: string;
  status: PositionStatus;
  /** Unix timestamp ms */
  openedAt: number;
  closedAt?: number;
  exitPriceUsd?: number;
  exitTxSignature?: string;
  /** USD profit/loss */
  realizedPnl?: number;
  realizedPnlPct?: number;
  /** Whether profits were forwarded to profit wallet */
  profitRouted?: boolean;
  profitRouteTxSignature?: string;
  /** Unix timestamp ms of last trailing-stop update */
  lastTrailingStopUpdate?: number;
  /** LLM reasoning for the trade */
  reasoning?: string;
  /** Signal breakdown from LLM analysis */
  signals?: { priceAction: string; volume: string; socialSentiment: string; onChainMetrics: string };
  /** LLM confidence score (0-1) */
  confidenceScore?: number;
}

// ============================================================
// Risk
// ============================================================

export interface RiskApproval {
  approved: boolean;
  /** Human-readable reason for rejection or approval with caveats */
  reason: string;
  /** Risk engine may reduce the requested position size */
  adjustedPositionSizeUsd?: number;
  warnings: string[];
  /** If false and approved, send Telegram approval request first */
  autoExecute: boolean;
}

export interface RiskConfig {
  /** Max USD value per trade for auto-execution */
  maxPerTradeUsd: number;
  /** Max % of portfolio in open positions at once */
  maxPortfolioExposurePct: number;
  /** Max % of portfolio in any single token */
  maxSingleTokenPct: number;
  /** Max simultaneous open positions */
  maxConcurrentPositions: number;
  /** Min LLM confidence score (0.0–1.0) to proceed */
  minConfidenceScore: number;
  /** Min USD liquidity on the token to consider */
  minLiquidityUsd: number;
  /** Min token age in hours before we trade it */
  minTokenAgeHours: number;
  /** Default take-profit % above entry */
  defaultTpPct: number;
  /** Default stop-loss % below entry */
  defaultSlPct: number;
  /** Daily loss % that triggers circuit breaker */
  maxDailyLossPct: number;
  /** Consecutive losses that trigger circuit breaker */
  maxConsecutiveLosses: number;
  /** Drawdown from peak % that triggers circuit breaker */
  maxDrawdownPct: number;
  /** OCO order expiry in days */
  orderExpiryDays: number;
  /** Token mints never to trade */
  blacklistedMints: string[];
  /** If non-empty, ONLY trade these mints */
  whitelistedMints: string[];
}

export interface RiskCheckResult {
  passed: boolean;
  checkName: string;
  reason?: string;
  adjustedValue?: number;
}

// ============================================================
// Circuit Breaker
// ============================================================

export interface CircuitBreakerState {
  /** Realized loss % for today */
  dailyLossPct: number;
  /** Count of losses in a row */
  consecutiveLosses: number;
  /** Current drawdown from peak portfolio value */
  drawdownFromPeakPct: number;
  isTradingHalted: boolean;
  haltReason?: string;
  /** Unix timestamp ms */
  haltedAt?: number;
  /** Unix timestamp ms — null means manual resume required */
  resumeAt?: number;
}

export interface CircuitBreakerEvent {
  type: 'halt' | 'resume';
  reason: string;
  dailyLossPct: number;
  consecutiveLosses: number;
  drawdownFromPeakPct: number;
  timestamp: number;
}

// ============================================================
// Execution
// ============================================================

export interface ExecutionResult {
  success: boolean;
  /** Jupiter swap transaction signature */
  swapTxSignature?: string;
  /** Jupiter Trigger V2 OCO order ID */
  jupiterOrderId?: string;
  /** Actual fill price from swap */
  entryPriceUsd?: number;
  /** Output token amount (string to preserve precision) */
  amountOut?: string;
  /** Fee paid in SOL */
  feeSol?: number;
  error?: string;
  errorCode?: string;
}

// ============================================================
// Jupiter Ultra API
// ============================================================

export interface UltraQuoteRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  /** Basis points, e.g. 50 = 0.5% */
  slippageBps?: number;
  taker?: string;
}

export interface UltraQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
  }>;
  contextSlot: number;
  timeTaken: number;
  requestId: string;
}

export interface UltraSwapRequest {
  quoteResponse: UltraQuoteResponse;
  userPublicKey: string;
}

export interface UltraSwapResponse {
  swapTransaction: string; // base64 serialized VersionedTransaction
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
  computeUnitLimit: number;
  requestId: string;
}

export interface UltraOrderResult {
  signature: string;
  slot: number;
}

// ============================================================
// Jupiter Trigger V2 API
// ============================================================

export interface JupiterVault {
  userPubkey: string;
  vaultPubkey: string;
  privyVaultId: string;
}

export interface TriggerDepositCraftRequest {
  userPubkey: string;
  vaultPubkey: string;
  /** Amount in lamports / smallest unit */
  depositAmount: string;
  inputMint: string;
}

export interface TriggerDepositCraftResponse {
  transaction: string; // base64 serialized
  blockhash: string;
  lastValidBlockHeight: number;
}

export type TriggerOrderType = 'single' | 'oco' | 'otoco';

export interface TriggerSingleOrderParams {
  orderType: 'single';
  inputMint: string;
  inputAmount: string;
  outputMint: string;
  triggerMint: string;
  triggerCondition: 'above' | 'below';
  triggerPriceUsd: number;
  slippageBps?: number;
  expiresAt: number;
}

export interface TriggerOCOOrderParams {
  orderType: 'oco';
  inputMint: string;
  inputAmount: string;
  outputMint: string;
  triggerMint: string;
  tpPriceUsd: number;
  slPriceUsd: number;
  /** undefined = RTSE auto slippage */
  tpSlippageBps?: number;
  /** Default 2000 (20%) for execution certainty */
  slSlippageBps: number;
  expiresAt: number;
}

export interface TriggerOTOCOOrderParams {
  orderType: 'otoco';
  inputMint: string;
  inputAmount: string;
  outputMint: string;
  triggerMint: string;
  /** Parent trigger price — entry condition */
  triggerPriceUsd: number;
  triggerCondition: 'above' | 'below';
  /** Child OCO TP price on output tokens */
  tpPriceUsd: number;
  /** Child OCO SL price on output tokens */
  slPriceUsd: number;
  tpSlippageBps?: number;
  slSlippageBps: number;
  expiresAt: number;
}

export type TriggerOrderParams =
  | TriggerSingleOrderParams
  | TriggerOCOOrderParams
  | TriggerOTOCOOrderParams;

export interface TriggerOrderResult {
  id: string;
  txSignature: string;
}

export interface TriggerOrder {
  id: string;
  orderType: TriggerOrderType;
  status: 'open' | 'filled' | 'cancelled' | 'expired';
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount?: string;
  tpPriceUsd?: number;
  slPriceUsd?: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  fillTxSignature?: string;
}

// ============================================================
// Notifications
// ============================================================

export type TelegramMessageType =
  | 'trade_thesis'
  | 'position_update'
  | 'circuit_breaker'
  | 'daily_summary'
  | 'approval_request'
  | 'error'
  | 'profit_routed';

export interface TelegramMessage {
  type: TelegramMessageType;
  content: string;
  priority: 'low' | 'normal' | 'high';
  /** For approval_request messages — callback data */
  approvalPayload?: ApprovalPayload;
}

export interface ApprovalPayload {
  thesisId: string;
  token: string;
  direction: 'buy' | 'sell';
  positionSizeUsd: number;
  entryPriceUsd: number;
  takeProfitUsd: number;
  stopLossUsd: number;
}

// ============================================================
// Database (Supabase row types)
// ============================================================

export interface TradeLog {
  id: string;
  thesis_id: string;
  token_symbol: string;
  token_mint: string;
  token_name: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  exit_price: number | null;
  take_profit: number;
  stop_loss: number;
  position_size_usd: number;
  entry_token_amount: number;
  confidence_score: number;
  reasoning: string;
  signals: Record<string, string>;
  status: PositionStatus;
  jupiter_order_id: string | null;
  entry_tx: string;
  exit_tx: string | null;
  realized_pnl: number | null;
  realized_pnl_pct: number | null;
  profit_routed: boolean;
  profit_route_tx: string | null;
  opened_at: string; // ISO 8601
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ThesisLog {
  id: string;
  token_symbol: string;
  token_mint: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  take_profit: number;
  stop_loss: number;
  position_size_usd: number;
  confidence_score: number;
  reasoning: string;
  signals: Record<string, string>;
  risk_reward_ratio: number;
  /** 'executed', 'rejected_risk', 'rejected_manual', 'no_trade' */
  disposition: string;
  rejection_reason: string | null;
  created_at: string;
}

export interface CircuitBreakerEventLog {
  id: string;
  type: 'halt' | 'resume';
  reason: string;
  daily_loss_pct: number;
  consecutive_losses: number;
  drawdown_from_peak_pct: number;
  created_at: string;
}

export interface DailyPerformanceLog {
  id: string;
  date: string; // YYYY-MM-DD
  starting_balance_usd: number;
  ending_balance_usd: number;
  realized_pnl: number;
  realized_pnl_pct: number;
  trades_taken: number;
  trades_won: number;
  trades_lost: number;
  win_rate: number;
  avg_winner_pct: number;
  avg_loser_pct: number;
  max_drawdown_pct: number;
  created_at: string;
}

// ============================================================
// Agent Config (runtime, after zod parse)
// ============================================================

export interface AgentConfig {
  solanaPrivateKey: string;
  profitWalletAddress: string;
  heliusApiKey: string;
  heliusRpcUrl: string;
  heliusWsUrl: string;
  jupiterApiKey: string;
  jupiterUltraBaseUrl: string;
  jupiterTriggerBaseUrl: string;
  llmProvider: 'anthropic' | 'openai';
  anthropicApiKey: string;
  anthropicModel: string;
  openaiApiKey: string;
  openaiModel: string;
  birdeyeApiKey: string;
  birdeyeBaseUrl: string;
  coingeckoApiKey: string;
  coingeckoBaseUrl: string;
  telegramBotToken: string;
  telegramChatId: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  maxAutoTradeUsd: number;
  loopIntervalSeconds: number;
  risk: RiskConfig;
  paperTrade: boolean;
  logLevel: string;
  port: number;
}
