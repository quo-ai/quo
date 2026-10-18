import { Check } from 'lucide-react';
import type { CloudModel } from '../cloud/catalog';
import { PRO_MONTHLY_CREDITS } from '../cloud/groups';

const sentence = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '');

/** What Quo Pro includes, in one place so every screen says the same thing. */
export function ProPerks({ frontier = [] }: { frontier?: CloudModel[] }) {
  return (
    <ul className="perks">
      <li><Check size={15} /> {frontier.length > 0
        ? `${frontier.length} frontier models, like ${sentence(frontier.slice(0, 3).map(model => model.name))}`
        : 'Claude, GPT, Gemini, Grok and the best open models'}</li>
      <li><Check size={15} /> {PRO_MONTHLY_CREDITS.toLocaleString()} credits every month</li>
      <li><Check size={15} /> Quo Sync included, for your chats and memories on all your devices</li>
      <li><Check size={15} /> Offline models stay free, unlimited and private</li>
    </ul>
  );
}
