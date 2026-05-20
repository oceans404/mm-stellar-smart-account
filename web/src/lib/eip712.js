// EIP-712 envelope for the Stellar Vault verifier at CDQ27AFQ…RDTPXM6.
// Schema is copied verbatim from sa-poc's probe-option-a-eip712.mjs — the
// verifier reconstructs the exact same hash on-chain via
// keccak256(0x1901 || domainSep || msgHash). Any drift here breaks the
// signature recovery.
//
// Cryptographic binding to the specific Soroban op happens via the
// stellarAuthDigest field — sha256( sha256(SorobanAuth preimage) ||
// ScVec([U32(rule_id)]).toXDR() ). The rest of the fields (operation,
// from, to, amount, nonce, validUntilLedger) exist for the MetaMask popup
// UX; they're displayed to the user as labeled rows but the actual auth
// gating is via stellarAuthDigest.

import { Address, hash, xdr } from '@stellar/stellar-sdk';
import { Signature, TypedDataEncoder, getBytes } from 'ethers';
import { NETWORK_PASSPHRASE } from './stellar.js';
import { signTypedDataV4 } from './metamask.js';
import { log } from '../log.js';

export const EIP712_DOMAIN = (verifyingContract) => ({
  name: 'Stellar Vault',
  version: '1',
  chainId: 0,
  verifyingContract,
});

export const EIP712_TYPES = {
  StellarVaultAuth: [
    { name: 'operation', type: 'string' },
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'validUntilLedger', type: 'uint256' },
    { name: 'stellarAuthDigest', type: 'bytes32' },
  ],
};

// Truncate any Stellar G/C address to its last 20 bytes — purely cosmetic
// (used only as the EIP-712 popup display field). Cryptographic binding
// is via stellarAuthDigest.
export function stellarAddrToEvm20(addrStr) {
  const buf = new Address(addrStr).toBuffer();
  return '0x' + buf.subarray(12).toString('hex');
}

function u256ToBytes32Be(v) {
  const buf = new Uint8Array(32);
  let n = BigInt(v);
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return buf;
}

// Build the External signer ScVal — the verifier C-address + pubkey bytes
// keyed in the AuthPayload's signers map.
export function externalSignerScVal(verifierAddr, pubkeyBytes) {
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    new Address(verifierAddr).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(pubkeyBytes)),
  ]);
}

// Compute the Soroban auth_digest the on-chain verifier reconstructs.
// = sha256( sha256(SorobanAuth preimage) || ScVec([U32(rule_id...)]).toXDR() )
export function computeAuthDigest({ nonce, signatureExpirationLedger, invocation, contextRuleIds }) {
  const networkId = hash(Buffer.from(NETWORK_PASSPHRASE));
  const sorobanPreimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId,
      nonce,
      signatureExpirationLedger,
      invocation,
    }),
  );
  const signaturePayload = hash(sorobanPreimage.toXDR());
  const ridsXdr = xdr.ScVal.scvVec(contextRuleIds.map(id => xdr.ScVal.scvU32(id))).toXDR();
  return hash(Buffer.concat([signaturePayload, ridsXdr]));
}

// Pack the sig_data envelope the on-chain verifier expects in the Bytes
// value of the AuthPayload's signers map. Same wire layout as the probe.
function packSigDataEip712({ verifyingContractHex, value, sig }) {
  const verifying20 = Buffer.from(verifyingContractHex.slice(2), 'hex');
  const opUtf8 = Buffer.from(value.operation, 'utf8');
  const opLen = Buffer.alloc(4);
  opLen.writeUInt32BE(opUtf8.length, 0);
  const from20 = Buffer.from(value.from.slice(2), 'hex');
  const to20 = Buffer.from(value.to.slice(2), 'hex');
  const amount32 = Buffer.from(u256ToBytes32Be(value.amount));
  const nonce32 = Buffer.from(u256ToBytes32Be(value.nonce));
  const vul32 = Buffer.from(u256ToBytes32Be(value.validUntilLedger));
  const r = Buffer.from(getBytes(sig.r));
  const s = Buffer.from(getBytes(sig.s));
  const v = Buffer.from([sig.yParity]);
  return Buffer.concat([
    verifying20, opLen, opUtf8,
    from20, to20,
    amount32, nonce32, vul32,
    r, s, v,
  ]);
}

// End-to-end: build the EIP-712 value, ask MM to sign via signTypedData_v4,
// pack the wire-format sig_data the verifier expects. Returns the Buffer to
// stick into the AuthPayload signers map as the bytes for this signer.
export async function signEip712Auth({
  ethAddress, vaultAddr, opMeta, nonce, validUntilLedger,
  invocation, contextRuleIds,
}) {
  const verifyingContract = stellarAddrToEvm20(vaultAddr);
  const domain = EIP712_DOMAIN(verifyingContract);
  const authDigest = computeAuthDigest({
    nonce, signatureExpirationLedger: validUntilLedger, invocation, contextRuleIds,
  });
  const value = {
    operation: opMeta.operation,
    from: opMeta.from,
    to: opMeta.to,
    amount: opMeta.amount,
    nonce: BigInt(nonce.toString()),
    validUntilLedger: BigInt(validUntilLedger),
    stellarAuthDigest: '0x' + Buffer.from(authDigest).toString('hex'),
  };

  // Pre-compute digest for debug logging. ethers' TypedDataEncoder
  // auto-derives EIP712Domain from the domain object and rejects types
  // that include EIP712Domain explicitly, so we keep that out here.
  const digestHex = TypedDataEncoder.hash(domain, EIP712_TYPES, value);
  log('mm', `EIP-712 digest (ethers local): ${digestHex}`);

  // MetaMask's eth_signTypedData_v4 over JSON-RPC requires EIP712Domain
  // to be present in types — its field order determines the domain hash.
  // Match ethers' default order exactly so MM's signing digest equals
  // the local digestHex above (and the verifier's reconstruction).
  const typesForMM = {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    ...EIP712_TYPES,
  };
  const sigHex = await signTypedDataV4(ethAddress, {
    types: typesForMM,
    primaryType: 'StellarVaultAuth',
    domain,
    message: value,
  });
  const sig = Signature.from(sigHex);
  log('mm', `sig.yParity=${sig.yParity}`);

  return packSigDataEip712({ verifyingContractHex: verifyingContract, value, sig });
}
