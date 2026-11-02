import { useEffect, useState } from 'react';
import { Check, Copy, Gift } from 'lucide-react';
import { loadInvite, type Invite } from '../cloud/invite';

/** "Invite friends" in Plan & credits: the person's link, what it gives, and how many friends have earned them credits. */
export function InviteFriends() {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    loadInvite().then(value => live && setInvite(value), () => {});
    return () => {
      live = false;
    };
  }, []);

  if (!invite) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused: the link is on screen to select.
    }
  };

  return (
    <div className="plan-card invite">
      <div className="plan-head"><Gift size={18} /> <strong>Invite friends</strong></div>
      <p>A friend who signs up with your link gets {invite.forFriend} extra credits. When they first buy credits or a plan, you get {invite.forYou}, for up to {invite.max} friends.</p>
      <div className="invite-link">
        <code>{invite.link}</code>
        <button type="button" className="btn btn-glass press" onClick={() => void copy()}>
          {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy link</>}
        </button>
      </div>
      {invite.rewarded > 0 && <p className="note">{invite.rewarded} of {invite.max} friends have earned you credits.</p>}
    </div>
  );
}
