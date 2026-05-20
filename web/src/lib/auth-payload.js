import { xdr } from '@stellar/stellar-sdk';

// AuthPayload { signers: Map<Signer, Bytes>, context_rule_ids: Vec<u32> }
// Field order in the ScMap MUST be lexicographic by key — `context_rule_ids`
// sorts before `signers`. For Delegated signers, the Bytes value is ignored
// by stellar-accounts (auth comes from require_auth_for_args on the address),
// so empty bytes are fine. Multi-signer maps must lex-sort signer keys too
// (Gotcha 8 in HANDOFF).
export function authPayloadScVal(signerSigPairs, contextRuleIds) {
  const signerEntries = signerSigPairs.map(({ signer, sig }) =>
    new xdr.ScMapEntry({ key: signer, val: xdr.ScVal.scvBytes(sig) })
  );
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('context_rule_ids'),
      val: xdr.ScVal.scvVec(contextRuleIds.map(id => xdr.ScVal.scvU32(id))),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('signers'),
      val: xdr.ScVal.scvMap(signerEntries),
    }),
  ]);
}
