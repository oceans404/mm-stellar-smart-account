# SCRIPT — 1-minute hackathon demo

≈60 seconds, ~140 words spoken. Seven scenes. Browser is open to localhost:5175 throughout scenes 3 onward.

---

### 0:00 – 0:12 · Hook

**Visual:** Title card. "usdc-mm" in Stellar blue. Subtitle: "MetaMask. Stellar. One wallet."

**Voiceover:** "What if you wanted to give a MetaMask user some USDC on Stellar? Today, they'd install Freighter, fund XLM, set up trustlines, learn a new account model. Most quit early."

---

### 0:12 – 0:21 · The answer

**Visual:** Simple diagram. Box: "MetaMask · 0x…". Arrow labeled "admin signer". Box: "Smart account on Stellar (C-address)".

**Voiceover:** "Instead, we create them a smart account on Stellar. Admin signer? Their Ethereum key. MetaMask is the only wallet they touch."

---

### 0:21 – 0:25 · Connect

**Visual:** Browser at localhost:5175. Click "Connect MetaMask". MM popup. Click Connect. The 0x… address fills in.

**Voiceover:** "One click. MetaMask. That's it."

---

### 0:25 – 0:35 · Create

**Visual:** Click "Create Account". MetaMask popup shows a plain readable message: "Bind your Ethereum key to usdc-mm." User signs. Loading. The smart account C-address appears. Green toast: "Account created."

**Voiceover:** "Create. One signature binds the user's public key. A Stellar smart contract deploys, admin'd by their Ethereum key. No XLM, no Stellar wallet."

---

### 0:35 – 0:43 · Receive

**Visual:** Section 3. The smart account's Stellar address shown large. Hover over Copy.

**Voiceover:** "Their smart account has a Stellar address. Anyone can send USDC here. Other wallets, exchanges, smart contracts, AI agents."

---

### 0:43 – 0:50 · Send

**Visual:** Section 4. Paste a recipient address. Amount: 0.1. Click Send. MetaMask popup, EIP-712 typed data with labeled fields (operation, from, to, amount, expiry). Sign. Balance ticks down.

**Voiceover:** "Send. One MetaMask popup, labeled fields, not opaque hex. Sign, and the transfer lands on Stellar in about five seconds."

---

### 0:50 – 0:60 · Close

**Visual:** Three counters fade in: "0 Freighter installs.", "0 XLM held by the user.", "0 new keys to back up." Hold on a final card: "An Ethereum identity. Native on Stellar."

**Voiceover:** "Zero Freighter installs. Zero XLM held by the user. Zero new keys to back up. An Ethereum identity, native on Stellar."

---

## Notes for the recorder

- Pre-fund the smart account with ~0.5 USDC before recording so the Send (scene 6) has a real balance to spend.
- Pre-connect MetaMask once before recording, then disconnect so the Connect scene shows a fresh popup (some MM versions cache the approval).
- If a scene runs long, the safest trim is Receive (scene 5) down to one sentence: "Their smart account has a Stellar address. Anyone can send USDC here."
- The full demo runs ~60 seconds at a calm 145 wpm. Speed up to ~170 wpm if a presenter wants to bank time for a Q&A.
