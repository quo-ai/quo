import { useEffect, useRef } from 'react';
import { Check, Lock, X } from 'lucide-react';
import type { Account } from '../cloud/account';
import { lockOf } from '../cloud/access';
import type { CloudModel } from '../cloud/catalog';
import { PRICES, TRIAL } from '../cloud/prices';
import { describeCost } from './format';

interface PaywallSheetProps {
  model: CloudModel;
  account: Account | null;
  /** What chats run on now, so "keep using" says what that is. */
  currentName: string | null;
  onClose: () => void;
  /** Sign in / get credits: the account sheet. */
  onContinue: () => void;
}

/** What people see when they pick a model they can't use yet. */
export function PaywallSheet({ model, account, currentName, onClose, onContinue }: PaywallSheetProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const lock = lockOf(model, account);
  const credits = Math.floor(account?.credits ?? 0);

  useEffect(() => {
    sheet.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="scrim" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sheet glass thick paywall" role="dialog" aria-modal="true" aria-labelledby="paywall-title" tabIndex={-1} ref={sheet}>
        <div className="sheet-head">
          <h2 id="paywall-title">Unlock {model.name}</h2>
          <button className="icon-btn round press" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        <div className="sheet-body">
          <div className="paywall-model">
            <span className="paywall-lock"><Lock size={20} /></span>
            <div>
              <strong>{model.name}</strong>
              <span>{model.provider} · {model.tier === 'frontier' ? 'Frontier model' : 'Fast & affordable'}</span>
            </div>
          </div>
          <p className="paywall-about">{model.description}</p>
          <p className="note">
            A typical message costs {describeCost(model.creditsPerMessage)}.
            {lock === 'credits' && ` You have ${credits.toLocaleString()}.`}
          </p>

          <ul className="perks">
            {lock === 'sign_in' && <li><Check size={15} /> New accounts start with {TRIAL.credits} trial credits, good for {TRIAL.days} days</li>}
            <li><Check size={15} /> Claude, GPT, Gemini, Grok and the best open models, in one place</li>
            <li><Check size={15} /> Quo Pro: 1,000 credits every month, from {PRICES.proMonthly}</li>
            <li><Check size={15} /> Or buy credits once, from {PRICES.smallestPack}. They last 12 months</li>
            <li><Check size={15} /> Offline models stay free and unlimited</li>
          </ul>

          {account && !account.features.accounts && (
            <p className="sandbox-note">Accounts and purchases aren’t switched on yet, so paid models can’t be unlocked just now. They will be soon.</p>
          )}
          {!account && <p className="sandbox-note">Can’t reach Quo right now. Check your connection and try again.</p>}

          <div className="plan-actions">
            <button className="btn btn-primary press" onClick={onContinue}>{lock === 'sign_in' ? 'Sign in to unlock' : 'Get credits or Pro'}</button>
            <button className="btn btn-ghost press" onClick={onClose}>{currentName ? `Keep using ${currentName}` : 'Not now'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
