/**
 * trigger.ts — Jupiter Trigger V2 client.
 *
 * Supports:
 *  - getVault() / registerVault()
 *  - craftDeposit() + signDeposit() (wallet signs)
 *  - createOrder() — single, OCO, OTOCO
 *  - getOrder() / getOrderHistory()
 *  - cancelOrder()
 *  - editOrder() (for trailing stop updates)
 *
 * Docs: https://dev.jup.ag/docs/trigger
 * Base URL: https://api.jup.ag/trigger/v2
 */

import axios, { AxiosError } from 'axios';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import type {
  AgentConfig,
  JupiterVault,
  TriggerDepositCraftRequest,
  TriggerDepositCraftResponse,
  TriggerOrderParams,
  TriggerOrderResult,
  TriggerOrder,
} from '../types';
import { JupiterAuthClient } from './auth';
import { createLogger } from '../utils/logger';

const logger = createLogger('jupiter/trigger');

export class JupiterTriggerClient {
  private readonly baseUrl: string;
  private readonly auth: JupiterAuthClient;
  private readonly keypair: Keypair;
  private readonly connection: Connection;

  constructor(config: AgentConfig) {
    this.baseUrl = config.jupiterTriggerBaseUrl;
    this.auth = new JupiterAuthClient(config);
    this.keypair = Keypair.fromSecretKey(bs58.decode(config.solanaPrivateKey));
    this.connection = new Connection(config.heliusRpcUrl, 'confirmed');
  }

  // ─── Vault ──────────────────────────────────────────────────────────────

  /**
   * Gets or creates the Trigger V2 vault for the trading wallet.
   * The vault holds token deposits that back OCO orders.
   */
  async getOrCreateVault(): Promise<JupiterVault> {
    const headers = await this.auth.getHeaders();
    const pubkey = this.keypair.publicKey.toBase58();

    try {
      const response = await axios.get<JupiterVault>(`${this.baseUrl}/v2/vault`, {
        params: { userPubkey: pubkey },
        headers,
      });
      logger.debug(`Vault found: ${response.data.vaultPubkey}`);
      return response.data;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        return this.registerVault();
      }
      throw this.wrapError('getVault', err);
    }
  }

  private async registerVault(): Promise<JupiterVault> {
    const headers = await this.auth.getHeaders();
    const pubkey = this.keypair.publicKey.toBase58();
    logger.info('Registering new Trigger V2 vault…');
    const response = await axios.post<JupiterVault>(
      `${this.baseUrl}/v2/vault/register`,
      { userPubkey: pubkey },
      { headers }
    );
    logger.info(`Vault registered: ${response.data.vaultPubkey}`);
    return response.data;
  }

  // ─── Order creation ──────────────────────────────────────────────────────

  /**
   * Full order creation flow:
   *  1. Get/create vault
   *  2. Craft deposit transaction
   *  3. Sign deposit tx
   *  4. POST to /v2/orders/price with signed tx + order params
   */
  async createOrder(params: TriggerOrderParams): Promise<TriggerOrderResult> {
    this.validateOrderParams(params);

    const vault = await this.getOrCreateVault();
    const headers = await this.auth.getHeaders();

    // ── Step 1: Craft deposit transaction ─────────────────────────────
    const depositReq: TriggerDepositCraftRequest = {
      userPubkey: this.keypair.publicKey.toBase58(),
      vaultPubkey: vault.vaultPubkey,
      depositAmount: params.inputAmount,
      inputMint: params.inputMint,
    };

    const depositResp = await axios.post<TriggerDepositCraftResponse>(
      `${this.baseUrl}/v2/deposit/craft`,
      depositReq,
      { headers }
    );

    // ── Step 2: Sign deposit transaction ──────────────────────────────
    const depositTxBytes = Buffer.from(depositResp.data.transaction, 'base64');
    const depositTx = VersionedTransaction.deserialize(depositTxBytes);
    depositTx.sign([this.keypair]);
    const signedDepositTx = Buffer.from(depositTx.serialize()).toString('base64');

    // ── Step 3: Create order ───────────────────────────────────────────
    const orderPayload = this.buildOrderPayload(params, signedDepositTx);

    const orderResp = await axios.post<TriggerOrderResult>(
      `${this.baseUrl}/v2/orders/price`,
      orderPayload,
      { headers }
    );

    logger.info(
      `Order created: id=${orderResp.data.id} type=${params.orderType} ` +
        `inputMint=${params.inputMint.slice(0, 8)} outputMint=${params.outputMint.slice(0, 8)}`
    );

    return orderResp.data;
  }

  // ─── Order queries ───────────────────────────────────────────────────────

  async getOrder(orderId: string): Promise<TriggerOrder> {
    const headers = await this.auth.getHeaders();
    const response = await axios.get<TriggerOrder>(
      `${this.baseUrl}/v2/orders/${orderId}`,
      { headers }
    );
    return response.data;
  }

  async getOrderHistory(status?: 'open' | 'filled' | 'cancelled' | 'expired'): Promise<TriggerOrder[]> {
    const headers = await this.auth.getHeaders();
    const pubkey = this.keypair.publicKey.toBase58();
    const response = await axios.get<{ orders: TriggerOrder[] }>(
      `${this.baseUrl}/v2/orders`,
      {
        params: { userPubkey: pubkey, status },
        headers,
      }
    );
    return response.data.orders;
  }

  // ─── Order management ────────────────────────────────────────────────────

  async cancelOrder(orderId: string): Promise<void> {
    const headers = await this.auth.getHeaders();
    await axios.delete(`${this.baseUrl}/v2/orders/${orderId}`, { headers });
    logger.info(`Order cancelled: ${orderId}`);
  }

  /**
   * Edit an existing order (e.g., update stop-loss for trailing stop).
   * TODO: Verify exact payload schema from Jupiter Trigger V2 docs for editOrder.
   */
  async editOrder(
    orderId: string,
    updates: { slPriceUsd?: number; tpPriceUsd?: number; expiresAt?: number }
  ): Promise<void> {
    const headers = await this.auth.getHeaders();
    // TODO: confirm if Jupiter uses PATCH or PUT, and exact endpoint path
    await axios.patch(
      `${this.baseUrl}/v2/orders/${orderId}`,
      updates,
      { headers }
    );
    logger.info(`Order ${orderId} updated: ${JSON.stringify(updates)}`);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private buildOrderPayload(
    params: TriggerOrderParams,
    signedDepositTx: string
  ): Record<string, unknown> {
    const base = {
      signedDepositTx,
      orderType: params.orderType,
      inputMint: params.inputMint,
      inputAmount: params.inputAmount,
      outputMint: params.outputMint,
      triggerMint: params.triggerMint,
      expiresAt: params.expiresAt,
    };

    if (params.orderType === 'single') {
      return {
        ...base,
        triggerCondition: params.triggerCondition,
        triggerPriceUsd: params.triggerPriceUsd,
        slippageBps: params.slippageBps,
      };
    }

    if (params.orderType === 'oco') {
      return {
        ...base,
        tpPriceUsd: params.tpPriceUsd,
        slPriceUsd: params.slPriceUsd,
        tpSlippageBps: params.tpSlippageBps,
        slSlippageBps: params.slSlippageBps,
      };
    }

    if (params.orderType === 'otoco') {
      return {
        ...base,
        triggerCondition: params.triggerCondition,
        triggerPriceUsd: params.triggerPriceUsd,
        tpPriceUsd: params.tpPriceUsd,
        slPriceUsd: params.slPriceUsd,
        tpSlippageBps: params.tpSlippageBps,
        slSlippageBps: params.slSlippageBps,
      };
    }

    return base;
  }

  private validateOrderParams(params: TriggerOrderParams): void {
    if (BigInt(params.inputAmount) < BigInt(10_000)) {
      // Minimum $10 USD — rough check, assumes USDC (6 decimals) = 10_000 units
      logger.warn('Order inputAmount may be below Jupiter $10 minimum');
    }

    if (params.orderType === 'oco' || params.orderType === 'otoco') {
      if (params.tpPriceUsd !== undefined && params.slPriceUsd !== undefined) {
        if (params.tpPriceUsd <= params.slPriceUsd) {
          throw new Error(
            `OCO validation: tpPriceUsd ($${params.tpPriceUsd}) must be > slPriceUsd ($${params.slPriceUsd})`
          );
        }
      }
    }

    if (params.expiresAt <= Date.now()) {
      throw new Error('expiresAt must be a future timestamp');
    }
  }

  private wrapError(context: string, err: unknown): Error {
    if (axios.isAxiosError(err)) {
      const axErr = err as AxiosError;
      const body = JSON.stringify(axErr.response?.data ?? {});
      return new Error(
        `JupiterTrigger.${context} failed: HTTP ${axErr.response?.status} — ${body}`
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
