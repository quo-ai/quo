/**
 * What every model is told about where it is: today's date and time, the program it runs in, which model it is and how
 * its words reach the person, and what it can and cannot do in this chat. Shared by the server (which writes the
 * prompt for Quo's own cloud models in Code mode, using its own clock) and the app (offline models, the user's own
 * keys, plain chats).
 *
 * "Where" is deliberately not a place: Quo never asks the device or the network where the person is. The model gets the
 * clock's offset from UTC (such as UTC+1) and the device's language, which is enough to answer "what time is it" and to
 * know it can't tell which city or country they are in. A time zone's name ("Europe/London") or a language's region
 * ("en-GB") would say more than that, so neither is sent. Everything here is true for the route it describes: a
 * capability is only listed when the chat really has it.
 */

export type Capability = 'web' | 'read-files' | 'change-files' | 'commands' | 'attachments' | 'images' | 'memories';

const CAPABILITY_TEXT: Record<Capability, { can: string; cannot: string }> = {
  web: { can: 'search the web and read pages', cannot: 'browse the web' },
  'read-files': { can: 'read files in the project folder', cannot: 'read the person’s files' },
  'change-files': { can: 'change files in the project folder (the person approves each change)', cannot: 'change files' },
  commands: { can: 'run commands in the project folder (the person approves each one)', cannot: 'run commands or code' },
  attachments: { can: 'read documents the person attaches', cannot: 'read attached documents' },
  images: { can: 'see photos the person attaches', cannot: 'see photos' },
  memories: { can: 'use the things the person asked Quo to remember', cannot: 'remember anything between chats' },
};
const ORDER: Capability[] = ['read-files', 'change-files', 'commands', 'web', 'attachments', 'images', 'memories'];

export interface Environment {
  now: Date;
  /** The device clock's offset from UTC, in minutes (+60 for UTC+1). Left out when missing or not sensible. */
  utcOffset?: number;
  /** The device's language alone, such as "en" (no region). */
  language?: string;
  app: { name: 'Quo Desktop' | 'Quo Web'; version?: string; platform?: 'win32' | 'darwin' | 'linux' };
  model: { name: string; provider?: string };
  /** How the words travel: this computer only, Quo's cloud (through OpenRouter), or the person's own account with a provider. */
  route: 'device' | 'quo-cloud' | 'own-key';
  /** The provider's name for the user's own key route. */
  ownProvider?: string;
  can: Capability[];
  /** The project folder's name, in Code mode. */
  project?: string;
  /** Plan mode: reading only for now. */
  plan?: boolean;
  /** Fewer words, for a model with a small window. */
  brief?: boolean;
}

/** The offset if it is a whole number of minutes within what any place on Earth uses (UTC-12 to UTC+14), else undefined. */
export function validOffset(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= -12 * 60 && value <= 14 * 60 ? value : undefined;
}

/** A language code like "en" or "pt", from a tag like "pt-BR" (the region is dropped on purpose), else undefined. */
export function validLanguage(value: unknown): string | undefined {
  const match = typeof value === 'string' ? /^([A-Za-z]{2,3})(-[A-Za-z0-9]{2,8}){0,2}$/.exec(value) : null;
  return match ? match[1].toLowerCase() : undefined;
}

const PLATFORMS = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' } as const;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Monday 19 October 2026, 15:42 (UTC+1)": the time on the person's clock, or in UTC when its offset isn't known. Written by hand so every runtime agrees. */
export function describeNow(now: Date, utcOffset?: number): string {
  const offset = validOffset(utcOffset) ?? 0;
  const local = new Date(now.getTime() + offset * 60_000);
  const two = (n: number) => String(n).padStart(2, '0');
  const sign = offset < 0 ? '-' : '+';
  const hours = Math.floor(Math.abs(offset) / 60);
  const minutes = Math.abs(offset) % 60;
  const zone = validOffset(utcOffset) === undefined ? 'UTC' : `UTC${sign}${hours}${minutes ? `:${two(minutes)}` : ''}`;
  return `${WEEKDAYS[local.getUTCDay()]} ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()}, ${two(local.getUTCHours())}:${two(local.getUTCMinutes())} (${zone})`;
}

/** The capabilities a set of Code-mode tools gives. */
export function capabilitiesOfTools(tools: string[]): Capability[] {
  const has = (...names: string[]) => names.some(name => tools.includes(name));
  const found: Capability[] = [];
  if (has('read_file', 'list_directory', 'find_files', 'search_text')) found.push('read-files');
  if (has('edit_file', 'write_file')) found.push('change-files');
  if (has('run_command')) found.push('commands');
  if (has('web_search', 'fetch_url')) found.push('web');
  return found;
}

/**
 * The note itself, a few lines at the end of the system prompt (the part that changes every minute goes last, so the
 * long fixed part before it can still be cached by the provider).
 */
export function environmentNote(env: Environment): string {
  const platform = env.app.platform ? ` on ${PLATFORMS[env.app.platform]}` : '';
  const program = `${env.app.name}${env.app.version ? ` ${env.app.version}` : ''}${platform}`;
  const where =
    env.route === 'device' ? 'running on this computer, so nothing leaves it'
    : env.route === 'quo-cloud' ? 'running in the cloud through Quo (OpenRouter)'
    : `reached with the person’s own ${env.ownProvider ?? 'provider'} account, straight from this computer`;
  const model = `${env.model.name}${env.model.provider && env.model.provider !== env.ownProvider ? ` (${env.model.provider})` : ''}`;
  const can = ORDER.filter(item => env.can.includes(item)).map(item => CAPABILITY_TEXT[item].can);
  const cannot = ORDER.filter(item => !env.can.includes(item)).map(item => CAPABILITY_TEXT[item].cannot);
  const lines = [
    '',
    'About this chat:',
    `- Now: ${describeNow(env.now, env.utcOffset)}.${env.language ? ` The device’s language is ${env.language}.` : ''} Quo does not know where in the world the person is, only the clock’s offset from UTC; if asked, say so instead of guessing.`,
    `- You are ${model}, ${where}, inside ${program}, a private AI app. Replies are shown as markdown.`,
  ];
  if (env.project) lines.push(`- Project folder: ${env.project}.${env.plan ? ' Plan mode is on: reading only until the person turns it off.' : ''}`);
  lines.push(`- In this chat you can ${can.length ? `${can.join('; ')}` : 'only talk: you have no tools'}.`);
  if (!env.brief && cannot.length) lines.push(`- You cannot ${cannot.join(', ')} here. If asked for something you cannot do, say so plainly instead of pretending, and say what the person could do instead.`);
  return lines.join('\n');
}
