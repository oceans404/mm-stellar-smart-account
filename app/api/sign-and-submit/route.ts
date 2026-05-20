import { Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  CHANNELS_URL,
  loadChannelsKey,
  loadServiceKeypair,
} from '@/lib/relayer-env';

// Browser POSTs an inner-tx XDR (Soroban auth entries attached, envelope
// unsigned). We sign the envelope as the shared service Stellar account,
// forward to Channels, return Channels' response.
export async function POST(req: Request) {
  const channelsKey = loadChannelsKey();
  const svc = loadServiceKeypair();
  if (!channelsKey || !svc) {
    return Response.json(
      {
        error: 'relayer not configured',
        channelsConfigured: !!channelsKey,
        serviceConfigured: !!svc,
      },
      { status: 500 },
    );
  }
  let body: { xdr?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const innerXdr = body.xdr;
  if (typeof innerXdr !== 'string' || innerXdr.length < 10) {
    return Response.json({ error: 'missing or invalid xdr field' }, { status: 400 });
  }
  try {
    const tx = TransactionBuilder.fromXDR(innerXdr, Networks.TESTNET) as any;
    if (tx.source !== svc.publicKey) {
      return Response.json(
        { error: `tx source mismatch: tx.source=${tx.source}, service=${svc.publicKey}` },
        { status: 400 },
      );
    }
    tx.sign(svc.kp);
    const signedXdr = tx.toXDR();
    const upstream = await fetch(CHANNELS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${channelsKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ params: { xdr: signedXdr } }),
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        'Content-Type':
          upstream.headers.get('content-type') ?? 'application/json',
      },
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
