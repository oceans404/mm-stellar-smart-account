import { Address, hash, xdr } from '@stellar/stellar-sdk';
import { Signature, TypedDataEncoder, getBytes } from 'ethers';
import { NETWORK_PASSPHRASE } from './stellar';
import { signTypedDataV4 } from './metamask';
import { log } from './log';

export const EIP712_DOMAIN = (verifyingContract: string) => ({
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

export function stellarAddrToEvm20(addrStr: string) {
  const buf = new Address(addrStr).toBuffer();
  return '0x' + buf.subarray(12).toString('hex');
}

function u256ToBytes32Be(v: bigint | number | string) {
  const buf = new Uint8Array(32);
  let n = BigInt(v);
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return buf;
}

export function externalSignerScVal(verifierAddr: string, pubkeyBytes: Uint8Array) {
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    new Address(verifierAddr).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(pubkeyBytes)),
  ]);
}

export function computeAuthDigest({
  nonce,
  signatureExpirationLedger,
  invocation,
  contextRuleIds,
}: {
  nonce: xdr.Int64;
  signatureExpirationLedger: number;
  invocation: xdr.SorobanAuthorizedInvocation;
  contextRuleIds: number[];
}) {
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
  const ridsXdr = xdr.ScVal.scvVec(
    contextRuleIds.map((id) => xdr.ScVal.scvU32(id)),
  ).toXDR();
  return hash(Buffer.concat([signaturePayload, ridsXdr]));
}

function packSigDataEip712({
  verifyingContractHex,
  value,
  sig,
}: {
  verifyingContractHex: string;
  value: {
    operation: string;
    from: string;
    to: string;
    amount: bigint;
    nonce: bigint;
    validUntilLedger: bigint;
  };
  sig: Signature;
}) {
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
    verifying20,
    opLen,
    opUtf8,
    from20,
    to20,
    amount32,
    nonce32,
    vul32,
    r,
    s,
    v,
  ]);
}

export async function signEip712Auth({
  ethAddress,
  vaultAddr,
  opMeta,
  nonce,
  validUntilLedger,
  invocation,
  contextRuleIds,
}: {
  ethAddress: string;
  vaultAddr: string;
  opMeta: { operation: string; from: string; to: string; amount: bigint };
  nonce: xdr.Int64;
  validUntilLedger: number;
  invocation: xdr.SorobanAuthorizedInvocation;
  contextRuleIds: number[];
}) {
  const verifyingContract = stellarAddrToEvm20(vaultAddr);
  const domain = EIP712_DOMAIN(verifyingContract);
  const authDigest = computeAuthDigest({
    nonce,
    signatureExpirationLedger: validUntilLedger,
    invocation,
    contextRuleIds,
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

  const digestHex = TypedDataEncoder.hash(domain, EIP712_TYPES, value);
  log('mm', `EIP-712 digest (ethers local): ${digestHex}`);

  // MetaMask's eth_signTypedData_v4 over JSON-RPC requires EIP712Domain
  // present in types — its field order determines the domain hash. Match
  // ethers' default order so MM signs what the verifier reconstructs.
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

  return packSigDataEip712({
    verifyingContractHex: verifyingContract,
    value,
    sig,
  });
}
