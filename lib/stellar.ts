import { Networks, TransactionBuilder, rpc, xdr } from '@stellar/stellar-sdk';
import { log } from './log';

export const RPC_URL = 'https://soroban-testnet.stellar.org';
export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const server = new rpc.Server(RPC_URL);

export async function getAccount(gAddress: string) {
  return server.getAccount(gAddress);
}

export async function pollForTx(hashStr: string) {
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: { hash: hashStr },
      }),
    });
    const body = await r.json();
    const res = body.result;
    if (!res) continue;
    if (res.status === 'SUCCESS' || res.status === 'FAILED') {
      return {
        successful: res.status === 'SUCCESS',
        resultMetaXdr: res.resultMetaXdr,
        resultXdr: res.resultXdr,
        envelopeXdr: res.envelopeXdr,
      };
    }
  }
  return null;
}

export async function simulateAndAssemble(tx: any, label: string) {
  log('stellar', `simulating ${label}`);
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    log('err', `sim error: ${sim.error.split('\n')[0]}`);
    throw new Error(`simulate ${label}: ${sim.error}`);
  }
  const resourceFee = sim.minResourceFee;
  log(
    'stellar',
    `sim ok — minResourceFee=${resourceFee} stroops (~${(
      Number(resourceFee) / 1e7
    ).toFixed(4)} XLM)`,
  );
  const assembled = rpc.assembleTransaction(tx, sim).build();
  return { assembled, sim };
}

export function extractDeployedContractAddress(resultMetaXdr: string) {
  const meta = xdr.TransactionMeta.fromXDR(resultMetaXdr, 'base64');
  // stellar-sdk's union typing here covers v1/v2/v3/v4 + an OperationMeta[]
  // variant that doesn't have sorobanMeta. For Soroban contract-creation txs
  // we always get v3+/v4 with sorobanMeta present. Cast pragmatically.
  const inner = meta.value() as { sorobanMeta?: () => any };
  const sorobanMeta = inner.sorobanMeta?.();
  if (!sorobanMeta) throw new Error('no sorobanMeta on tx');
  return sorobanMeta.returnValue();
}
