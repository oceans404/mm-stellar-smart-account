'use client';

import '@/lib/polyfills';
import { useEffect, useRef, useState } from 'react';
import { Address, rpc } from '@stellar/stellar-sdk';

import { log, subscribeToLogs, type LogEntry } from '@/lib/log';
import {
  ensureConnected,
  getChainId,
  onAccountsChanged,
  bindPubkey,
  getCachedAccount,
  setCachedAccount,
} from '@/lib/metamask';
import {
  extractDeployedContractAddress,
  pollForTx,
  server,
  simulateAndAssemble,
} from '@/lib/stellar';
import {
  USDC_SAC,
  buildInvokeTx,
  getCurrentLedger,
  readUsdcBalance,
  stroopsToUsdc,
  usdcToStroops,
  usdcTransferArgs,
} from '@/lib/smart-account';
import {
  SHARED_SOURCE_G,
  VERIFIER,
  buildEthVaultDeployTx,
} from '@/lib/eth-vault';
import { authPayloadScVal } from '@/lib/auth-payload';
import {
  externalSignerScVal,
  signEip712Auth,
  stellarAddrToEvm20,
} from '@/lib/eip712';
import { fetchServiceInfo, signAndSubmit } from '@/lib/channels';

const C_STRKEY = /^C[A-Z2-7]{55}$/;
const G_STRKEY = /^G[A-Z2-7]{55}$/;

type Toast = { msg: string; kind?: 'ok' | 'err' } | null;

export default function Page() {
  const [ethAddress, setEthAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [accountAddr, setAccountAddr] = useState<string | null>(null);
  const [balanceStroops, setBalanceStroops] = useState<bigint | null>(null);
  const [accountInput, setAccountInput] = useState('');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('0.1');
  const [sendValidation, setSendValidation] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [copiedAccount, setCopiedAccount] = useState(false);
  const [copiedReceive, setCopiedReceive] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  // Log subscription
  useEffect(() => {
    return subscribeToLogs((entry) =>
      setLogs((prev) => [...prev.slice(-499), entry]),
    );
  }, []);

  // Auto-scroll log panel
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(id);
  }, [toast]);

  // Relayer sanity check on mount
  useEffect(() => {
    fetchServiceInfo()
      .then((info) => {
        if (info.serviceConfigured && info.channelsConfigured) {
          log('relayer', `relayer ready — service G ${info.servicePublic}`);
        } else {
          log('err', `relayer misconfigured: ${JSON.stringify(info)}`);
        }
      })
      .catch((e) => log('err', `relayer probe failed: ${e.message}`));
    log('ui', 'ready — click Connect MetaMask to start');
  }, []);

  // accountsChanged sync
  useEffect(() => {
    onAccountsChanged((accounts) => {
      if (!accounts || accounts.length === 0) {
        log('mm', 'wallet disconnected (no accounts)');
        setEthAddress(null);
        setChainId(null);
        setAccountAddr(null);
        setBalanceStroops(null);
        return;
      }
      log('mm', `accountsChanged: ${accounts[0]}`);
      setEthAddress(accounts[0]);
      const cached = getCachedAccount(accounts[0]);
      if (cached && C_STRKEY.test(cached)) {
        setAccountAddr(cached);
      } else {
        setAccountAddr(null);
        setBalanceStroops(null);
      }
    });
  }, []);

  // Auto-refresh balance when account is set or ethAddress changes
  useEffect(() => {
    if (!accountAddr) {
      setBalanceStroops(null);
      return;
    }
    refreshBalance();
  }, [accountAddr]);

  async function refreshBalance() {
    if (!accountAddr) return;
    try {
      const stroops = (await readUsdcBalance(accountAddr, SHARED_SOURCE_G)) as bigint;
      setBalanceStroops(stroops);
    } catch (e) {
      log('err', `read balance: ${(e as Error).message}`);
    }
  }

  async function handleConnect() {
    setIsConnecting(true);
    try {
      log('ui', 'connecting to MetaMask');
      const addr = await ensureConnected();
      setEthAddress(addr);
      const cid = await getChainId();
      setChainId(cid);
      log('ui', `connected: ${addr} (chain ${cid})`);
      const cached = getCachedAccount(addr);
      if (cached && C_STRKEY.test(cached)) {
        log('ui', `restoring cached account: ${cached}`);
        setAccountAddr(cached);
      }
      setToast({ msg: `Connected: ${addr.slice(0, 6)}…${addr.slice(-4)}`, kind: 'ok' });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      log('err', msg);
      setToast({ msg: `Connect failed: ${msg.slice(0, 80)}`, kind: 'err' });
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleCreate() {
    if (!ethAddress) return;
    setIsCreating(true);
    try {
      log('ui', 'creating eth-vault smart account');
      const pubkeyBytes = await bindPubkey(ethAddress);
      log(
        'stellar',
        `admin will be External(${VERIFIER.slice(0, 8)}…, ${pubkeyBytes.length}b pubkey)`,
      );
      const tx = await buildEthVaultDeployTx(SHARED_SOURCE_G, VERIFIER, pubkeyBytes);
      const { assembled } = await simulateAndAssemble(tx, 'eth-vault createCustomContract');
      const innerXdr = assembled.toXDR();
      const channelsTxHash = await signAndSubmit(innerXdr);
      const result = await pollForTx(channelsTxHash);
      if (!result?.successful) throw new Error(`tx failed; hash=${channelsTxHash}`);
      const retval = extractDeployedContractAddress(result.resultMetaXdr);
      const newAddr = Address.fromScVal(retval).toString();
      setAccountAddr(newAddr);
      setCachedAccount(ethAddress, newAddr);
      log('stellar', `eth-vault deployed — ${newAddr}`);
      log(
        'stellar',
        `stellar.expert: https://stellar.expert/explorer/testnet/contract/${newAddr}`,
      );
      setToast({
        msg: `Account created: ${newAddr.slice(0, 6)}…${newAddr.slice(-4)}`,
        kind: 'ok',
      });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      log('err', msg);
      setToast({ msg: `Create failed: ${msg.slice(0, 80)}`, kind: 'err' });
    } finally {
      setIsCreating(false);
    }
  }

  function handleSetAccount() {
    const v = accountInput.trim();
    if (!C_STRKEY.test(v)) {
      log('err', `not a valid Soroban contract strkey: ${v.slice(0, 40)}${v.length > 40 ? '…' : ''}`);
      return;
    }
    setAccountAddr(v);
    if (ethAddress) setCachedAccount(ethAddress, v);
    log('ui', `account set to ${v}`);
  }

  // Single consistent shape so TS doesn't need discriminated-union narrowing.
  function validateSend(): { ok: boolean; msg: string; recipient: string; amount: number } {
    if (!recipient) return { ok: false, msg: 'recipient required', recipient: '', amount: 0 };
    if (!G_STRKEY.test(recipient) && !C_STRKEY.test(recipient)) {
      return { ok: false, msg: 'recipient must be a G… or C… address (56 chars)', recipient: '', amount: 0 };
    }
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, msg: 'amount must be > 0', recipient: '', amount: 0 };
    }
    return { ok: true, msg: '', recipient: recipient.trim(), amount: n };
  }

  useEffect(() => {
    const v = validateSend();
    setSendValidation(v.ok ? '' : v.msg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipient, amount]);

  async function handleSend() {
    if (!ethAddress || !accountAddr) return;
    const v = validateSend();
    if (!v.ok) {
      log('err', `send form: ${v.msg}`);
      setSendValidation(v.msg);
      return;
    }
    setIsSending(true);
    try {
      await sendFlow(accountAddr, v.recipient, v.amount);
      setToast({
        msg: `Sent ${v.amount} USDC → ${v.recipient.slice(0, 6)}…${v.recipient.slice(-4)}`,
        kind: 'ok',
      });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      log('err', msg);
      setToast({ msg: `Send failed: ${msg.slice(0, 80)}`, kind: 'err' });
    } finally {
      setIsSending(false);
    }
  }

  async function sendFlow(account: string, recipient: string, amountUsdc: number) {
    if (!ethAddress) throw new Error('no eth address');
    const amountStroops = usdcToStroops(amountUsdc);
    log('ui', `sending ${amountUsdc} USDC: ${account.slice(0, 6)}… → ${recipient.slice(0, 6)}…`);
    const pubkeyBytes = await bindPubkey(ethAddress);
    const transferArgs = usdcTransferArgs({ from: account, to: recipient, amountStroops });
    const tx = await buildInvokeTx({
      sourceG: SHARED_SOURCE_G,
      contract: USDC_SAC,
      fn: 'transfer',
      args: transferArgs,
    });

    log('stellar', 'simulating send (admin-authorized via External(verifier, pubkey))');
    const sim1 = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim1)) throw new Error(`sim-base: ${sim1.error}`);
    const authEntries = (sim1 as any).result?.auth ?? [];
    if (authEntries.length !== 1)
      throw new Error(`expected 1 auth entry, got ${authEntries.length}`);
    const vaultEntry = authEntries[0];
    const credAddr = Address.fromScAddress(
      vaultEntry.credentials().address().address(),
    ).toString();
    if (credAddr !== account)
      throw new Error(`auth entry credentials.address=${credAddr}, expected account ${account}`);

    const currentLedger = await getCurrentLedger();
    const validUntilLedger = currentLedger + 720;
    const credentials = vaultEntry.credentials().address();
    credentials.signatureExpirationLedger(validUntilLedger);
    const nonce = credentials.nonce();

    log('mm', 'requesting EIP-712 signature (signTypedData_v4)…');
    const sigData = await signEip712Auth({
      ethAddress,
      vaultAddr: account,
      opMeta: {
        operation: 'Send USDC from smart account',
        from: stellarAddrToEvm20(account),
        to: stellarAddrToEvm20(recipient),
        amount: amountStroops,
      },
      nonce,
      validUntilLedger,
      invocation: vaultEntry.rootInvocation(),
      contextRuleIds: [0],
    });

    const signerScVal = externalSignerScVal(VERIFIER, pubkeyBytes);
    credentials.signature(authPayloadScVal([{ signer: signerScVal, sig: sigData }], [0]));

    log('stellar', 're-simulating with EIP-712 AuthPayload attached');
    const tx2 = await buildInvokeTx({
      sourceG: SHARED_SOURCE_G,
      contract: USDC_SAC,
      fn: 'transfer',
      args: transferArgs,
      auth: [vaultEntry],
    });
    const sim2 = await server.simulateTransaction(tx2);
    if (rpc.Api.isSimulationError(sim2)) {
      const err = sim2.error ?? '';
      if (err.includes('#10') || err.toLowerCase().includes('insufficient balance')) {
        throw new Error('sim-with-auth: insufficient USDC balance in account (#10) — top up first');
      }
      throw new Error(`sim-with-auth: ${err}`);
    }
    log('stellar', `re-sim ok — minResourceFee=${(sim2 as any).minResourceFee} stroops`);

    const assembled = rpc.assembleTransaction(tx2, sim2 as any).build();
    const channelsTxHash = await signAndSubmit(assembled.toXDR());
    const result = await pollForTx(channelsTxHash);
    if (!result?.successful) throw new Error(`tx failed; hash=${channelsTxHash}`);
    log('ok', `Sent ${amountUsdc} USDC → ${recipient.slice(0, 6)}…${recipient.slice(-4)}`);
    await refreshBalance();
  }

  async function copy(text: string, which: 'account' | 'receive') {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'account') {
        setCopiedAccount(true);
        setTimeout(() => setCopiedAccount(false), 1200);
      } else {
        setCopiedReceive(true);
        setTimeout(() => setCopiedReceive(false), 1200);
      }
      log('ui', `copied ${text} to clipboard`);
    } catch (e) {
      log('err', `clipboard write failed: ${(e as Error).message}`);
    }
  }

  const isTestnet = chainId !== null;

  return (
    <main>
      <h1>usdc-mm — MetaMask smart account on Stellar</h1>
      <p className="sub">
        Three verbs: Create your account, Receive USDC, Send USDC. Admin authority lives on your Ethereum
        key (via MetaMask); a shared service Stellar key pays the envelope fees. Channels covers
        post-deploy XLM.
      </p>

      <h2>1. Connect</h2>
      <div className="row">
        <button onClick={handleConnect} disabled={isConnecting}>
          {isConnecting ? 'Connecting…' : 'Connect MetaMask'}
        </button>
        <span className="label">Your wallet (MetaMask):</span>
        <code className={`codebox${ethAddress ? ' set' : ''}`}>
          {ethAddress ?? 'not connected'}
        </code>
        <span className="badge">{chainId ? `chain: ${chainId}` : 'chain: —'}</span>
      </div>

      <h2>2. Create your smart account</h2>
      <p className="sub" style={{ margin: '-.25rem 0 .5rem' }}>
        First click triggers a one-time MetaMask <code>personal_sign</code> to bind your public key.
        Then the relayer signs the Stellar envelope as the shared service account and submits via
        Channels. Resource fee ~0.012 XLM, paid by the service. Per-user cost: zero.
      </p>
      <div className="row">
        <button
          className="secondary"
          onClick={handleCreate}
          disabled={!ethAddress || isCreating}
        >
          {isCreating ? 'Creating…' : 'Create Account'}
        </button>
      </div>
      <div className="row">
        <span className="label">Your smart account:</span>
        <code className={`codebox${accountAddr ? ' set' : ''}`}>
          {accountAddr ?? 'no account yet'}
        </code>
        <button
          className="secondary"
          onClick={() => accountAddr && copy(accountAddr, 'account')}
          disabled={!accountAddr}
        >
          {copiedAccount ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="row">
        <span className="label">Or restore existing:</span>
        <input
          type="text"
          placeholder="C… (paste a previously-created account)"
          style={{ width: '26rem' }}
          value={accountInput}
          onChange={(e) => setAccountInput(e.target.value)}
        />
        <button className="secondary" onClick={handleSetAccount} disabled={!ethAddress}>
          Set
        </button>
      </div>

      <h2>3. Receive USDC</h2>
      <p className="sub" style={{ margin: '-.25rem 0 .5rem' }}>
        Share this address to receive USDC. Anyone, including another smart account (C-address) or
        a classic Stellar wallet (G-address via USDC SAC), can send USDC here.
      </p>
      <div className="row">
        <span className="label">Receive address:</span>
        <code className={`codebox${accountAddr ? ' set' : ''}`}>
          {accountAddr ?? 'create or restore an account first'}
        </code>
        <button
          className="secondary"
          onClick={() => accountAddr && copy(accountAddr, 'receive')}
          disabled={!accountAddr}
        >
          {copiedReceive ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="row">
        <span className="label">Balance:</span>
        <span className="badge">
          {balanceStroops == null ? '—' : `${stroopsToUsdc(balanceStroops).toFixed(7)} USDC`}
        </span>
        <button className="secondary" onClick={refreshBalance} disabled={!accountAddr}>
          ↻ Refresh
        </button>
      </div>

      <h2>4. Send USDC</h2>
      <p className="sub" style={{ margin: '-.25rem 0 .5rem' }}>
        Transfers USDC out of your smart account to any recipient. One MetaMask popup (EIP-712 typed
        data with labeled fields); the relayer signs the Stellar envelope and Channels covers XLM.
      </p>
      <div className="row" style={{ gap: '1rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flex: 1 }}>
          <span style={{ fontSize: '.8rem', color: '#6b7280' }}>Recipient (G… or C…)</span>
          <input
            type="text"
            placeholder="G… or C…"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
          <span style={{ fontSize: '.8rem', color: '#6b7280' }}>Amount (USDC)</span>
          <input
            type="number"
            min="0.0000001"
            step="0.0000001"
            style={{ width: '9rem' }}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
      </div>
      <div className="row">
        <button
          onClick={handleSend}
          disabled={!ethAddress || !accountAddr || isSending}
        >
          {isSending ? 'Sending…' : 'Send'}
        </button>
        <span style={{ fontSize: '.85rem', color: '#991b1b' }}>{sendValidation}</span>
      </div>

      <pre ref={logRef} className="log">
        {logs.map((e) => (
          <span key={e.id} className={`log-line tag-${e.tag}`}>
            <span>[{e.tag}]</span> {e.msg}
          </span>
        ))}
      </pre>

      {toast && <div className={`toast${toast.kind === 'err' ? ' err' : ''}`}>{toast.msg}</div>}
    </main>
  );
}
