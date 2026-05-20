import { loadChannelsKey, loadServiceKeypair } from '@/lib/relayer-env';

// Public-only sanity check. Returns the service G-address derived from
// USDC_MM_SERVICE_SECRET so the browser can verify config without seeing
// the secret.
export async function GET() {
  const channelsKey = loadChannelsKey();
  const svc = loadServiceKeypair();
  return Response.json({
    servicePublic: svc?.publicKey ?? null,
    channelsConfigured: !!channelsKey,
    serviceConfigured: !!svc,
  });
}
