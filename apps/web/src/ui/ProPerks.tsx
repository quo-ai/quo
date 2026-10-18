import { Check } from 'lucide-react';
import { PRO_MONTHLY_CREDITS } from '../cloud/pro';

/** What Quo Pro includes, in one place so every screen says the same thing. */
export function ProPerks() {
  return (
    <ul className="perks">
      <li><Check size={15} /> {PRO_MONTHLY_CREDITS.toLocaleString()} credits every month</li>
      <li><Check size={15} /> Claude, GPT, Gemini, Grok and the best open models</li>
      <li><Check size={15} /> Quo Sync included, to keep your chats and memories on all your devices</li>
      <li><Check size={15} /> Offline models stay free, unlimited and private</li>
    </ul>
  );
}
