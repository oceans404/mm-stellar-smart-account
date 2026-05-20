// Server-side env loader. Used only by API routes — never imported into the
// page bundle.

import { Keypair } from '@stellar/stellar-sdk';

export const CHANNELS_URL = 'https://channels.openzeppelin.com/testnet';

export function loadChannelsKey(): string | null {
  return process.env.CHANNELS_API_KEY?.trim() ?? null;
}

export function loadServiceSecret(): string | null {
  return process.env.USDC_MM_SERVICE_SECRET?.trim() ?? null;
}

export function loadServiceKeypair(): { kp: Keypair; publicKey: string } | null {
  const secret = loadServiceSecret();
  if (!secret) return null;
  try {
    const kp = Keypair.fromSecret(secret);
    return { kp, publicKey: kp.publicKey() };
  } catch {
    return null;
  }
}
