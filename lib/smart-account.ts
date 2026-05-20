import {
  Address,
  Asset,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE, getAccount, server } from './stellar';
import { log } from './log';

export const USDC_TESTNET_ISSUER =
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const USDC_SAC = new Asset('USDC', USDC_TESTNET_ISSUER).contractId(
  NETWORK_PASSPHRASE,
);

// Inner-tx fee MUST be '0' for Channels — TransactionBuilder computes
// final fee = baseFee * numOps + resourceFee. baseFee=0 → final = resourceFee
// exactly, which is Channels' invariant (Gotcha 5).
//
// Soroban txs cannot carry memos at the protocol level (CAP-64 is the
// in-flight fix). Don't .addMemo here.
export async function buildInvokeTx({
  sourceG,
  contract,
  fn,
  args,
  auth,
}: {
  sourceG: string;
  contract: string;
  fn: string;
  args: xdr.ScVal[];
  auth?: xdr.SorobanAuthorizationEntry[];
}) {
  const acct = await getAccount(sourceG);
  return new TransactionBuilder(acct, {
    fee: '0',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract,
        function: fn,
        args,
        ...(auth ? { auth } : {}),
      }),
    )
    .setTimeout(60)
    .build();
}

export async function getCurrentLedger() {
  const ledger = await server.getLatestLedger();
  return ledger.sequence;
}

export const USDC_DECIMALS = 7;
export function usdcToStroops(amount: number | string) {
  return BigInt(Math.round(Number(amount) * 10 ** USDC_DECIMALS));
}
export function stroopsToUsdc(stroops: bigint) {
  return Number(stroops) / 10 ** USDC_DECIMALS;
}

export function usdcTransferArgs({
  from,
  to,
  amountStroops,
}: {
  from: string;
  to: string;
  amountStroops: bigint;
}) {
  return [
    new Address(from).toScVal(),
    new Address(to).toScVal(),
    nativeToScVal(amountStroops, { type: 'i128' }),
  ];
}

export async function readUsdcBalance(addressStrkey: string, anySourceG: string) {
  const acct = await getAccount(anySourceG);
  const tx = new TransactionBuilder(acct, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: USDC_SAC,
        function: 'balance',
        args: [new Address(addressStrkey).toScVal()],
      }),
    )
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if ('error' in sim && sim.error)
    throw new Error(`balance(${addressStrkey.slice(0, 6)}…): ${(sim.error as string).split('\n')[0]}`);
  if (!('result' in sim) || !sim.result) throw new Error('balance: no sim result');
  const native = scValToNative(sim.result.retval);
  log(
    'stellar',
    `balance(${addressStrkey.slice(0, 8)}…) = ${native}`,
  );
  return native as bigint;
}
