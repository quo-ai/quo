import type { ReactNode } from 'react';
import { AlertCircle, HardDrive, KeyRound, RotateCcw } from 'lucide-react';
import type { ChatAction, Failure } from './types';

/** A failed turn with the next sensible step, never a dead end. */
export function FailureCard({ failure, offlineReady, signedIn, onAction, onRetry }: {
  failure: Failure;
  offlineReady: boolean;
  signedIn: boolean;
  onAction: (action: ChatAction) => void;
  onRetry: () => void;
}) {
  const offline = offlineReady && <button className="btn btn-soft press" onClick={() => onAction('use-offline')}><HardDrive size={15} /> Use offline model</button>;
  let title = failure.message;
  let actions: ReactNode;
  switch (failure.code) {
    case 'free_limit':
      title = 'You’ve used today’s free cloud messages.';
      actions = <>{offline}<button className="btn btn-primary press" onClick={() => onAction(signedIn ? 'get-pro' : 'sign-in')}>{signedIn ? 'Get Pro' : 'Sign in for more'}</button></>;
      break;
    case 'insufficient_credits':
      actions = <><button className="btn btn-primary press" onClick={() => onAction('top-up')}>Get credits</button><button className="btn btn-soft press" onClick={() => onAction('use-free')}>Use the free model</button>{offline}</>;
      break;
    case 'setup_required':
      // Not an error in the app: this part of Quo isn't configured yet.
      actions = <><button className="btn btn-primary press" onClick={() => onAction('use-free')}>Use the free model</button>{offline}</>;
      break;
    case 'sign_in_required':
      actions = <><button className="btn btn-primary press" onClick={() => onAction('sign-in')}>Sign in</button><button className="btn btn-soft press" onClick={() => onAction('use-free')}>Use the free model</button></>;
      break;
    case 'provider_auth':
    case 'provider_no_key':
    case 'provider_credit':
    case 'provider_model':
      // The user's own key or account: the fix is in Your keys, not in Quo.
      actions = <><button className="btn btn-primary press" onClick={() => onAction('keys')}><KeyRound size={15} /> Open your keys</button>{offline}</>;
      break;
    case 'offline':
      title = offlineReady ? 'You’re offline. Your offline model can keep going.' : 'You’re offline. The offline model will be ready once it finishes downloading.';
      actions = <>{offline}<button className="btn btn-soft press" onClick={onRetry}><RotateCcw size={15} /> Try again</button></>;
      break;
    default:
      actions = <><button className="btn btn-soft press" onClick={onRetry}><RotateCcw size={15} /> Try again</button>{offline}</>;
  }
  return (
    <div className="failure glass thick" role="alert">
      <p><AlertCircle size={17} /> {title}</p>
      <div className="failure-actions">{actions}</div>
    </div>
  );
}
