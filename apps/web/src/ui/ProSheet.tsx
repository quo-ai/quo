import { useEffect, useRef } from 'react';
import { Crown, X } from 'lucide-react';
import type { Account } from '../cloud/account';
import type { CloudCatalog } from '../cloud/catalog';
import { groupModels } from '../cloud/groups';
import { PRICES, TRIAL } from '../cloud/prices';
import { ProPerks } from './ProPerks';

interface ProSheetProps {
  catalog: CloudCatalog | null;
  account: Account | null;
  onClose: () => void;
  /** Sign in, or choose a plan: the account sheet. */
  onContinue: () => void;
}

/** What Quo Pro is and costs, for someone deciding. */
export function ProSheet({ catalog, account, onClose, onContinue }: ProSheetProps) {
  const sheet = useRef<HTMLDivElement>(null);
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
      <div className="sheet glass thick narrow" role="dialog" aria-modal="true" aria-labelledby="pro-title" tabIndex={-1} ref={sheet}>
        <div className="sheet-head">
          <h2 id="pro-title"><Crown size={19} /> Quo Pro</h2>
          <button className="icon-btn round press" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        <div className="sheet-body">
          <ProPerks frontier={groupModels(catalog).frontier} />
          <p className="pro-price"><strong>{PRICES.proMonthly}</strong> or <strong>{PRICES.proYearly}</strong></p>
          <p className="note">Or buy credits once, from {PRICES.smallestPack}. New accounts get {TRIAL.credits} free credits.</p>
          {account && !account.features.accounts && (
            <p className="sandbox-note">Accounts and purchases aren’t switched on yet. Quo Pro will be available soon.</p>
          )}
          {!account && <p className="sandbox-note">Can’t reach Quo right now. Check your connection and try again.</p>}
          <div className="plan-actions">
            <button className="btn btn-primary press" onClick={onContinue}>{signedIn ? 'Choose a plan' : 'Sign in to get started'}</button>
            <button className="btn btn-ghost press" onClick={onClose}>Not now</button>
          </div>
        </div>
      </div>
    </div>
  );
}
