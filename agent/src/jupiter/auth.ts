/**
 * auth.ts — Jupiter Trigger V2 challenge-response JWT authentication.
 *
 * Flow:
 *  1. GET /auth/challenge?walletPubkey=<pubkey>
 *  2. Sign challenge with wallet private key (nacl)
 *  3. POST /auth/verify { walletPubkey, signature, challenge }
 *  4. Cache JWT; refresh when expired (check exp claim)
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
  expiresIn: number;
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

  // ─── Private ─────────────────────────────────────────────────────────

  private async refreshToken(): Promise<string> {
    const challenge = await this.fetchChallenge();
    const signature = this.signChallenge(challenge);
    const verified = await this.verify(challenge, signature);

    this.cachedToken = {
      token: verified.token,
      expiresAt: verified.expiresAt,
    };

    logger.info(`Jupiter JWT obtained, expires at ${new Date(verified.expiresAt * 1000).toISOString()}`);
    return verified.token;
  }

  private async fetchChallenge(): Promise<string> {
    const pubkey = this.keypair.publicKey.toBase58();
    const response = await axios.get<ChallengeResponse>(
      `${this.baseUrl}/auth/challenge`,
      {
        params: { walletPubkey: pubkey },
        headers: { 'x-api-key': this.apiKey },
      }
    );
    return response.data.challenge;
  }

  private signChallenge(challenge: string): string {
    const messageBytes = Buffer.from(challenge);
    const signature = nacl.sign.detached(messageBytes, this.keypair.secretKey);
    return bs58.encode(signature);
  }

  private async verify(challenge: string, signature: string): Promise<VerifyResponse> {
    const pubkey = this.keypair.publicKey.toBase58();
    const response = await axios.post<VerifyResponse>(
      `${this.baseUrl}/auth/verify`,
      { walletPubkey: pubkey, signature, challenge },
      { headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' } }
    );
    return response.data;
  }

  private isTokenValid(cached: CachedToken): boolean {
    // Refresh 60 seconds before expiry to avoid race conditions
    const nowSec = Math.floor(Date.now() / 1000);
    return cached.expiresAt - nowSec > 60;
  }
}
