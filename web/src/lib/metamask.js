import { SigningKey, hashMessage, getBytes, computeAddress } from 'ethers';
import { log } from '../log.js';

// Thin EIP-1193 wrapper around window.ethereum. Works for MetaMask, Coinbase
// Wallet, Rainbow desktop, anything that injects window.ethereum. WalletConnect
// would slot in here as a 2nd option later (different provider, same shape).

export function isMetaMaskInstalled() {
  return typeof window !== 'undefined' && !!window.ethereum;
}

export async function ensureConnected() {
  if (!isMetaMaskInstalled()) {
    throw new Error('No EIP-1193 wallet detected. Install MetaMask (or Coinbase Wallet / Rainbow) and refresh.');
  }
  log('mm', 'eth_requestAccounts');
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if (!accounts || accounts.length === 0) throw new Error('No accounts returned from wallet.');
  log('mm', `connected: ${accounts[0]}`);
  return accounts[0];
}

export async function getChainId() {
  if (!isMetaMaskInstalled()) return null;
  const chainId = await window.ethereum.request({ method: 'eth_chainId' });
  log('mm', `chainId: ${chainId}`);
  return chainId;
}

// Re-fire on MetaMask address swap so the UI stays in sync.
export function onAccountsChanged(handler) {
  if (!isMetaMaskInstalled()) return;
  window.ethereum.on?.('accountsChanged', handler);
}

// Used in MM4 for the per-Send admin authorization. typedData is the full
// EIP-712 envelope per the schema in probe-option-a-eip712.mjs.
//
// JSON.stringify chokes on BigInts by default. uint256 fields (amount,
// nonce, validUntilLedger) come in as BigInt from sendFlow; convert to
// decimal strings on the wire — MetaMask normalizes them back to integers
// internally. Doesn't affect the on-chain hash (the same bytes are hashed
// either way).
export async function signTypedDataV4(address, typedData) {
  log('mm', `eth_signTypedData_v4 from ${address}`);
  const json = JSON.stringify(typedData, (_k, v) =>
    typeof v === 'bigint' ? v.toString() : v,
  );
  const sig = await window.ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [address, json],
  });
  log('mm', `signature length=${sig.length}`);
  return sig;
}

// ---- bind-pubkey (MM2 prereq) ----
//
// MetaMask only exposes the 20-byte 0x… address. The eth-vault constructor
// stores the FULL secp256k1 pubkey (65 bytes uncompressed). To get it, we
// ask the user to personal_sign a one-time bind message, then ecrecover the
// pubkey from the signature in the browser. Cache in localStorage so we
// only ask once per identity.

const PUBKEY_CACHE_PREFIX = 'usdc-mm:pubkey:';
const ACCOUNT_CACHE_PREFIX = 'usdc-mm:account:';

export function getCachedPubkey(ethAddress) {
  if (!ethAddress) return null;
  const hex = localStorage.getItem(PUBKEY_CACHE_PREFIX + ethAddress.toLowerCase());
  return hex ? getBytes(hex) : null;
}

export async function bindPubkey(ethAddress) {
  const cached = getCachedPubkey(ethAddress);
  if (cached) {
    log('mm', `pubkey cached for ${ethAddress.slice(0,6)}…${ethAddress.slice(-4)} (${cached.length}b)`);
    return cached;
  }
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
  const sig = await window.ethereum.request({
    method: 'personal_sign',
    params: [message, ethAddress],
  });
  // personal_sign auto-applies the EIP-191 prefix; hashMessage mirrors it.
  const digest = hashMessage(message);
  const pubkeyHex = SigningKey.recoverPublicKey(digest, sig);
  // Sanity check: derived address must match the one MM gave us.
  const derivedAddr = computeAddress(pubkeyHex);
  if (derivedAddr.toLowerCase() !== ethAddress.toLowerCase()) {
    throw new Error(`address mismatch — recovered ${derivedAddr} from ${ethAddress}`);
  }
  localStorage.setItem(PUBKEY_CACHE_PREFIX + ethAddress.toLowerCase(), pubkeyHex);
  const bytes = getBytes(pubkeyHex);
  log('mm', `pubkey recovered + cached (${bytes.length}b: ${pubkeyHex.slice(0, 20)}…)`);
  return bytes;
}

export function getCachedAccount(ethAddress) {
  if (!ethAddress) return null;
  return localStorage.getItem(ACCOUNT_CACHE_PREFIX + ethAddress.toLowerCase());
}
export function setCachedAccount(ethAddress, c) {
  localStorage.setItem(ACCOUNT_CACHE_PREFIX + ethAddress.toLowerCase(), c);
}
export function clearCachedAccount(ethAddress) {
  localStorage.removeItem(ACCOUNT_CACHE_PREFIX + ethAddress.toLowerCase());
}
