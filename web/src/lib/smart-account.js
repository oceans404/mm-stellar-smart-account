import {
  Address, Asset, Operation, TransactionBuilder, nativeToScVal, scValToNative, xdr,
} from '@stellar/stellar-sdk';
import {
  NETWORK_PASSPHRASE, getAccount, server, simulateAndAssemble,
} from './stellar.js';
import { log } from '../log.js';

// Testnet USDC — Circle's testnet issuer. SAC address derives from
// (assetCode, issuer, networkPassphrase) deterministically.
export const USDC_TESTNET_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const USDC_SAC = new Asset('USDC', USDC_TESTNET_ISSUER).contractId(NETWORK_PASSPHRASE);

// OZ spending_limit policy contract, deployed testnet 2026-05-12 (see HANDOFF).
export const SPENDING_LIMIT_POLICY = 'CDFI2L3WMXZ6EOTZVQ2GDNALJIIQ326HOPFMCBUSUJ7GM2V6BE77JNV5';

// freighter-vault wasm uploaded 2026-05-12. __constructor(admin: Address)
// bootstraps Signer::Delegated(admin) as the Default admin rule (id 0).
export const FREIGHTER_VAULT_WASM_HASH =
  'ba5a88e95d52bdfb548909a8ce056f1ec46942ab31009d6900380b9ddb5f44aa';

export function delegatedSignerScVal(gAddress) {
  // enum Signer { External(Address, Bytes), Delegated(Address) } →
  // ScVal::Vec([Symbol(variant), ...args])
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('Delegated'),
    new Address(gAddress).toScVal(),
  ]);
}

export async function buildDeployVaultTx(sourceGAddress, adminGAddress) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const acct = await getAccount(sourceGAddress);
  log('stellar', `building createCustomContract; admin=Delegated(${adminGAddress})`);
  return new TransactionBuilder(acct, { fee: '100000000', networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.createCustomContract({
      address: new Address(sourceGAddress),
      wasmHash: Buffer.from(FREIGHTER_VAULT_WASM_HASH, 'hex'),
      salt: Buffer.from(salt),
      constructorArgs: [new Address(adminGAddress).toScVal()],
    }))
    .setTimeout(60)
    .build();
}

export function callContractTypeScVal(targetC) {
  // enum ContextRuleType { Default, CallContract(Address), ... }
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('CallContract'),
    new Address(targetC).toScVal(),
  ]);
}

// Soroban Option<T>::Some(v) is just v.into_val() — NOT wrapped in a Vec.
// See Gotcha 1 in HANDOFF. None is ScVal::Void.
export function someU32ScVal(value) {
  return xdr.ScVal.scvU32(value);
}

// SpendingLimitAccountParams { period_ledgers: u32, spending_limit: i128 }.
// Map keys must be in alphabetical order — period_ledgers before spending_limit.
export function spendingLimitParamsScVal(limitStroops, periodLedgers) {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('period_ledgers'),
      val: xdr.ScVal.scvU32(periodLedgers),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('spending_limit'),
      val: nativeToScVal(limitStroops, { type: 'i128' }),
    }),
  ]);
}

// Build the args array once; the caller reuses it across sim + re-sim.
// If spendingLimit is passed, attach a spending_limit policy entry on the rule.
export function addContextRuleArgs({
  spenderG, scopeC, validUntilLedger, name,
  spendingLimitStroops = null, periodLedgers = null,
}) {
  const policiesMap = (spendingLimitStroops != null && periodLedgers != null)
    ? xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: new Address(SPENDING_LIMIT_POLICY).toScVal(),
          val: spendingLimitParamsScVal(spendingLimitStroops, periodLedgers),
        }),
      ])
    : xdr.ScVal.scvMap([]);
  return [
    callContractTypeScVal(scopeC),
    nativeToScVal(name, { type: 'string' }),
    someU32ScVal(validUntilLedger),
    xdr.ScVal.scvVec([delegatedSignerScVal(spenderG)]),
    policiesMap,
  ];
}

// Inner-tx fee MUST be '0' for Channels — TransactionBuilder computes
// final fee = baseFee * numOps + resourceFee. baseFee=0 → final = resourceFee
// exactly, which is Channels' invariant (Gotcha 5).
//
// Note: Soroban txs (InvokeHostFunctionOp) cannot carry memos at the protocol
// level (CAP-64 in flight to fix). Don't add .addMemo here.
export async function buildInvokeTx({ sourceG, contract, fn, args, auth }) {
  const acct = await getAccount(sourceG);
  return new TransactionBuilder(acct, { fee: '0', networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({
      contract,
      function: fn,
      args,
      ...(auth ? { auth } : {}),
    }))
    .setTimeout(60)
    .build();
}

export async function getCurrentLedger() {
  const ledger = await server.getLatestLedger();
  return ledger.sequence;
}

// USDC has 7 decimals (Stellar asset convention). 5.00 → 50_000_000n stroops.
export const USDC_DECIMALS = 7;
export function usdcToStroops(amount) {
  return BigInt(Math.round(Number(amount) * 10 ** USDC_DECIMALS));
}
export function stroopsToUsdc(stroops) {
  return Number(stroops) / 10 ** USDC_DECIMALS;
}

export function usdcTransferArgs({ from, to, amountStroops }) {
  return [
    new Address(from).toScVal(),
    new Address(to).toScVal(),
    nativeToScVal(amountStroops, { type: 'i128' }),
  ];
}

// Reads the SAC balance of a G or C address. Returns BigInt stroops.
export async function readUsdcBalance(addressStrkey, anySourceG) {
  const acct = await getAccount(anySourceG);
  const tx = new TransactionBuilder(acct, { fee: '100', networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({
      contract: USDC_SAC,
      function: 'balance',
      args: [new Address(addressStrkey).toScVal()],
    }))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (sim.error) throw new Error(`balance(${addressStrkey.slice(0,6)}…): ${sim.error.split('\n')[0]}`);
  const native = scValToNative(sim.result.retval);
  log('stellar', `balance(${addressStrkey.slice(0,8)}…) raw retval: ${JSON.stringify(native, (_k, v) => typeof v === 'bigint' ? v.toString() + 'n' : v)} ; USDC_SAC=${USDC_SAC}`);
  return native;
}

export async function readDefaultAdminRule(vaultAddr, anySourceGAddress) {
  const acct = await getAccount(anySourceGAddress);
  const tx = new TransactionBuilder(acct, { fee: '100', networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({
      contract: vaultAddr,
      function: 'get_context_rule',
      args: [xdr.ScVal.scvU32(0)],
    }))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (sim.error) throw new Error(`get_context_rule(0): ${sim.error}`);
  return scValToNative(sim.result.retval);
}
