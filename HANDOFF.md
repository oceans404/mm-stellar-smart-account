# HANDOFF — usdc-mm (MetaMask-only smart-account USDC demo)

Orientation for the next agent. **Read this first**, then `PROGRESS.md` for the per-step diary. For the curve-agnostic on-chain proofs and EIP-712 verifier details, jump to `../sa-poc/references/ethereum-users-on-stellar.md`.

**Status (2026-05-20):** MM0 scaffolded + architectural choices locked + shared service G funded. **Code still uses Freighter.** The MM swap happens in MM1–MM4.

---

## What this is (vs usdc-poc)

| | usdc-poc | usdc-mm |
|---|---|---|
| Admin signer | Freighter G-address (`Delegated(g)`) | MetaMask Eth address (`External(secp256k1_verifier, eth_addr)`) |
| User has Stellar account? | Yes (Freighter) | **No** — Eth user, never touches Stellar |
| Envelope source / fee payer | Same user's G | Service G-address (PoC-provided; see Open Q1) |
| Verbs | Create / Receive / Send | Create / Receive / Send (parity) |
| Wasm | freighter-vault.wasm | eth-vault.wasm (sa-poc has it; need testnet upload hash) |
| Signature format | Stellar Ed25519 (Freighter) | EIP-712 typed data via MM (signTypedData_v4) |
| Channels for XLM? | Yes (post-deploy) | Yes (post-deploy AND the initial deploy — service_g pays the deploy resource fee) |

Same on-chain primitives as sa-poc's eth-vault probes (`probe-option-a-eip712.mjs`, `probe-eth-smart-account-end-to-end.mjs`); just porting Node→browser and wiring the UI.

---

## Run it locally (after MM1+ ships)

```bash
cd usdc-mm/web && pnpm install && pnpm dev
```

Port `5175` (so `sa-poc/web`=5173, `usdc-poc/web`=5174, and this run side-by-side).

Required:
- MetaMask installed on testnet (the chain it's connected to doesn't matter for signing — MM signs ECDSA over arbitrary EIP-712 data)
- Channels API key in `../../sa-poc/relayer/.env` (already shared with usdc-poc)
- **Service Stellar key** (see Open Q1) in the same `.env` for envelope signing

---

## Architectural decisions (locked)

### A1 — Envelope source: shared service G in the relayer

Stellar's tx structure requires a source-account that signs the envelope. Every Eth probe in sa-poc friendbot-creates a throwaway one (labelled `// pays fees only` in the probes). usdc-mm reuses that pattern with **one** shared service G across all PoC users:

- **Public**: `GD4WUFS577NPSEHQUIE42OQGPAHA3MYT4B6R6HGDYXAYFA6DGOFJGTFE`
- **Secret**: in `sa-poc/relayer/.env` as `USDC_MM_SERVICE_SECRET` (never touches the browser)
- **Funding**: friendbot-funded once on 2026-05-20 — 10,000 XLM balance. Re-friendbot if it drains.
- **Authority over Vaults**: none. Vault admin = Eth key via `External(verifier, pubkey)`. Service G just pays the envelope fees Channels doesn't cover (mostly the initial `createCustomContract`; post-deploy ops are Channels-paid).

New Vite plugin endpoint `/api/sign-and-submit` (MM-track) loads the secret server-side, signs the envelope, POSTs to Channels.

### A2 — eth-vault wasm: reuse existing upload

`ETH_VAULT_WASM_HASH = '66d11325950d4767b1824098dd9e701cd505eba2f93130bf5b51f476328c76a3'` — already on testnet from sa-poc's Option A probes. No re-upload needed.

**Constructor signature** (from `probe-option-a-end-to-end.mjs:314`):
```js
constructorArgs: [
  new Address(VERIFIER).toScVal(),         // CDQ27AFQ…RDTPXM6 (EIP-712 variant)
  xdr.ScVal.scvBytes(sponsorPubkey),       // 33 or 65 byte secp256k1 pubkey
]
```

The Vault stores the **full pubkey**, not the 20-byte Eth address. MetaMask only exposes the address; the pubkey has to be recovered from a signature. MM2 will need a one-time "sign-to-bind" step on first Connect that lets us `ecrecover` the pubkey, then store it locally (and use it as the constructor arg).

### A3 — EIP-712 verifier: reuse existing deploy

`VERIFIER = CDQ27AFQYQZR2TV6VAY2STM5IC2ZLBNL7OGCQF3TLTVXAIQQIRDTPXM6` (testnet). No new contract upload. Domain + types schema lives in `sa-poc/relayer/scripts/probe-option-a-eip712.mjs` — copy verbatim into `usdc-mm/web/src/lib/eip712.js` so the on-chain hash reconstruction matches.

### A4 — Signature scheme: `signTypedData_v4` (EIP-712)

Production-grade MM popup with labeled fields, not opaque hex. Verifier already deployed (A3).

### A5 — Wallet abstraction: `window.ethereum` only

WalletConnect deferred. EIP-1193-injected wallets (MM, Coinbase, Rainbow) all work via the same `window.ethereum.request()` API.

---

## Milestones planned

| ID | What | Status |
|---|---|---|
| **MM0** | Scaffold usdc-mm as a copy of usdc-poc; document architectural choices | ✅ |
| **MM1** | Connect MetaMask — replaces Freighter connect; shows user's Eth address | pending |
| **MM2** | Create — service_g signs envelope; constructorArgs use `External(verifier, eth_addr_bytes)`; deploy eth-vault.wasm | pending |
| **MM3** | Receive — display C-address (mostly inherited from usdc-poc U1) | pending |
| **MM4** | Send — EIP-712-signed AuthPayload + service_g envelope + admin context rule (rule_id=0) | pending |

After MM4: optional MM5 polish (mirror usdc-poc U3 if/when that ships).

---

## What's implemented today (MM0)

Nothing MM-specific yet. The code is `usdc-poc` verbatim with:
- `package.json` renamed to `usdc-mm-web`
- Vite port `5175`
- New docs (this file + PROGRESS + README) reflecting MM-only intent

So if you `pnpm dev` right now, you get a working Freighter demo on port 5175. That's intentional — MM1 swaps Connect first; everything else falls in line behind it.

---

## Where things live

```
usdc-mm/
├── HANDOFF.md          ← you are here
├── PROGRESS.md         ← per-step diary
├── README.md
└── web/                ← THE DEMO APP. Git repo. Vite + plain JS.
    ├── src/
    │   ├── main.js       ← UI wiring (currently a copy of usdc-poc)
    │   ├── config.js     ← reserved
    │   ├── log.js        ← in-page log panel (copy)
    │   ├── ui.js         ← toast / banner / withBusy (copy)
    │   ├── polyfills.js  ← browser Buffer (copy)
    │   └── lib/
    │       ├── stellar.js        ← RPC, sim, submit, pollForTx (copy)
    │       ├── freighter.js      ← TO BE REPLACED by metamask.js in MM1
    │       ├── smart-account.js  ← TO BE EXTENDED by eth-vault.js in MM2
    │       ├── channels.js       ← Channels POST helper (copy)
    │       └── auth-payload.js   ← AuthPayload XDR helper (copy)
    ├── index.html
    ├── package.json
    └── vite.config.js
```

---

## On-chain assets to reuse from sa-poc

| Asset | Address / Hash | Source |
|---|---|---|
| EIP-712 secp256k1 verifier | `CDQ27AFQ…RDTPXM6` | sa-poc probe-option-a-eip712.mjs |
| eth-vault wasm hash | `66d11325…328c76a3` | sa-poc probes (Option A — `probe-option-a-{end-to-end,eip712,channels}.mjs`) |
| Shared service G (envelope source) | `GD4WUFS5…GOFJGTFE` | Friendbot-funded 2026-05-20; secret in sa-poc/relayer/.env |
| USDC testnet issuer | `GBBD47IF…AQH3ZLLFLA5` | Stellar testnet canonical |
| USDC SAC (derived) | `CBIELTK6…IHMXQDAMA` | from issuer × passphrase |

---

## Known limitation: no memo on Send (Soroban + CAP-64)

Smart-account USDC lives in SAC; sends are Soroban (`InvokeHostFunctionOp`). Soroban txs cannot carry memos at the protocol level — `memo MUST be MEMO_NONE`. Per Stellar dev docs (`developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/stellar-transaction`).

This blocks the standard "send to exchange with subaccount memo" flow from a smart account. **CAP-0064 "Memo Authorization for Soroban"** is the in-flight protocol fix and cites this exact use case as the motivating example. Not in Protocol 23 (Sept 2025); not yet scheduled.

Until CAP-64 lands, two product-level workarounds exist (neither implemented here):
1. Two-step relay: service_g sets up a USDC trustline; Send becomes (a) SAC.transfer(account → service_g) EIP-712 authed, (b) classic Payment(service_g → recipient) with memo signed by service_g. Atomicity not guaranteed; failure modes need handling.
2. Wallet-CLI-level branch: local-key wallets (classic) handle memo-required sends; Smart Account wallets surface a "memo not supported" message. Matches the wallet-cli's existing local-key vs Smart Account split.

For the v0 demo we strip the memo input and document the constraint. Re-enable when CAP-64 ships or option 1 is built.

## Conventions (carried from usdc-poc)

- Commit per milestone in `usdc-mm/web/` (oceans404, no Co-Authored-By trailer).
- Update PROGRESS.md per milestone before committing.
- Inner-tx fee always `'0'` for Channels.
- `lib/` modules are stable; new milestones touch `main.js`, `index.html`, and add a single new module (`metamask.js` for MM1, `eth-vault.js` for MM2).
- Freighter files (`lib/freighter.js`) get deleted in MM1, not kept around.
