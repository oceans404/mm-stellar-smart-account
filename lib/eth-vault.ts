import { Address, Operation, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE, getAccount } from './stellar';
import { log } from './log';

// Shared service Stellar G — public only. The browser uses this as the source
// of every Soroban tx; the secret lives in env (USDC_MM_SERVICE_SECRET) on
// the server side only, used by /api/sign-and-submit to sign envelopes.
export const SHARED_SOURCE_G =
  'GD4WUFS577NPSEHQUIE42OQGPAHA3MYT4B6R6HGDYXAYFA6DGOFJGTFE';

// EIP-712 secp256k1 verifier — deployed by sa-poc probes, reused as-is.
export const VERIFIER =
  'CDQ27AFQYQZR2TV6VAY2STM5IC2ZLBNL7OGCQF3TLTVXAIQQIRDTPXM6';

// eth-vault wasm — uploaded by sa-poc Option A probes.
export const ETH_VAULT_WASM_HASH =
  '66d11325950d4767b1824098dd9e701cd505eba2f93130bf5b51f476328c76a3';

export async function buildEthVaultDeployTx(
  sourceG: string,
  verifierAddr: string,
  pubkeyBytes: Uint8Array,
) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const acct = await getAccount(sourceG);
  log(
    'stellar',
    `building eth-vault createCustomContract; admin=External(${verifierAddr.slice(0, 8)}…, ${pubkeyBytes.length}b pubkey)`,
  );
  return new TransactionBuilder(acct, {
    fee: '0',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.createCustomContract({
        address: new Address(sourceG),
        wasmHash: Buffer.from(ETH_VAULT_WASM_HASH, 'hex'),
        salt: Buffer.from(salt),
        constructorArgs: [
          new Address(verifierAddr).toScVal(),
          xdr.ScVal.scvBytes(Buffer.from(pubkeyBytes)),
        ],
      }),
    )
    .setTimeout(60)
    .build();
}
