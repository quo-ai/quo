import { useEffect, useRef } from 'react';
import { Crown, Lock, X } from 'lucide-react';
import type { Account } from '../cloud/account';
import type { CloudCatalog } from '../cloud/catalog';
import { everydayModels, frontierModels, proExamples } from '../cloud/pro';
import { PRICES, TRIAL } from '../cloud/prices';
import { ProPerks } from './ProPerks';

interface ProSheetProps {
  catalog: CloudCatalog | null;
  account: Account | null;
  onClose: () => void;
  /** Sign in, or choose a plan: the account sheet. */
  onContinue: () => void;
}

/**
 * What Quo Pro is, for someone deciding: which models it unlocks, how far a
 * month of credits goes on them, what it costs. Opened from the sidebar, the
 * picker and the first screen, whether or not the person has an account.
 */
export function ProSheet({ catalog, account, onClose, onContinue }: ProSheetProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const frontier = frontierModels(catalog);
  const everyday = everydayModels(catalog);
  const examples = proExamples(catalog);
  const signedIn = Boolean(account?.user);

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
      <div className="sheet glass thick pro-sheet" role="dialog" aria-modal="true" aria-labelledby="pro-title" tabIndex={-1} ref={sheet}>
        <div className="sheet-head">
          <h2 id="pro-title"><Crown size={19} /> Quo Pro</h2>
          <button className="icon-btn round press" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        <div className="sheet-body">
          <p className="auth-lede">The smartest AI models, whenever you want them. Your offline models stay free and private either way.</p>

          {frontier.length > 0 && (
            <section className="pro-section">
              <h3>Frontier models</h3>
              <div className="chips">
                {frontier.map(model => <span key={model.id} className="chip"><Lock size={11} /> {model.name}</span>)}
              </div>
              {everyday.length > 0 && <p className="note">Plus {everyday.length} fast, low-cost models, such as {everyday[0].name}.</p>}
            </section>
          )}

          <section className="pro-section">
            <h3>What’s included</h3>
            <ProPerks />
          </section>

          {examples.length > 0 && (
            <section className="pro-section">
              <h3>How far a month goes</h3>
              <div className="pro-rows">
                {examples.map(({ model, messages }) => (
                  <div key={model.id} className="pro-row"><span>{model.name}</span><strong>about {messages.toLocaleString()} messages</strong></div>
                ))}
              </div>
              <p className="note">Typical short messages. Long chats and long replies use more, and the picker always shows what each model costs.</p>
            </section>
          )}

          <section className="pro-section">
            <h3>Prices</h3>
            <div className="pro-rows">
              <div className="pro-row"><span>Quo Pro, monthly</span><strong>{PRICES.proMonthly}</strong></div>
              <div className="pro-row"><span>Quo Pro, yearly</span><strong>{PRICES.proYearly}</strong></div>
              <div className="pro-row"><span>Credit packs, no subscription</span><strong>from {PRICES.smallestPack}</strong></div>
            </div>
            <p className="note">New accounts start with {TRIAL.credits} free credits, good for {TRIAL.days} days. Pack credits last 12 months.</p>
          </section>

        </div>
        <div className="sheet-foot">
          {account && !account.features.accounts && (
            <p className="sandbox-note">Accounts and purchases aren’t switched on yet, so Quo Pro can’t be bought just now. It will be soon.</p>
          )}
          {!account && <p className="sandbox-note">Can’t reach Quo right now. Check your connection and try again.</p>}

          <div className="plan-actions pro-actions">
            <button className="btn btn-primary press" onClick={onContinue}>{signedIn ? 'Choose a plan' : 'Sign in to get started'}</button>
            <button className="btn btn-ghost press" onClick={onClose}>Not now</button>
          </div>
        </div>
      </div>
    </div>
  );
}
