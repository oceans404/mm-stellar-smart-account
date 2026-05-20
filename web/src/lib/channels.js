import { log } from '../log.js';

// usdc-mm path: the browser has no Stellar key, so it sends the inner XDR
// (auth entries attached, envelope unsigned) to the relayer. Relayer signs
// envelope as service_g, forwards to Channels, returns Channels' hash.
export async function signAndSubmit(innerXdr) {
  log('relayer', `POST /api/sign-and-submit (relayer signs envelope as service_g)`);
  let res;
  try {
    res = await fetch('/api/sign-and-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xdr: innerXdr }),
    });
  } catch (e) {
    throw new Error(`relayer-fetch: ${e.message}`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`relayer-http ${res.status}: ${text.slice(0, 400)}`);
  let body;
  try { body = JSON.parse(text); }
  catch { throw new Error(`relayer-parse: non-JSON: ${text.slice(0, 200)}`); }
  if (body.error) throw new Error(`relayer-rpc: ${JSON.stringify(body.error)}`);
  const hash = body?.data?.hash ?? body?.result?.data?.hash ?? body?.hash;
  if (!hash) throw new Error(`relayer-shape: no hash in ${text.slice(0, 200)}`);
  log('relayer', `Channels accepted — tx=${hash}`);
  log('relayer', `stellar.expert: https://stellar.expert/explorer/testnet/tx/${hash}`);
  return hash;
}

// One-shot config check — calls /api/service-info, returns the service G's
// public address (so the browser can verify .env is loaded without seeing
// the secret).
export async function fetchServiceInfo() {
  const res = await fetch('/api/service-info');
  if (!res.ok) throw new Error(`service-info http ${res.status}`);
  return res.json();
}

// Inner XDR is fully signed (auth entries attached, envelope source signed).
// Channels wraps it in a fee-bump and submits. Returns the on-chain tx hash.
// Kept for parity with usdc-poc; usdc-mm doesn't use it directly.
export async function submitViaChannels(signedXdr) {
  log('relayer', `POST /api/channels (inner fee=0)`);
  let res;
  try {
    res = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { xdr: signedXdr } }),
    });
  } catch (e) {
    throw new Error(`channels-fetch: ${e.message}`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`channels-http ${res.status}: ${text.slice(0, 400)}`);
  let body;
  try { body = JSON.parse(text); }
  catch { throw new Error(`channels-parse: non-JSON: ${text.slice(0, 200)}`); }
  if (body.error) throw new Error(`channels-rpc: ${JSON.stringify(body.error)}`);
  const hash = body?.data?.hash ?? body?.result?.data?.hash ?? body?.hash;
  if (!hash) throw new Error(`channels-shape: no hash in ${text.slice(0, 200)}`);
  log('relayer', `Channels accepted — tx=${hash}`);
  log('relayer', `stellar.expert: https://stellar.expert/explorer/testnet/tx/${hash}`);
  return hash;
}
