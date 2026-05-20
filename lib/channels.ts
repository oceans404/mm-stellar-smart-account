import { log } from './log';

// Client-side helpers that talk to the Next.js API routes. The actual
// secrets (USDC_MM_SERVICE_SECRET, CHANNELS_API_KEY) live server-side.

export interface ServiceInfo {
  servicePublic: string | null;
  channelsConfigured: boolean;
  serviceConfigured: boolean;
}

export async function fetchServiceInfo(): Promise<ServiceInfo> {
  const res = await fetch('/api/service-info');
  if (!res.ok) throw new Error(`service-info http ${res.status}`);
  return res.json();
}

// Browser sends inner XDR (auth entries attached, envelope unsigned).
// Relayer signs envelope as service_g, forwards to Channels.
export async function signAndSubmit(innerXdr: string): Promise<string> {
  log('relayer', 'POST /api/sign-and-submit (relayer signs envelope as service_g)');
  let res: Response;
  try {
    res = await fetch('/api/sign-and-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xdr: innerXdr }),
    });
  } catch (e) {
    throw new Error(`relayer-fetch: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`relayer-http ${res.status}: ${text.slice(0, 400)}`);
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`relayer-parse: non-JSON: ${text.slice(0, 200)}`);
  }
  if (body.error) throw new Error(`relayer-rpc: ${JSON.stringify(body.error)}`);
  const hash = body?.data?.hash ?? body?.result?.data?.hash ?? body?.hash;
  if (!hash) throw new Error(`relayer-shape: no hash in ${text.slice(0, 200)}`);
  log('relayer', `Channels accepted — tx=${hash}`);
  log('relayer', `stellar.expert: https://stellar.expert/explorer/testnet/tx/${hash}`);
  return hash;
}
