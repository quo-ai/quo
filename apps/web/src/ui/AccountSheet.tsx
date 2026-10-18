import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Coins, Crown, LogOut, Mail, Sparkles, X } from 'lucide-react';
import {
  ApiError, checkout, deleteAccount, openBillingPortal, signOut, signOutEverywhere, startSignIn, verifySignIn, type Account, type ProductId,
} from '../cloud/account';
import { PRICES } from '../cloud/prices';
import { disableSync } from '../sync';
import { toast } from './Toasts';

interface AccountSheetProps {
  account: Account | null;
  onClose: () => void;
}

const PACKS: { id: ProductId; credits: string; price: string; note?: string }[] = [
  { id: 'pack_1000', credits: '1,000', price: '$12' },
  { id: 'pack_2750', credits: '2,750', price: '$30', note: 'Save 9%' },
  { id: 'pack_6000', credits: '6,000', price: '$60', note: 'Save 17%' },
];

/** Sign in, plan, credits and purchases. */
export function AccountSheet({ account, onClose }: AccountSheetProps) {
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sheet.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const signedIn = Boolean(account?.user);

  return (
    <div className="scrim" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sheet glass thick" role="dialog" aria-modal="true" aria-labelledby="account-title" tabIndex={-1} ref={sheet}>
        <div className="sheet-head">
          <h2 id="account-title">{signedIn ? 'Plan & credits' : 'Sign in to Quo'}</h2>
          <button className="icon-btn round press" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        <div className="sheet-body">
          {signedIn && account ? <SignedIn account={account} onClose={onClose} /> : <SignIn />}
        </div>
      </div>
    </div>
  );
}

function SignIn() {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await startSignIn(email);
      setDevCode(result.devCode ?? null);
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t send the code. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(value = code) {
    if (value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await verifySignIn(email, value);
      toast('Signed in');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t sign in. Try again.');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'code') {
    return (
      <form className="auth" onSubmit={event => { event.preventDefault(); void verify(); }}>
        <button type="button" className="btn btn-ghost press back" onClick={() => setStep('email')}><ArrowLeft size={15} /> {email}</button>
        <p className="auth-lede">Enter the 6-digit code we sent to your email.</p>
        <input
          className="field code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          value={code}
          aria-label="Sign-in code"
          onChange={event => {
            const value = event.target.value.replace(/\D/g, '').slice(0, 6);
            setCode(value);
            if (value.length === 6) void verify(value);
          }}
        />
        {devCode && <p className="note">Sandbox: no email is sent. Your code is <strong>{devCode}</strong>.</p>}
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-block btn-lg press" disabled={busy || code.length !== 6}>Sign in</button>
        <button type="button" className="btn-link resend" onClick={() => void sendCode()} disabled={busy}>Send a new code</button>
      </form>
    );
  }

  return (
    <form className="auth" onSubmit={sendCode}>
      <p className="auth-lede">Sign in to use premium cloud models and get more free messages. New accounts get <strong>25 free credits</strong>.</p>
      <label className="field-wrap">
        <Mail size={17} />
        <input className="field" type="email" required autoFocus autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} aria-label="Email" />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary btn-block btn-lg press" disabled={busy || !email}>{busy ? 'Sending…' : 'Email me a code'}</button>
      <p className="note">No password needed. Offline models never need an account.</p>
    </form>
  );
}

function SignedIn({ account, onClose }: { account: Account; onClose: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const pro = account.plan === 'pro';

  async function buy(product: ProductId) {
    setBusy(product);
    try {
      await checkout(product);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Checkout isn’t available right now.');
      setBusy(null);
    }
  }

  async function revokeOthers() {
    setBusy('revoke');
    try {
      await signOutEverywhere();
      toast('Signed out of your other devices.');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Couldn’t do that. Try again.');
    } finally {
      setBusy(null);
    }
  }

  async function removeAccount() {
    setBusy('delete');
    try {
      await deleteAccount();
      await disableSync();
      toast('Your account was deleted.');
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Couldn’t delete your account. Try again.');
      setBusy(null);
    }
  }

  async function manage() {
    setBusy('portal');
    try {
      const message = await openBillingPortal();
      if (message) toast(message);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Couldn’t open subscription settings.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="account">
      <div className="balance">
        <div>
          <div className="balance-label"><Coins size={15} /> Credits</div>
          <div className="balance-value">{Math.floor(account.credits ?? 0).toLocaleString()}</div>
        </div>
        <div className="balance-side">
          {pro ? <span className="badge"><Crown size={12} /> Pro</span> : <span className="badge green">Free plan</span>}
          <span className="note">{account.free.remaining} of {account.free.limit} free messages left today</span>
        </div>
      </div>

      {!account.billing.live && <p className="sandbox-note">Sandbox: purchases are simulated, nothing is charged.</p>}

      {account.sync && !pro && (
        <div className="plan-card current">
          <div className="plan-head"><Check size={18} /> <strong>Quo Sync</strong></div>
          <p>Your chats stay in step on all your devices, end-to-end encrypted{account.subscription?.renewsAt ? ` · renews ${new Date(account.subscription.renewsAt).toLocaleDateString()}` : ''}.</p>
          <button className="btn btn-soft press" disabled={busy === 'portal'} onClick={() => void manage()}>Manage subscription</button>
        </div>
      )}

      {pro ? (
        <div className="plan-card current">
          <div className="plan-head"><Crown size={18} /> <strong>Quo Pro</strong></div>
          <p>1,000 credits every month for every cloud model{account.subscription?.renewsAt ? ` · renews ${new Date(account.subscription.renewsAt).toLocaleDateString()}` : ''}.</p>
          <button className="btn btn-soft press" disabled={busy === 'portal'} onClick={() => void manage()}>Manage subscription</button>
        </div>
      ) : (
        <div className="plan-card">
          <div className="plan-head"><Sparkles size={18} /> <strong>Quo Pro</strong></div>
          <ul className="perks">
            <li><Check size={15} /> 1,000 credits every month</li>
            <li><Check size={15} /> Claude, GPT, Gemini and top open models</li>
            <li><Check size={15} /> Quo Sync included, to keep your chats on all your devices</li>
            <li><Check size={15} /> Offline models stay free and unlimited</li>
          </ul>
          <div className="plan-actions">
            <button className="btn btn-primary press" disabled={Boolean(busy)} onClick={() => void buy('pro_monthly')}>{PRICES.proMonthly}</button>
            <button className="btn btn-soft press" disabled={Boolean(busy)} onClick={() => void buy('pro_yearly')}>{PRICES.proYearly} <span className="save">Save 31%</span></button>
          </div>
        </div>
      )}

      <div className="sheet-section-title">Top up credits</div>
      <div className="packs">
        {PACKS.map(pack => (
          <button key={pack.id} className="pack press" disabled={Boolean(busy)} onClick={() => void buy(pack.id)}>
            <strong>{pack.credits}</strong>
            <span>credits</span>
            <em>{pack.price}</em>
            {pack.note && <small>{pack.note}</small>}
          </button>
        ))}
      </div>
      <p className="note">Credits from packs last 12 months. Monthly Pro credits reset each month.</p>

      <div className="account-foot">
        <span className="note">{account.user?.email}</span>
        <button className="btn btn-ghost press" onClick={() => void signOut().then(onClose)}><LogOut size={15} /> Sign out</button>
      </div>

      <div className="danger-zone">
        <div className="danger-row">
          <button className="btn-link muted" disabled={busy === 'revoke'} onClick={() => void revokeOthers()}>Sign out of all other devices</button>
          <span className="note">Lost a phone or left yourself signed in somewhere? This ends those sign-ins. You stay signed in here.</span>
        </div>
        {confirmDelete
          ? (
            <>
              <p className="note">This deletes your account for good: your synced chats and memories in the cloud, your credits and your plan records. Chats on your devices stay. If you have a plan, cancel it first.</p>
              <div className="plan-actions">
                <button className="btn btn-primary press" style={{ background: 'var(--error)' }} disabled={busy === 'delete'} onClick={() => void removeAccount()}>{busy === 'delete' ? 'Deleting…' : 'Yes, delete my account'}</button>
                <button className="btn btn-ghost press" disabled={busy === 'delete'} onClick={() => setConfirmDelete(false)}>Cancel</button>
              </div>
            </>
          )
          : <button className="btn-link" onClick={() => setConfirmDelete(true)}>Delete my account…</button>}
      </div>
    </div>
  );
}
