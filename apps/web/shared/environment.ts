/**
 * What every model is told about the moment it is answering: today's date, which model it is and where it runs.
 * Three short lines, at the end of the system prompt.
 *
 * The date, not the time: the system prompt is the start of the prompt the engines and providers cache, so text that
 * changed every minute made the whole conversation be read again on every turn (in the browser, 2 s became 114 s for a
 * 2,300-token chat). The phone app does the same (apps/mobile/services/llm/prompt.ts).
 *
 * It is kept this small on purpose. The products that get this right say no more: Claude.ai's own prompt has the current
 * date and one short paragraph about being unsure, and OpenRouter adds nothing of its own beyond "a web search was
 * conducted on {date}" when its search is used. Anything more (what a model "cannot" do, where the person is, rules for one
 * kind of question) made small models refuse plain questions or talk about the prompt itself, so none of it is here. What a
 * model can do is already in the tools it is given.
 *
 * The date is on the person's clock. Only the clock's offset from UTC is used (never a place), and it is not shown.
 */

export interface Environment {
  now: Date;
  /** The device clock's offset from UTC, in minutes (+60 for UTC+1). Left out when missing or not sensible. */
  utcOffset?: number;
  model: { name: string; provider?: string };
  /** How the words travel: this computer only, Quo's cloud (through OpenRouter), or the person's own account with a provider. */
  route: 'device' | 'quo-cloud' | 'own-key';
  /** The provider's name for the user's own key route. */
  ownProvider?: string;
}

/** The offset if it is a whole number of minutes within what any place on Earth uses (UTC-12 to UTC+14), else undefined. */
export function validOffset(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= -12 * 60 && value <= 14 * 60 ? value : undefined;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Monday 19 October 2026": today on the person's clock. With no usable offset it is the UTC date, and says so. Written by hand so every runtime agrees. */
export function describeToday(now: Date, utcOffset?: number): string {
  const offset = validOffset(utcOffset);
  const local = new Date(now.getTime() + (offset ?? 0) * 60_000);
  const text = `${WEEKDAYS[local.getUTCDay()]} ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()}`;
  return offset === undefined ? `${text} (UTC)` : text;
}

/** The note: today, which model, and not to guess. (It changes once a day, and last, so the fixed prompt before it stays cached.) */
export function environmentNote(env: Environment): string {
  const where =
    env.route === 'device' ? 'running on this computer'
    : env.route === 'quo-cloud' ? 'running in the cloud through Quo'
    : `reached with the person’s own ${env.ownProvider ?? 'provider'} account`;
  const model = `${env.model.name}${env.model.provider && env.model.provider !== env.ownProvider ? ` (${env.model.provider})` : ''}`;
  return [
    '',
    `Today is ${describeToday(env.now, env.utcOffset)}. You are ${model}, ${where}.`,
    'If you are not sure something you recall is true, say so instead of guessing.',
  ].join('\n');
}
