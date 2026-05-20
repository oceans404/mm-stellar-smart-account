import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Shared .env at sa-poc/relayer/.env holds both the Channels API key
// (used by all three POCs) and the usdc-mm service Stellar secret
// (used only here for envelope signing).
function loadEnvVar(name) {
  const envPath = path.resolve(__dirname, '../../sa-poc/relayer/.env');
  if (!fs.existsSync(envPath)) return null;
  const text = fs.readFileSync(envPath, 'utf8');
  return text.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim() ?? null;
}

const CHANNELS_URL = 'https://channels.openzeppelin.com/testnet';

// /api/channels — straight Channels proxy (used by Receive/Send if the browser
// has its own signing path; kept for parity with usdc-poc).
function channelsProxy() {
  return {
    name: 'channels-proxy',
    configureServer(server) {
      const key = loadEnvVar('CHANNELS_API_KEY');
      if (!key) {
        server.config.logger.warn('[channels-proxy] CHANNELS_API_KEY not found in ../../sa-poc/relayer/.env — /api/channels will 500');
      }
      server.middlewares.use('/api/channels', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (!key) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'CHANNELS_API_KEY missing' }));
          return;
        }
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          const upstream = await fetch(CHANNELS_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
            body,
          });
          const text = await upstream.text();
          res.statusCode = upstream.status;
          res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
          res.end(text);
        } catch (e) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `proxy fetch failed: ${e.message}` }));
        }
      });
    },
  };
}

// /api/service-info — public-only sanity check. Returns the service G-address
// derived from the secret in .env, so the browser can verify configuration
// without ever seeing the secret.
//
// /api/sign-and-submit — the load-bearing endpoint for usdc-mm. Browser POSTs
// an inner-tx XDR (Soroban auth entries attached, envelope unsigned). Plugin
// loads USDC_MM_SERVICE_SECRET, signs the envelope as service_g, forwards the
// signed XDR to Channels, returns Channels' response.
function signAndSubmit() {
  return {
    name: 'sign-and-submit',
    configureServer(server) {
      const channelsKey = loadEnvVar('CHANNELS_API_KEY');
      const serviceSecret = loadEnvVar('USDC_MM_SERVICE_SECRET');
      let servicePublic = null;
      if (serviceSecret) {
        try {
          servicePublic = Keypair.fromSecret(serviceSecret).publicKey();
        } catch (e) {
          server.config.logger.warn(`[sign-and-submit] USDC_MM_SERVICE_SECRET malformed: ${e.message}`);
        }
      } else {
        server.config.logger.warn('[sign-and-submit] USDC_MM_SERVICE_SECRET not found in ../../sa-poc/relayer/.env — /api/sign-and-submit will 500');
      }

      server.middlewares.use('/api/service-info', (req, res, next) => {
        if (req.method !== 'GET') return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          servicePublic,
          channelsConfigured: !!channelsKey,
          serviceConfigured: !!servicePublic,
        }));
      });

      server.middlewares.use('/api/sign-and-submit', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (!channelsKey || !servicePublic) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            error: 'relayer not configured',
            channelsConfigured: !!channelsKey,
            serviceConfigured: !!servicePublic,
          }));
          return;
        }
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const text = Buffer.concat(chunks).toString('utf8');
        let body;
        try { body = JSON.parse(text); }
        catch { res.statusCode = 400; res.end(JSON.stringify({ error: 'invalid JSON' })); return; }
        const innerXdr = body.xdr;
        if (typeof innerXdr !== 'string' || innerXdr.length < 10) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'missing or invalid xdr field' }));
          return;
        }
        try {
          const kp = Keypair.fromSecret(serviceSecret);
          const tx = TransactionBuilder.fromXDR(innerXdr, Networks.TESTNET);
          // Sanity check: the inner tx's source must be the service G,
          // otherwise the signature we're about to attach won't match.
          if (tx.source !== servicePublic) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              error: `tx source mismatch: tx.source=${tx.source}, service=${servicePublic}`,
            }));
            return;
          }
          tx.sign(kp);
          const signedXdr = tx.toXDR();
          server.config.logger.info(`[sign-and-submit] signed by ${servicePublic}, forwarding to Channels`);
          const upstream = await fetch(CHANNELS_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${channelsKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ params: { xdr: signedXdr } }),
          });
          const upstreamText = await upstream.text();
          res.statusCode = upstream.status;
          res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
          res.end(upstreamText);
        } catch (e) {
          server.config.logger.error(`[sign-and-submit] ${e.message}`);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    },
  };
}

export default defineConfig({
  server: { port: 5175 },
  plugins: [channelsProxy(), signAndSubmit()],
  define: { global: 'globalThis' },
  resolve: { alias: { buffer: 'buffer/' } },
  optimizeDeps: { include: ['buffer'] },
});
