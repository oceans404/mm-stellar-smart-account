import './polyfills.js';
import { Address, rpc } from '@stellar/stellar-sdk';
import {
  ensureConnected, getChainId, onAccountsChanged,
  bindPubkey, getCachedAccount, setCachedAccount,
} from './lib/metamask.js';
import {
  NETWORK_PASSPHRASE, extractDeployedContractAddress, pollForTx, server, simulateAndAssemble,
} from './lib/stellar.js';
import {
  USDC_SAC, buildInvokeTx, getCurrentLedger,
  readUsdcBalance, stroopsToUsdc, usdcToStroops, usdcTransferArgs,
} from './lib/smart-account.js';
import {
  SHARED_SOURCE_G, VERIFIER, buildEthVaultDeployTx,
} from './lib/eth-vault.js';
import { authPayloadScVal } from './lib/auth-payload.js';
import {
  externalSignerScVal, signEip712Auth, stellarAddrToEvm20,
} from './lib/eip712.js';
import { fetchServiceInfo, signAndSubmit } from './lib/channels.js';
import { log } from './log.js';
import { installUnhandledRejectionBanner, showToast, withBusy } from './ui.js';

installUnhandledRejectionBanner();

// Sanity-check the relayer config at load.
fetchServiceInfo()
  .then((info) => {
    if (info.serviceConfigured && info.channelsConfigured) {
      log('relayer', `relayer ready — service G ${info.servicePublic}`);
    } else {
      log('err', `relayer misconfigured: ${JSON.stringify(info)}`);
    }
  })
  .catch((e) => log('err', `relayer probe failed: ${e.message}`));

const $ = (id) => document.getElementById(id);
const state = {
  ethAddress: null,
  chainId: null,
  accountAddr: null,
};

function setEthAddress(addr) {
  state.ethAddress = addr;
  const el = $('address');
  if (addr) { el.textContent = addr; el.style.color = ''; }
  else { el.textContent = 'not connected'; el.style.color = '#6b7280'; }
}
function setChain(chainId) {
  state.chainId = chainId;
  $('chain').textContent = chainId ? `chain: ${chainId}` : 'chain: —';
}
function setAccount(addr) {
  state.accountAddr = addr;
  const acctEl = $('account');
  const recvEl = $('receive-address');
  if (addr) {
    acctEl.textContent = addr; acctEl.style.color = '';
    recvEl.textContent = addr; recvEl.style.color = '';
    $('copy-account').disabled = false;
    $('copy-receive').disabled = false;
    $('refresh-balance').disabled = false;
    if (state.ethAddress) $('send').disabled = false;
    refreshAccountBalance().catch(() => {});
  } else {
    acctEl.textContent = 'no account yet'; acctEl.style.color = '#6b7280';
    recvEl.textContent = 'create or restore an account first'; recvEl.style.color = '#6b7280';
    $('copy-account').disabled = true;
    $('copy-receive').disabled = true;
    $('refresh-balance').disabled = true;
    $('send').disabled = true;
    setBalance(null);
  }
}
function setBalance(stroops) {
  if (stroops == null) $('account-balance').textContent = '—';
  else $('account-balance').textContent = `${stroopsToUsdc(stroops).toFixed(7)} USDC`;
}

const C_STRKEY = /^C[A-Z2-7]{55}$/;
const G_STRKEY = /^G[A-Z2-7]{55}$/;

$('connect').addEventListener('click', async () => {
  try {
    log('ui', 'connecting to MetaMask');
    const addr = await ensureConnected();
    setEthAddress(addr);
    const chainId = await getChainId();
    setChain(chainId);
    log('ui', `connected: ${addr} (chain ${chainId})`);
    $('set-account').disabled = false;
    $('deploy').disabled = false;
    const cached = getCachedAccount(addr);
    if (cached && C_STRKEY.test(cached)) {
      log('ui', `restoring cached account for ${addr.slice(0,6)}…: ${cached}`);
      setAccount(cached);
    }
    showToast(`Connected: ${addr.slice(0, 6)}…${addr.slice(-4)}`);
  } catch (e) {
    log('err', e.message ?? String(e));
    showToast(`Connect failed: ${(e.message ?? e).slice(0, 80)}`, { kind: 'err' });
  }
});

onAccountsChanged((accounts) => {
  if (!accounts || accounts.length === 0) {
    log('mm', 'wallet disconnected (no accounts)');
    setEthAddress(null); setChain(null); setAccount(null);
    $('set-account').disabled = true;
    $('deploy').disabled = true;
    return;
  }
  log('mm', `accountsChanged: ${accounts[0]}`);
  setEthAddress(accounts[0]);
  const cached = getCachedAccount(accounts[0]);
  setAccount(cached && C_STRKEY.test(cached) ? cached : null);
});

$('set-account').addEventListener('click', () => {
  const v = $('account-input').value.trim();
  if (!C_STRKEY.test(v)) {
    log('err', `not a valid Soroban contract strkey: ${v.slice(0, 40)}${v.length > 40 ? '…' : ''}`);
    return;
  }
  setAccount(v);
  if (state.ethAddress) setCachedAccount(state.ethAddress, v);
  log('ui', `account set to ${v}`);
});

async function copyToClipboard(text, buttonEl) {
  try {
    await navigator.clipboard.writeText(text);
    const prev = buttonEl.textContent;
    buttonEl.textContent = 'Copied!';
    setTimeout(() => { buttonEl.textContent = prev; }, 1200);
    log('ui', `copied ${text} to clipboard`);
  } catch (e) {
    log('err', `clipboard write failed: ${e.message ?? e}`);
  }
}

$('copy-account').addEventListener('click', () => {
  if (state.accountAddr) copyToClipboard(state.accountAddr, $('copy-account'));
});
$('copy-receive').addEventListener('click', () => {
  if (state.accountAddr) copyToClipboard(state.accountAddr, $('copy-receive'));
});

async function refreshAccountBalance() {
  if (!state.accountAddr) return null;
  try {
    const stroops = await readUsdcBalance(state.accountAddr, SHARED_SOURCE_G);
    setBalance(stroops);
    log('stellar', `account USDC balance: ${stroopsToUsdc(stroops).toFixed(7)} (${stroops.toString()} stroops)`);
    return stroops;
  } catch (e) {
    log('err', `read balance: ${e.message ?? e}`);
    return null;
  }
}

$('refresh-balance').addEventListener('click', () => {
  refreshAccountBalance().catch(() => {});
});

// ---------- MM2 — Create eth-vault ----------

$('deploy').addEventListener('click', async () => {
  if (!state.ethAddress) return;
  await withBusy($('deploy'), 'Creating…', async () => {
    try {
      log('ui', 'creating eth-vault smart account');
      const pubkeyBytes = await bindPubkey(state.ethAddress);
      log('stellar', `admin will be External(${VERIFIER.slice(0,8)}…, ${pubkeyBytes.length}b pubkey)`);

      const tx = await buildEthVaultDeployTx(SHARED_SOURCE_G, VERIFIER, pubkeyBytes);
      const { assembled } = await simulateAndAssemble(tx, 'eth-vault createCustomContract');

      const innerXdr = assembled.toXDR();
      const channelsTxHash = await signAndSubmit(innerXdr);
      const result = await pollForTx(channelsTxHash);
      if (!result?.successful) throw new Error(`tx failed; hash=${channelsTxHash}`);

      const retval = extractDeployedContractAddress(result.resultMetaXdr);
      const accountAddr = Address.fromScVal(retval).toString();
      setAccount(accountAddr);
      setCachedAccount(state.ethAddress, accountAddr);
      log('stellar', `eth-vault deployed — ${accountAddr}`);
      log('stellar', `stellar.expert: https://stellar.expert/explorer/testnet/contract/${accountAddr}`);
      showToast(`Account created: ${accountAddr.slice(0, 6)}…${accountAddr.slice(-4)}`);
    } catch (e) {
      log('err', e.message ?? String(e));
      showToast(`Create failed: ${(e.message ?? e).slice(0, 80)}`, { kind: 'err' });
    }
  });
});

// ---------- MM4 — Send (EIP-712-signed admin auth via MetaMask) ----------

function validateSendForm() {
  const recipient = $('send-recipient').value.trim();
  const amountRaw = $('send-amount').value.trim();
  const amount = Number(amountRaw);
  if (!recipient) return { ok: false, msg: 'recipient required' };
  if (!G_STRKEY.test(recipient) && !C_STRKEY.test(recipient)) {
    return { ok: false, msg: 'recipient must be a G… or C… address (56 chars)' };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, msg: 'amount must be > 0' };
  }
  return { ok: true, recipient, amount };
}

function refreshSendValidation() {
  const v = validateSendForm();
  $('send-validation').textContent = v.ok ? '' : v.msg;
}
$('send-recipient').addEventListener('input', refreshSendValidation);
$('send-amount').addEventListener('input', refreshSendValidation);

$('send').addEventListener('click', async () => {
  if (!state.ethAddress || !state.accountAddr) return;
  const v = validateSendForm();
  if (!v.ok) {
    log('err', `send form: ${v.msg}`);
    $('send-validation').textContent = v.msg;
    return;
  }
  await withBusy($('send'), 'Sending…', async () => {
    try {
      await sendFlow(state.accountAddr, v.recipient, v.amount);
      showToast(`Sent ${v.amount} USDC → ${v.recipient.slice(0,6)}…${v.recipient.slice(-4)}`);
    } catch (e) {
      log('err', e.message ?? String(e));
      showToast(`Send failed: ${(e.message ?? e).slice(0, 80)}`, { kind: 'err' });
    }
  });
});

// Full EIP-712 send recipe (matches sa-poc probe-option-a-eip712.mjs):
// 1. inner tx, source = SHARED_SOURCE_G, fee='0' (Channels invariant)
// 2. sim → expect 1 auth entry credentialed Address (the Vault)
// 3. set signatureExpirationLedger, compute auth_digest
// 4. sign EIP-712 typed data via MM signTypedData_v4 (popup with labeled fields)
// 5. pack sig_data wire format, attach to AuthPayload signers map keyed by
//    External(VERIFIER, pubkey) signer ScVal, rule_ids=[0]
// 6. re-sim with attached entry → assembleTransaction → signAndSubmit
async function sendFlow(accountAddr, recipient, amountUsdc) {
  const amountStroops = usdcToStroops(amountUsdc);
  log('ui', `sending ${amountUsdc} USDC: ${accountAddr.slice(0,6)}… → ${recipient.slice(0,6)}…`);

  const pubkeyBytes = await bindPubkey(state.ethAddress);

  const transferArgs = usdcTransferArgs({
    from: accountAddr, to: recipient, amountStroops,
  });
  // No memo here — Soroban txs can't carry memos (protocol rule).
  // See HANDOFF "Memo on Send" section for the planned two-step workaround.
  const tx = await buildInvokeTx({
    sourceG: SHARED_SOURCE_G, contract: USDC_SAC, fn: 'transfer', args: transferArgs,
  });

  log('stellar', 'simulating send (admin-authorized via External(verifier, pubkey))');
  const sim1 = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim1)) throw new Error(`sim-base: ${sim1.error}`);
  const authEntries = sim1.result?.auth ?? [];
  if (authEntries.length !== 1) throw new Error(`expected 1 auth entry, got ${authEntries.length}`);
  const vaultEntry = authEntries[0];
  const credAddr = Address.fromScAddress(vaultEntry.credentials().address().address()).toString();
  if (credAddr !== accountAddr) throw new Error(`auth entry credentials.address=${credAddr}, expected account ${accountAddr}`);

  const currentLedger = await getCurrentLedger();
  const validUntilLedger = currentLedger + 720;
  const credentials = vaultEntry.credentials().address();
  credentials.signatureExpirationLedger(validUntilLedger);
  const nonce = credentials.nonce();

  log('mm', 'requesting EIP-712 signature (signTypedData_v4)…');
  const sigData = await signEip712Auth({
    ethAddress: state.ethAddress,
    vaultAddr: accountAddr,
    opMeta: {
      operation: 'Send USDC from smart account',
      from: stellarAddrToEvm20(accountAddr),
      to: stellarAddrToEvm20(recipient),
      amount: amountStroops,
    },
    nonce, validUntilLedger,
    invocation: vaultEntry.rootInvocation(),
    contextRuleIds: [0],
  });

  const signerScVal = externalSignerScVal(VERIFIER, pubkeyBytes);
  credentials.signature(authPayloadScVal([{ signer: signerScVal, sig: sigData }], [0]));

  log('stellar', 're-simulating with EIP-712 AuthPayload attached');
  const tx2 = await buildInvokeTx({
    sourceG: SHARED_SOURCE_G, contract: USDC_SAC, fn: 'transfer', args: transferArgs,
    auth: [vaultEntry],
  });
  const sim2 = await server.simulateTransaction(tx2);
  if (rpc.Api.isSimulationError(sim2)) {
    if (sim2.error?.includes('#10') || sim2.error?.toLowerCase().includes('insufficient balance')) {
      throw new Error(`sim-with-auth: insufficient USDC balance in account (#10) — top up first`);
    }
    throw new Error(`sim-with-auth: ${sim2.error}`);
  }
  log('stellar', `re-sim ok — minResourceFee=${sim2.minResourceFee} stroops`);

  const assembled = rpc.assembleTransaction(tx2, sim2).build();
  const channelsTxHash = await signAndSubmit(assembled.toXDR());
  const result = await pollForTx(channelsTxHash);
  if (!result?.successful) throw new Error(`tx failed; hash=${channelsTxHash}`);
  log('ok', `Sent ${amountUsdc} USDC → ${recipient.slice(0,6)}…${recipient.slice(-4)}`);

  await refreshAccountBalance();
}

log('ui', 'ready — click Connect MetaMask to start');
