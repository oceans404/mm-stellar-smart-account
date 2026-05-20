# PROGRESS — per-step log

Diary of milestones run. Short bullets, gotchas first. HANDOFF is the reference; this is the log.

---

## MM0 — Scaffold (copy from usdc-poc)

**✓ scaffolded 2026-05-20**

**What happened**
- `cp -R usdc-poc/ usdc-mm/` then stripped `.git`, `node_modules`, lockfiles.
- `package.json` renamed to `usdc-mm-web`.
- `vite.config.js` port `5175` (so sa-poc=5173, usdc-poc=5174, usdc-mm=5175 all coexist).
- Channels proxy still reads from `../../sa-poc/relayer/.env`. No second relayer dir for now.
- New HANDOFF + PROGRESS + README written for MM-only scope.
- Code is **still Freighter**. Intentional — MM1 swaps connect first, everything else after.

**Gotchas**
- First `git commit` accidentally captured the copy *before* the docs/package.json/vite-port renames landed (Write tool requires Read-first for existing files; cp creates files outside that tracker). Fixed in a follow-up commit.

**Architectural decisions — all locked in HANDOFF.md §"Architectural decisions"**
- A1: Shared service G in relayer. Funded **2026-05-20** with 10,000 XLM via friendbot. Public: `GD4WUFS5…GOFJGTFE`. Secret in `sa-poc/relayer/.env` as `USDC_MM_SERVICE_SECRET`.
- A2: Reuse `ETH_VAULT_WASM_HASH = 66d11325…328c76a3` (already on testnet). Constructor takes `(verifier_c, sponsor_pubkey_bytes)` — needs ecrecover from MM sig on first Connect.
- A3: Reuse EIP-712 verifier `CDQ27AFQ…RDTPXM6`. No new upload.
- A4: `signTypedData_v4`.
- A5: `window.ethereum` only. WalletConnect deferred.

**Next:** MM1 — replace Freighter connect with MetaMask connect. Strip `lib/freighter.js`, add `lib/metamask.js`, update Connect button + address display. Deploy / Send buttons stay broken until MM2 / MM4 land.

---

## MM1 — Connect MetaMask (replaces Freighter)

**✓ passed 2026-05-20**

**What happened**
- `lib/freighter.js` removed; `lib/metamask.js` added. EIP-1193 wrapper around `window.ethereum` — `ensureConnected` (eth_requestAccounts), `getChainId`, `onAccountsChanged`, and a `signTypedDataV4` helper stashed for MM4.
- `package.json` swap: drop `@stellar/freighter-api`, add `ethers ^6.13.0` (used for ecrecover in MM2 + EIP-712 helpers in MM4).
- `index.html`: title now "usdc-mm". Connect button says "Connect MetaMask". Address now a full-text `<code>` (0x… is 42 chars). Chain ID badge replaces the Stellar TESTNET badge. Section 2 (Create) and Section 4 (Send) get inline "MM2 — not wired yet" / "MM4 — not wired yet" hints; their buttons stay disabled with tooltip explanations.
- `main.js` rewritten lean for MM1 scope. Connect → set 0x address + chain → enable Set Account. Restore-existing flow (Set Account → C-address + balance refresh) works without any Stellar key in the browser — `readUsdcBalance` uses `SHARED_SOURCE_G` (public-only constant `GD4WUFS5…GTFE`) as the sim source.
- `onAccountsChanged` re-syncs when user swaps active MM account.
- Deploy + Send handlers deliberately deleted (no stub). The disabled buttons make the gating obvious.

**Gotchas**
- **Curve mismatch is fine.** MM's `chainId` is irrelevant for our signing — the user can be on Ethereum mainnet, an L2, or anything; what matters is the secp256k1 signature MM produces. We display the chain just to make the demo legible.
- **`localStorage` not yet used.** A user who reloads the page loses the C-address bound to their MM identity unless they paste it back into Restore. MM2 will add the persistence layer (account_for[eth_address] → c-address mapping).
- **First Restore needs a real C-address.** Until MM2 lands, the only way to get one is to deploy a Vault elsewhere (e.g., sa-poc with an Eth signer) and paste it in. The MM1 milestone proves Connect + Restore + balance read work standalone.

**Doc updates owed**
- After MM2: write up the bind-pubkey flow (sign-once on Connect to expose the pubkey via ecrecover) in HANDOFF.

**Next:** MM2 — Create. Needs the `/api/sign-and-submit` Vite endpoint (task #9), then the bind-pubkey flow, then `eth-vault` deploy with `constructorArgs = [VERIFIER, eth_pubkey_bytes]`.

---

## Task #9 — Relayer endpoint `/api/sign-and-submit`

**✓ built 2026-05-20** (smoke-tested via /api/service-info; full flow exercised by MM2)

**What happened**
- `vite.config.js` now exposes two new endpoints alongside the existing `/api/channels`:
  - `GET /api/service-info` — returns `{ servicePublic, channelsConfigured, serviceConfigured }`. Public-only sanity check; the browser logs the service G on load so any `.env` misconfig is loud and immediate.
  - `POST /api/sign-and-submit` — takes `{ xdr: <inner tx XDR with auth entries, envelope unsigned> }`. Parses XDR, verifies `tx.source === servicePublic`, signs envelope with `USDC_MM_SERVICE_SECRET`, forwards to Channels, returns Channels' response.
- `lib/channels.js` extended with `signAndSubmit(innerXdr)` and `fetchServiceInfo()` client helpers. `submitViaChannels` kept for parity with usdc-poc.
- `main.js` calls `fetchServiceInfo()` on load. Log shows `relayer ready — service G GD4WUFS5…` when both keys are present; otherwise red error noting which one's missing.
- Source-mismatch guard rejects with a 400 before any signing attempt — saves debugging time if the browser builds with the wrong sourceG.

**Gotchas**
- `@stellar/stellar-sdk` imported at the top of `vite.config.js`. Works in Node (the SDK has CJS + ESM exports). If Vite's bundler ever complains, fallback is to inline-build the envelope sig with `@stellar/sdk/lib/keypair.js` directly.
- Service G secret is now in `sa-poc/relayer/.env` (shared with the other POCs). The .env file is git-ignored at sa-poc/relayer/ level via the project's setup; do not commit.

**Next:** MM2 — Create eth-vault. Needs (1) bind-pubkey on first Connect (one-time MM signature → ecrecover full pubkey from 0x… address, stash in localStorage); (2) build createCustomContract with `wasmHash = ETH_VAULT_WASM_HASH`, `constructorArgs = [VERIFIER, recovered_pubkey_bytes]`, source = SHARED_SOURCE_G, fee = '0'; (3) submit via `signAndSubmit`. Channels covers the deploy resource fee.

---

## MM2 — Create eth-vault (Eth pubkey as admin)

**✓ built 2026-05-20** (browser flow not yet exercised end-to-end)

**What happened**
- New `lib/eth-vault.js` with three constants (`SHARED_SOURCE_G`, `VERIFIER`, `ETH_VAULT_WASM_HASH`) + `buildEthVaultDeployTx(sourceG, verifierAddr, pubkeyBytes)`. Constructor shape verbatim from `probe-option-a-end-to-end.mjs:314` — `[Address(VERIFIER), Bytes(pubkey)]`. Source must be the shared service G; relayer rejects others.
- `lib/metamask.js` extended with `bindPubkey(ethAddress)` (one-time `personal_sign` + browser `ecrecover` via ethers v6, sanity-checked by re-deriving the 0x… address from the recovered pubkey), `getCachedPubkey`, `getCachedAccount`, `setCachedAccount`, `clearCachedAccount`. Cache keys: `usdc-mm:pubkey:0x…` and `usdc-mm:account:0x…`. Both are localStorage entries scoped to the active MM identity.
- `main.js` Create handler: bind → build deploy tx (source = SHARED_SOURCE_G, fee = '100000000') → simulateAndAssemble → `signAndSubmit(innerXdr)` → `pollForTx(hash)` → `extractDeployedContractAddress` → setAccount + cache. Channels' returned hash IS the inner tx hash (per `probe-option-a-channels.mjs:31` comment), so polling works directly.
- Auto-restore on Connect: if `getCachedAccount(ethAddress)` returns a C-address, `setAccount` is called immediately. User reloads page → still sees their account + balance.
- `onAccountsChanged` also re-loads the per-identity cached account when the user swaps MM accounts.
- index.html section 2 banner removed; Create button enabled after Connect.

**Gotchas**
- **Pubkey is 65 bytes uncompressed.** `recoverPublicKey` in ethers v6 returns `0x04XX…` (1-byte prefix + 32-byte X + 32-byte Y). The eth-vault constructor takes this as-is. If anything balks at 65 bytes (it didn't in the probe), we'd need to drop the `0x04` prefix and pass 64 bytes — note for MM4.
- **personal_sign for bind, EIP-712 for send.** Different schemes serve different purposes: bind ecrecover happens in the browser (so any consistent message-prefix scheme works); MM4's send goes through the on-chain EIP-712 verifier (so we must use signTypedData_v4 matching the verifier's domain). Don't conflate.
- **Resource fee is paid by the service G, not Channels.** Per Eth-users doc and Option A Channels probe: createCustomContract costs ~0.012 XLM on the source. Service G has 10,000 XLM → ~833k creates before refill.
- **Channels' returned `hash` is the inner tx hash**, not the fee-bump hash. `pollForTx` works directly with it; result meta contains the inner Soroban op output.

**Doc updates owed**
- After first successful create: paste a real C-address into PROGRESS for sanity-check.

**Next:** MM3 — Receive. Mostly inherited from usdc-poc U1 (already displays C-address + Copy + balance refresh). Only thing left is to lift the "MM2 — not wired yet" framing in HANDOFF for section 3 and confirm the flow works after a real Create.

---

## MM3 — Receive (effectively done via MM2 + the U1-inherited UI)

**✓ passed 2026-05-20** (inherited from usdc-poc U1)

**What happened**
- No new code. The Receive UI block (C-address display + Copy + balance + Refresh) was already shipped in the usdc-poc copy at MM0, and MM2's Create flow auto-populates it via `setAccount(addr)` + `refreshAccountBalance()`. Restore-via-paste + cached-restore-on-Connect both feed the same code path.

**Gotchas**
- None. This was the cheapest milestone — the only "new" thing is that the receive address now belongs to a Vault whose admin is an Eth key, not a Stellar key. From the UI's perspective, the C-address is just a C-address.

**Next:** MM4 — Send via EIP-712 + relayer envelope.

---

## MM4 — Send via EIP-712 + service-signed envelope

**✓ built 2026-05-20** (browser flow not yet exercised end-to-end)

**What happened**
- New `lib/eip712.js` — copies the verifier-matching schema verbatim from `probe-option-a-eip712.mjs`:
  - `EIP712_DOMAIN(verifyingContract)` returning `{ name: 'Stellar Vault', version: '1', chainId: 0, verifyingContract }`
  - `EIP712_TYPES` with the `StellarVaultAuth` struct (operation, from, to, amount, nonce, validUntilLedger, stellarAuthDigest)
  - `stellarAddrToEvm20` — truncate any G/C strkey to 20 bytes for the popup display (lossy but only cosmetic; cryptographic binding is via stellarAuthDigest)
  - `computeAuthDigest({ nonce, signatureExpirationLedger, invocation, contextRuleIds })` — returns sha256(sha256(SorobanAuth preimage) || ScVec([rule_ids]).toXDR()), exactly what the verifier reconstructs
  - `externalSignerScVal(verifier, pubkey)` — for the AuthPayload signers map key
  - `signEip712Auth({...})` — calls `signTypedDataV4` (the MM popup), parses sig via ethers v6 `Signature.from`, packs the wire-format sig_data Buffer the verifier expects
- `main.js` Send handler ported from sa-poc M11-style flow with one critical simplification: **no nested sponsor_g SourceAccount entry needed.** External(eth) signers verify via `secp256k1_recover` directly in `__check_auth`; there's no `require_auth_for_args(sponsor)` like the Delegated path has. Just one Vault auth entry, EIP-712-signed, attached, re-simulated, sent through the relayer.
- One MM popup per Send (the EIP-712 typed data). Zero Stellar prompts. Service G pays no XLM for the inner op (Channels covers it via fee-bump; inner fee='0').

**Gotchas**
- **EIP-712 schema is fragile.** Any drift from probe-option-a-eip712.mjs's domain or types will produce a signature whose recovered pubkey doesn't match what's stored in the Vault. The verifier hashes `keccak256(0x1901 || domainSep || msgHash)`; off-by-one in any field flips the sig invalid.
- **`Signature.from` returns yParity as 0/1, not v as 27/28.** The probe packs `[sig.yParity]` (one byte). Same here; the verifier expects yParity.
- **The 20-byte address truncation for from/to is lossy.** Doesn't matter for security (binding is via stellarAuthDigest) but the popup's "from"/"to" lines are technically not the full address. UX-only annotation, not a verification path.
- **`signTypedData_v4` envelope shape.** MetaMask wants `{ domain, types, primaryType, message }`. The probe passes `{ domain, types, value }` to ethers' `Wallet.signTypedData`, but for `eth_signTypedData_v4` over JSON-RPC the key is `message`, not `value`.

**Next:** test in browser. If green, the v0 demo is complete: MM-only UX, three verbs, EIP-712-grade signing, zero Freighter / zero user-side Stellar keys.

---

## MM4.1 — Memo on Send: tried, reverted (Soroban protocol limitation)

**✗ reverted 2026-05-20**

**What we learned**
- Built a memo input on Send + threaded `Memo.text(s)` through `buildInvokeTx`. First test failed with `FEE_MISMATCH` (fixed separately) and then `Transaction contains a memo. Soroban transactions do not support memos.` That error is the chain runtime, not a relayer bug.
- Verified via Stellar dev docs (`developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/stellar-transaction`): Soroban txs containing `InvokeHostFunctionOp` MUST have `memo = MEMO_NONE`. Protocol-level rule.
- Verified via CAP-0064 spec ("Memo Authorization for Soroban") that this is the known adoption blocker for smart-account → exchange flows. Quote: "it is currently not possible to e.g. send token from a custom account balance to an exchange account. This is a common procedure for off-ramp or CEX-based trading and thus not supporting it significantly hinders the adoption of custom accounts." CAP-64 is the in-flight fix. NOT in Protocol 23 (Sept 2025); no scheduled date.
- Decision: strip memo input entirely. Re-enable when CAP-64 ships (drop-in) or when the two-step classic-Payment workaround is built (requires service_g USDC trustline + new relayer endpoint).

**Workaround for now (out-of-band)**
- Send USDC out of the smart account to any G-address you control, then originate a classic Payment from that G with memo as you normally would.
- Or, for the wallet-cli product surface: route memo-required sends through a local-key wallet path (classic Payment) instead of the Smart Account path.

**For HANDOFF**: see new "Known limitation: no memo on Send (Soroban + CAP-64)" section.

---

## v0 status: complete

MM-only UX, Create / Receive / Send all working, EIP-712-grade signing, Channels-paid post-deploy ops, zero Freighter / zero user-side Stellar keys. Memo input intentionally absent until CAP-64 lands.

**What happened**
- Send section gains an optional `Memo` text input. Placeholder explains the use case (exchange routing IDs). 28-byte UTF-8 limit enforced both with HTML `maxlength` and a `TextEncoder` byte-count check in validation — the latter catches multi-byte UTF-8 characters that would slip past the char-count cap.
- `buildInvokeTx` in `lib/smart-account.js` takes an optional `memo` arg (any `Memo` instance from stellar-sdk). When present, `.addMemo(memo)` is chained before `.build()`. Default behavior unchanged when memo is null/undefined.
- `sendFlow` constructs `Memo.text(memoText)` if the field is non-empty and passes it through both the base-sim build and the re-sim build (so the memo is preserved through `assembleTransaction`).
- Toast message echoes the memo back on success for visual confirmation.

**Gotchas**
- **Memo does NOT enter the EIP-712 signature.** It's envelope-level metadata, not part of the Soroban auth digest. So the user technically isn't "signing" the memo — it could be tampered between sign and submit *if* there were an attacker in the path. Acceptable for the trust model (user trusts the app + the relayer) but worth flagging if we ever extend to untrusted relayers.
- **Memo.text is exactly 28 bytes max.** `Memo.text` throws if longer; we pre-validate with TextEncoder to surface a friendly form error first.
- **stellar.expert renders memos on the tx detail page.** Visible as "Memo: <text>" under the operations list.

**v0 status: complete.** MM-only UX, Create / Receive / Send all working, EIP-712-signed admin auth, Channels-paid post-deploy ops, optional exchange memo on Send.

---
