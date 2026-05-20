import { Address, Operation, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE, getAccount } from './stellar.js';
import { log } from '../log.js';

// Shared service Stellar G — public only. Source-account for every usdc-mm
// envelope; pays the create resource fee. Has no authority over any Vault
// (Vault admin lives on the user's Eth key via External signer).
export const SHARED_SOURCE_G = 'GD4WUFS577NPSEHQUIE42OQGPAHA3MYT4B6R6HGDYXAYFA6DGOFJGTFE';

// EIP-712 secp256k1 verifier — deployed by sa-poc probes, reused as-is.
// __check_auth path: verifier.recover_eip712(message, sig) → pubkey;
// Vault then compares to the registered pubkey stored at deploy.
export const VERIFIER = 'CDQ27AFQYQZR2TV6VAY2STM5IC2ZLBNL7OGCQF3TLTVXAIQQIRDTPXM6';

// eth-vault wasm — uploaded by sa-poc Option A probes. __constructor takes
// (verifier: Address, sponsor_pubkey: Bytes) and writes the admin context
// rule as Signer::External(verifier, pubkey).
export const ETH_VAULT_WASM_HASH =
  '66d11325950d4767b1824098dd9e701cd505eba2f93130bf5b51f476328c76a3';

// Builds the createCustomContract op for an eth-keyed Vault.
// Source must be SHARED_SOURCE_G — the relayer will reject any other source.
// fee = '0' is the Channels invariant (Gotcha #5): final fee = baseFee * numOps
// + resourceFee, so baseFee=0 → final == resourceFee, which is what Channels
// requires. assembleTransaction sets resourceFee from simulation.
export async function buildEthVaultDeployTx(sourceG, verifierAddr, pubkeyBytes) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const acct = await getAccount(sourceG);
  log('stellar', `building eth-vault createCustomContract; admin=External(${verifierAddr.slice(0,8)}…, ${pubkeyBytes.length}b pubkey)`);
  return new TransactionBuilder(acct, { fee: '0', networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.createCustomContract({
      address: new Address(sourceG),
      wasmHash: Buffer.from(ETH_VAULT_WASM_HASH, 'hex'),
      salt: Buffer.from(salt),
      constructorArgs: [
        new Address(verifierAddr).toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(pubkeyBytes)),
      ],
    }))
    .setTimeout(60)
    .build();
}
