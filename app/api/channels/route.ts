import { CHANNELS_URL, loadChannelsKey } from '@/lib/relayer-env';

// Pass-through to OpenZeppelin Channels. Used only if a future caller has
// its own signing path. usdc-mm itself routes through /api/sign-and-submit.
export async function POST(req: Request) {
  const key = loadChannelsKey();
  if (!key) {
    return Response.json({ error: 'CHANNELS_API_KEY missing' }, { status: 500 });
  }
  const body = await req.text();
  try {
    const upstream = await fetch(CHANNELS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body,
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      },
    });
  } catch (e) {
    return Response.json({ error: `proxy fetch failed: ${(e as Error).message}` }, { status: 502 });
  }
}
