/**
 * trading.ts — Trading wallet operations.
 *
 * Wraps @solana/web3.js for:
 *  - Getting SOL and token balances
 *  - Signing and sending transactions
 *  - Confirming transaction finality
 */

import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  Transaction,
  LAMPORTS_PER_SOL,
  GetProgramAccountsFilter,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import bs58 from 'bs58';
import type { AgentConfig, Portfolio, Holding } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('wallet/trading');

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

export class TradingWallet {
  private readonly keypair: Keypair;
  private readonly connection: Connection;
  private readonly profitWalletAddress: string;

  constructor(config: AgentConfig) {
    this.keypair = Keypair.fromSecretKey(bs58.decode(config.solanaPrivateKey));
    this.connection = new Connection(config.heliusRpcUrl, 'confirmed');
    this.profitWalletAddress = config.profitWalletAddress;
  }

  getPublicKey(): string {
    return this.keypair.publicKey.toBase58();
  }

  /**
   * Returns the raw token balance (smallest units) for a given mint.
   * Used by monitor.ts to sell the exact amount held.
   */
  async getTokenBalanceRaw(mint: string): Promise<string> {
    const mintPubkey = new PublicKey(mint);
    const ata = await getAssociatedTokenAddress(mintPubkey, this.keypair.publicKey);
    const balance = await this.connection.getTokenAccountBalance(ata);
    return balance.value.amount;
  }

  /**
   * Signs a VersionedTransaction in-place with the wallet keypair.
   */
  signVersionedTransaction(tx: VersionedTransaction): void {
    tx.sign([this.keypair]);
  }

  /**
   * Returns the current portfolio snapshot from on-chain data.
   * Holdings with unknown prices use $0 as placeholder.
   */
  async getPortfolio(): Promise<Portfolio> {
    const walletPubkey = this.keypair.publicKey;

    const [solBalance, tokenAccounts] = await Promise.all([
      this.connection.getBalance(walletPubkey),
      this.connection.getParsedTokenAccountsByOwner(walletPubkey, {
        programId: TOKEN_PROGRAM_ID,
      }),
    ]);

    const solBalanceDecimal = solBalance / LAMPORTS_PER_SOL;

    let usdcBalance = 0;
    const holdings: Holding[] = [];

    for (const { account } of tokenAccounts.value) {
      const info = account.data.parsed?.info;
      if (!info) continue;

      const mint: string = info.mint;
      const amount: number = info.tokenAmount?.uiAmount ?? 0;
      const decimals: number = info.tokenAmount?.decimals ?? 0;

      if (amount === 0) continue;

      if (mint === USDC_MINT || mint === USDT_MINT) {
        usdcBalance += amount;
        continue;
      }

      // Non-stable token holding
      holdings.push({
        mint,
        symbol: mint.slice(0, 6), // placeholder — enrich from Birdeye in observe.ts
        amount,
        valueUsd: 0, // enriched in observe.ts
        avgEntryPrice: 0, // enriched from Supabase trade logs
        unrealizedPnl: 0,
        unrealizedPnlPct: 0,
      });
    }

    return {
      walletAddress: walletPubkey.toBase58(),
      solBalance: solBalanceDecimal,
      usdcBalance,
      totalValueUsd: usdcBalance, // enriched once prices are known
      holdings,
      dailyPnl: 0,
      dailyPnlPct: 0,
      totalPnl: 0,
      peakValueUsd: 0,
    };
  }

  /**
   * Signs and sends a VersionedTransaction (base64-encoded).
   * Waits for confirmation before returning.
   */
  async signAndSendTransaction(
    serializedTx: string,
    lastValidBlockHeight: number
  ): Promise<{ signature: string; slot: number }> {
    const txBytes = Buffer.from(serializedTx, 'base64');
    const tx = VersionedTransaction.deserialize(txBytes);

    // Sign
    tx.sign([this.keypair]);

    // Send
    const signature = await this.connection.sendTransaction(tx, {
      maxRetries: 3,
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    logger.info(`Transaction sent: ${signature}`);

    // Confirm
    const { value } = await this.connection.confirmTransaction(
      {
        signature,
        blockhash: tx.message.recentBlockhash,
        lastValidBlockHeight,
      },
      'confirmed'
    );

    if (value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(value.err)}`);
    }

    // Get slot
    const txInfo = await this.connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    const slot = txInfo?.slot ?? 0;
    logger.info(`Transaction confirmed: ${signature} in slot ${slot}`);

    return { signature, slot };
  }

  /**
   * Transfers SOL to another address.
   */
  async transferSOL(
    toAddress: string,
    amountSol: number
  ): Promise<string> {
    const { SystemProgram, Transaction: LegacyTx } = await import('@solana/web3.js');
    const toPubkey = new PublicKey(toAddress);
    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

    const tx = new LegacyTx().add(
      SystemProgram.transfer({
        fromPubkey: this.keypair.publicKey,
        toPubkey,
        lamports,
      })
    );

    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.keypair.publicKey;
    tx.sign(this.keypair);

    const signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
    });

    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );

    return signature;
  }

  /**
   * Transfers an SPL token to another address.
   * Creates the destination ATA if it doesn't exist.
   */
  async transferSPL(
    mint: string,
    toAddress: string,
    amount: number,
    decimals: number
  ): Promise<string> {
    const {
      createTransferCheckedInstruction,
      getOrCreateAssociatedTokenAccount,
    } = await import('@solana/spl-token');

    const mintPubkey = new PublicKey(mint);
    const toPubkey = new PublicKey(toAddress);

    // Resolve sender ATA
    const senderAta = await getAssociatedTokenAddress(mintPubkey, this.keypair.publicKey);

    // Get or create destination ATA
    const destAta = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.keypair,
      mintPubkey,
      toPubkey
    );

    const rawAmount = BigInt(Math.floor(amount * 10 ** decimals));

    const tx = new Transaction().add(
      createTransferCheckedInstruction(
        senderAta,
        mintPubkey,
        destAta.address,
        this.keypair.publicKey,
        rawAmount,
        decimals
      )
    );

    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.keypair.publicKey;
    tx.sign(this.keypair);

    const signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
    });

    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );

    logger.info(`SPL transfer ${mint} → ${toAddress}: ${signature}`);
    return signature;
  }
}
