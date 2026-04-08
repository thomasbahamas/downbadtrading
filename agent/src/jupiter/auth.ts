/**
 * auth.ts — Jupiter Trigger V2 challenge-response JWT authentication.
 *
 * Flow:
 *  1. POST /auth/challenge { walletPubkey, type: "message" }
 *  2. Sign challenge message with wallet private key (nacl)
 *  3. POST /auth/verify { type: "message", walletPubkey, signature }
 *  4. Cache JWT; refresh when expired
 */

import axios from 'axios';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import type { AgentConfig } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('jupiter/auth');

interface ChallengeResponse {
  challenge: string;
}

interface VerifyResponse {
  token: string;
  expiresAt: number; // Unix timestamp seconds
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class JupiterAuthClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly keypair: Keypair;
  private cachedToken: CachedToken | null = null;

  constructor(config: AgentConfig) {
    this.baseUrl = config.jupiterTriggerBaseUrl;
    this.apiKey = config.jupiterApiKey;
    this.keypair = Keypair.fromSecretKey(bs58.decode(config.solanaPrivateKey));
  }

  /**
   * Returns a valid JWT, refreshing if expired or missing.
   */
  async getToken(): Promise<string> {
    if (this.cachedToken && this.isTokenValid(this.cachedToken)) {
      return this.cachedToken.token;
    }
    logger.info('Obtaining new Jupiter auth token…');
    return this.refreshToken();
  }

  /**
   * Returns standard headers for all Trigger V2 requests.
   */
  async getHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return {
      'x-api-key': this.apiKey,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  getPublicKey(): string {
    return this.keypair.publicKey.toBase58();
  }

  getKeypair(): Keypair {
    return this.keypair;
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private async refreshToken(): Promise<string> {
    const challenge = await this.fetchChallenge();
    const signature = this.signChallenge(challenge);
    const verified = await this.verify(signature);

    this.cachedToken = {
      token: verified.token,
      expiresAt: verified.expiresAt,
    };

    logger.info(`Jupiter JWT obtained, expires at ${new Date(verified.expiresAt * 1000).toISOString()}`);
    return verified.token;
  }

  private async fetchChallenge(): Promise<string> {
    const pubkey = this.keypair.publicKey.toBase58();
    const response = await axios.post<ChallengeResponse>(
      `${this.baseUrl}/auth/challenge`,
      { walletPubkey: pubkey, type: 'message' },
      { headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' } }
    );
    return response.data.challenge;
  }

  private signChallenge(challenge: string): string {
    const messageBytes = Buffer.from(challenge);
    const signature = nacl.sign.detached(messageBytes, this.keypair.secretKey);
    return bs58.encode(signature);
  }

  private async verify(signature: string): Promise<VerifyResponse> {
    const pubkey = this.keypair.publicKey.toBase58();
    const response = await axios.post<VerifyResponse>(
      `${this.baseUrl}/auth/verify`,
      { type: 'message', walletPubkey: pubkey, signature },
      { headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' } }
    );
    return response.data;
  }

  private isTokenValid(cached: CachedToken): boolean {
    const nowSec = Math.floor(Date.now() / 1000);
    return cached.expiresAt - nowSec > 60;
  }
}
