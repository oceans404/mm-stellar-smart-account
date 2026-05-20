import { xdr } from '@stellar/stellar-sdk';

// AuthPayload { signers: Map<Signer, Bytes>, context_rule_ids: Vec<u32> }
// Field order in the ScMap MUST be lexicographic by key — `context_rule_ids`
// sorts before `signers`.
export function authPayloadScVal(
  signerSigPairs: { signer: xdr.ScVal; sig: Uint8Array | Buffer }[],
  contextRuleIds: number[],
) {
  const signerEntries = signerSigPairs.map(
    ({ signer, sig }) =>
      new xdr.ScMapEntry({
        key: signer,
        val: xdr.ScVal.scvBytes(Buffer.from(sig)),
      }),
  );
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('context_rule_ids'),
      val: xdr.ScVal.scvVec(contextRuleIds.map((id) => xdr.ScVal.scvU32(id))),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('signers'),
      val: xdr.ScVal.scvMap(signerEntries),
    }),
  ]);
}
