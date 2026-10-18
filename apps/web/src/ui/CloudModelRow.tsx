import { Check, Lock } from 'lucide-react';
import type { Account } from '../cloud/account';
import { lockOf } from '../cloud/access';
import { isNewModel, type CloudModel } from '../cloud/catalog';
import { describeCost } from './format';

interface CloudModelRowProps {
  model: CloudModel;
  account: Account | null;
  selected: boolean;
  onPick: () => void;
  /** Inside a menu (the picker) rather than a sheet: gives the row menu roles. */
  menu?: boolean;
}

/** One cloud model, with a lock if this person can't use it yet. Choosing it is App.choose's business. */
export function CloudModelRow({ model, account, selected, onPick, menu }: CloudModelRowProps) {
  const lock = lockOf(model, account);
  const cost = `${describeCost(model.creditsPerMessage, '≈')} per message`;
  const sub = model.free ? `Free · ${account ? `${account.free.remaining} left today` : 'every day'}` : cost;
  return (
    <button
      className={`menu-item press${lock ? ' locked' : ''}`}
      role={menu ? (lock ? 'menuitem' : 'menuitemradio') : undefined}
      aria-checked={menu && !lock ? selected : undefined}
      aria-label={lock ? `${model.name}, locked. ${model.provider}. ${cost}` : undefined}
      onClick={onPick}
    >
      <span className="grow">
        <span className="title">
          {model.name}
          {model.free && <span className="badge green">Free</span>}
          {isNewModel(model) && <span className="badge new">New</span>}
        </span>
        <span className="sub">{model.provider} · {sub}</span>
      </span>
      {lock ? <Lock className="lock" size={16} /> : selected && <Check className="check" size={18} />}
    </button>
  );
}
