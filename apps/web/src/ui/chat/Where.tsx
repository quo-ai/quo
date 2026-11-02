import { Cloud, KeyRound, Laptop, Smartphone } from 'lucide-react';
import type { Message } from '../../chat/types';
import { readableModel } from '../../chat/modelName';
import { reliabilityNote } from '../../chat/reliability';
import { automatic } from '../../theme';

/**
 * Where a reply was written: on this device, in the cloud through Quo, or with the person's own key. Shown under every
 * reply, and as a note in the chat wherever it moves from one to another, so it is never a surprise where words went.
 */
export type Where = 'device' | 'cloud' | 'own';
export const whereOf = (message: Message): Where => (message.cloud ? 'cloud' : message.own ? 'own' : 'device');

/** The device's own icon: a phone on a phone, a computer elsewhere. */
export function DeviceIcon({ size = 14 }: { size?: number }) {
  return automatic().phone ? <Smartphone size={size} aria-hidden="true" /> : <Laptop size={size} aria-hidden="true" />;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const formatTokens = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** The facts under a reply, each its own item (the model and where it ran are shown beside them). */
export function replyFacts(message: Message): string[] {
  if (message.stopped) return ['Stopped'];
  const steps = message.steps?.length ? plural(message.steps.length, 'step') : '';
  if (message.own) {
    // The exact model is in the name beside these facts (and its id in the tooltip), not repeated here.
    const tokens = message.usage ? `${formatTokens(message.usage.input + message.usage.output)} tokens` : '';
    return [steps, tokens].filter(Boolean);
  }
  if (message.cloud) return [steps, message.charged ? plural(message.charged, 'credit') : 'Free'].filter(Boolean);
  const speed = !steps && message.stats && message.stats.tokens > 1 ? `${message.stats.tokensPerSecond.toFixed(1)} tokens/s` : '';
  return [steps, speed, reliabilityNote(message.modelId) ?? ''].filter(Boolean);
}

/** The model's name, once: the exact model that answered when the provider said and it reads as a name, else the one chosen. */
const nameOf = (message: Message) => readableModel(message.served) ?? message.modelName ?? (message.cloud ? 'Cloud model' : message.own ? message.own : 'Offline model');
/** The exact id, for the tooltip, when it isn't already the name shown. */
const idOf = (message: Message) => (message.served && message.served !== nameOf(message) ? message.served : null);

/** The model and where it ran, then the facts: under each finished reply. */
export function ReplyWhere({ message }: { message: Message }) {
  const where = whereOf(message);
  const id = idOf(message);
  const model = id ? `${nameOf(message)} (${id})` : nameOf(message);
  const label = where === 'device' ? `Written on this device by ${model}` : where === 'cloud' ? `Written in the cloud by ${model}` : `Written by ${model} with your ${message.own} key`;
  return (
    <>
      <span className="msg-where" data-where={where} title={label}>
        {where === 'device' ? <DeviceIcon /> : where === 'cloud' ? <Cloud size={14} aria-hidden="true" /> : <KeyRound size={14} aria-hidden="true" />}
        <span className="vh">{label}</span><span aria-hidden="true">{nameOf(message)}</span>
      </span>
      {replyFacts(message).map(fact => <span key={fact} className="msg-meta">{fact}</span>)}
    </>
  );
}

export interface Move { to: Where; name: string; provider?: string }

/**
 * Where a chat moved: between this device, the cloud, and a provider reached with the person's own key. Each move is
 * keyed by the person's message that was the first sent to the new place, so the note sits just before it. Changing
 * between two cloud models is not a move: both go through Quo.
 */
export function moves(messages: Message[]): Map<string, Move> {
  const found = new Map<string, Move>();
  let last: string | null = null;
  let asked: Message | null = null;
  for (const message of messages) {
    if (message.role === 'user') {
      asked = message;
      continue;
    }
    if (message.summary) continue;
    const where = whereOf(message);
    const place = where === 'own' ? `own:${message.own}` : where;
    if (last !== null && place !== last && asked) found.set(asked.id, { to: where, name: nameOf(message), provider: message.own });
    last = place;
  }
  return found;
}

/** The note where a chat moved: who answers from here, and where the words go. */
export function ModelChange({ move }: { move: Move }) {
  if (move.to === 'device') {
    return <div className="change" data-to="device" role="note"><DeviceIcon size={16} /><p><b>Back on this device.</b> {move.name} answers here, and nothing more leaves it.</p></div>;
  }
  if (move.to === 'own') {
    return <div className="change" data-to="cloud" role="note"><KeyRound size={16} aria-hidden="true" /><p><b>{move.name} from here.</b> Messages go straight to {move.provider} with your key, not through Quo.</p></div>;
  }
  return <div className="change" data-to="cloud" role="note"><Cloud size={16} aria-hidden="true" /><p><b>{move.name} from here.</b> Messages from this point go to the cloud to be answered. Quo doesn’t keep them.</p></div>;
}
