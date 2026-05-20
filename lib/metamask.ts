import { SigningKey, hashMessage, getBytes, computeAddress } from 'ethers';
import { log } from './log';

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
};

function eth(): EthereumProvider | null {
  if (typeof window === 'undefined') return null;
  return (window as { ethereum?: EthereumProvider }).ethereum ?? null;
}

export function isMetaMaskInstalled() {
  return !!eth();
}

export async function ensureConnected(): Promise<string> {
  const provider = eth();
  if (!provider) {
    throw new Error(
      'No EIP-1193 wallet detected. Install MetaMask (or Coinbase Wallet / Rainbow) and refresh.',
    );
  }
  log('mm', 'eth_requestAccounts');
  const accounts = (await provider.request({
    method: 'eth_requestAccounts',
  })) as string[];
  if (!accounts || accounts.length === 0)
    throw new Error('No accounts returned from wallet.');
  log('mm', `connected: ${accounts[0]}`);
  return accounts[0];
}

export async function getChainId(): Promise<string | null> {
  const provider = eth();
  if (!provider) return null;
  const chainId = (await provider.request({ method: 'eth_chainId' })) as string;
  log('mm', `chainId: ${chainId}`);
  return chainId;
}

export function onAccountsChanged(handler: (accounts: string[]) => void) {
  const provider = eth();
  provider?.on?.('accountsChanged', handler);
}

export async function signTypedDataV4(
  address: string,
  typedData: unknown,
): Promise<string> {
  const provider = eth();
  if (!provider) throw new Error('no wallet provider');
  log('mm', `eth_signTypedData_v4 from ${address}`);
  // JSON.stringify chokes on BigInts; convert uint256 fields to decimal strings.
  const json = JSON.stringify(typedData, (_k, v) =>
    typeof v === 'bigint' ? v.toString() : v,
  );
  const sig = (await provider.request({
    method: 'eth_signTypedData_v4',
    params: [address, json],
  })) as string;
  log('mm', `signature length=${sig.length}`);
  return sig;
}

// ---- bind-pubkey ----
const PUBKEY_CACHE_PREFIX = 'usdc-mm:pubkey:';
const ACCOUNT_CACHE_PREFIX = 'usdc-mm:account:';

export function getCachedPubkey(ethAddress: string | null): Uint8Array | null {
  if (!ethAddress || typeof localStorage === 'undefined') return null;
  const hex = localStorage.getItem(PUBKEY_CACHE_PREFIX + ethAddress.toLowerCase());
  return hex ? getBytes(hex) : null;
}

export async function bindPubkey(ethAddress: string): Promise<Uint8Array> {
  const cached = getCachedPubkey(ethAddress);
  if (cached) {
    log(
      'mm',
      `pubkey cached for ${ethAddress.slice(0, 6)}…${ethAddress.slice(-4)} (${cached.length}b)`,
    );
    return cached;
  }
  const provider = eth();
  if (!provider) throw new Error('no wallet provider');
  const nonce = Math.random().toString(36).slice(2, 10);
  const message = [
    'Bind your Ethereum key to usdc-mm.',
    '',
    `Address: ${ethAddress}`,
    `Nonce: ${nonce}`,
    '',
    'This signature proves ownership of your public key, which becomes the admin of your Stellar smart account.',
  ].join('\n');
  log('mm', 'requesting bind signature (personal_sign)…');
  const sig = (await provider.request({
    method: 'personal_sign',
    params: [message, ethAddress],
  })) as string;
  const digest = hashMessage(message);
  const pubkeyHex = SigningKey.recoverPublicKey(digest, sig);
  const derivedAddr = computeAddress(pubkeyHex);
  if (derivedAddr.toLowerCase() !== ethAddress.toLowerCase()) {
    throw new Error(`address mismatch — recovered ${derivedAddr} from ${ethAddress}`);
  }
  localStorage.setItem(PUBKEY_CACHE_PREFIX + ethAddress.toLowerCase(), pubkeyHex);
  const bytes = getBytes(pubkeyHex);
  log('mm', `pubkey recovered + cached (${bytes.length}b: ${pubkeyHex.slice(0, 20)}…)`);
  return bytes;
}

export function getCachedAccount(ethAddress: string | null): string | null {
  if (!ethAddress || typeof localStorage === 'undefined') return null;
  return localStorage.getItem(ACCOUNT_CACHE_PREFIX + ethAddress.toLowerCase());
}
export function setCachedAccount(ethAddress: string, c: string) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(ACCOUNT_CACHE_PREFIX + ethAddress.toLowerCase(), c);
}
