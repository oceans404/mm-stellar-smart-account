# usdc-mm

> ### Live demo → [mm-stellar-smart-account.vercel.app](https://mm-stellar-smart-account.vercel.app/)
>
> **Monday ready.** ANY MetaMask user can onboard to Stellar today, with less friction than ever before. Built to solve the user-onboarding pain that Ada and the DeFi + Ecosystem teams have been flagging. This is the live working demo, not a roadmap.
>
> **Try it right now.** Open the link, connect your MetaMask, create your own Stellar smart account (admin'd by your Ethereum key), interact with it, receive USDC at a real Stellar address. No Freighter wallet to install. No Stellar account to set up. No XLM in your hands. No second seed phrase to back up. Stellar testnet only.

**What if you wanted to give a MetaMask user some assets (USDC) on Stellar? How would you do it?** Today they would have to install Freighter, generate a Stellar keypair, fund it with XLM for the base reserve, set up a USDC trustline, and learn an account model that does not match the one they already use on Ethereum. Most never get past step one. The answer is to create them a smart account on Stellar whose admin signer is the Ethereum key they already have. Their MetaMask becomes the only wallet they touch. The Stellar plumbing (envelope source, XLM fees, on-chain signature verification) lives behind a shared service account and OpenZeppelin's Channels relay, invisible to the user.

usdc-mm wires this idea into a three-verb demo: Create, Receive, Send. Create asks MetaMask for one signature to bind the user's full public key, then deploys an `eth-vault` smart contract whose admin signer is `External(secp256k1 verifier, pubkey)`. Receive surfaces the resulting Stellar C-address so anyone (a wallet, another smart account, an agent) can send USDC to it via the USDC Stellar Asset Contract. Send produces one MetaMask popup, an EIP-712 typed data envelope that labels the operation, recipient, amount, expiry, and a cryptographic anchor binding the signature to the specific Soroban op. The browser hands the signed authorization to a small relayer that signs the Stellar envelope as the shared service account and submits via Channels. The user never holds a Stellar key, never pays XLM, never installs a Stellar wallet. The only known gap is exchange deposits that require a memo, which Soroban transactions cannot carry today (Stellar CAP-64 is the protocol fix in flight).

---

## How it works

- **Smart account.** An `eth-vault` Soroban contract on Stellar testnet. Admin signer is stored as `External(verifier_contract, eth_pubkey)`.
- **Pubkey binding.** On first Connect, MetaMask `personal_sign`s a short bind message. The browser ecrecovers the user's full secp256k1 pubkey from the signature and caches it in localStorage keyed by 0x address.
- **The verifier.** An on-chain Stellar contract (reused across all users) that takes an EIP-712 signature and ecrecovers the signing pubkey via Soroban's native `secp256k1_recover` host function. The Vault checks that the recovered pubkey matches the one registered at deploy.
- **The Send round trip, one MetaMask popup:**
  1. Browser builds the Soroban `USDC.transfer(from, to, amount)` op and simulates it.
  2. User signs an EIP-712 envelope with labeled fields (operation, from, to, amount, expiry, auth digest).
  3. Signature is packed in the verifier's wire format and attached as the Soroban authorization.
  4. A small relayer signs the Stellar envelope as a shared service G-account. Stellar requires a source-account on every tx; the service has zero authority over any Vault, just pays fees.
  5. OpenZeppelin Channels submits the transaction and covers the XLM cost.
- **Recovery.** The MetaMask key alone controls the funds. Wipe localStorage, sign back in with the same MetaMask account, the same Vault loads.

---

## Run it

```bash
npm install
cp .env.example .env.local   # fill in USDC_MM_SERVICE_SECRET + CHANNELS_API_KEY
npm run dev                  # localhost:5175
```

The dev server reads `.env.local` for the two required secrets. The service Stellar secret is used server-side only (signs envelopes for outbound txs). The Channels key is used by the API routes when relaying.

## Deploy to Vercel

The live build at the top of this README is hosted on Vercel from `main`. To redeploy from scratch:

1. In Vercel, **Add New → Project** and import this repo.
2. Under **Project Settings → Environment Variables**, add:
   - `USDC_MM_SERVICE_SECRET` = the shared service Stellar secret (`S...`)
   - `CHANNELS_API_KEY` = your OpenZeppelin Channels API key
   - Scope both to all environments (Production, Preview, Development).
3. Deploy. The API routes (`/api/service-info`, `/api/sign-and-submit`, `/api/channels`) run as Vercel serverless functions and read the env vars at request time. The page bundle ships with no secrets in it.

If `/api/service-info` returns `serviceConfigured: false` after deploy, the env var didn't make it into the build — check the Vercel project settings.

---

Start here:
- `HANDOFF.md` — orientation for the next agent (architectural choices, on-chain assets, known limitations)
- `PROGRESS.md` — per-step diary (MM0 through MM4, built on the now-removed Vite version on `main`)
- `SCRIPT.md` — 1-minute hackathon demo script
