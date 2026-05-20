import {
  Networks, TransactionBuilder, rpc, xdr,
} from '@stellar/stellar-sdk';
import { log } from '../log.js';

export const RPC_URL = 'https://soroban-testnet.stellar.org';
export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const server = new rpc.Server(RPC_URL);

export async function getAccount(gAddress) {
  return server.getAccount(gAddress);
}

export async function pollForTx(hashStr) {
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const r = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getTransaction', params: { hash: hashStr },
      }),
    });
    const body = await r.json();
    const res = body.result;
    if (!res) continue;
    if (res.status === 'SUCCESS') {
      return {
        successful: true,
        resultMetaXdr: res.resultMetaXdr,
        resultXdr: res.resultXdr,
        envelopeXdr: res.envelopeXdr,
      };
    }
    if (res.status === 'FAILED') {
      return {
        successful: false,
        resultMetaXdr: res.resultMetaXdr,
        resultXdr: res.resultXdr,
        envelopeXdr: res.envelopeXdr,
      };
    }
  }
  return null;
}

export async function simulateAndAssemble(tx, label) {
  log('stellar', `simulating ${label}`);
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    log('err', `sim error: ${sim.error.split('\n')[0]}`);
    throw new Error(`simulate ${label}: ${sim.error}`);
  }
  const resourceFee = sim.minResourceFee;
  log('stellar', `sim ok — minResourceFee=${resourceFee} stroops (~${(Number(resourceFee) / 1e7).toFixed(4)} XLM)`);
  const assembled = rpc.assembleTransaction(tx, sim).build();
  return { assembled, sim };
}

export async function submit(signedXdr) {
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  log('stellar', 'submitting via Soroban RPC');
  const send = await server.sendTransaction(tx);
  if (send.status === 'ERROR') {
    throw new Error(`send: ${JSON.stringify(send.errorResult)}`);
  }
  log('stellar', `submitted — hash=${send.hash}`);
  const r = await pollForTx(send.hash);
  if (!r?.successful) {
    throw new Error(`tx did not succeed; hash=${send.hash}`);
  }
  log('ok', `tx confirmed`);
  log('stellar', `stellar.expert: https://stellar.expert/explorer/testnet/tx/${send.hash}`);
  return { hash: send.hash, result: r };
}

export function extractDeployedContractAddress(resultMetaXdr) {
  const meta = xdr.TransactionMeta.fromXDR(resultMetaXdr, 'base64');
  const sorobanMeta = meta.value().sorobanMeta();
  if (!sorobanMeta) throw new Error('no sorobanMeta on tx');
  return sorobanMeta.returnValue();
}
