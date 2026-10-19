/**
 * What an empty chat suggests, and how it greets. The starters fit where the person is: inside a project they are about
 * the project, on the desktop with room to build they mix ordinary ideas with things to make, and elsewhere they are
 * everyday. A new set each time, but steady while a chat is open (the choice is seeded from the chat and the day), so a
 * re-render never reshuffles what someone is about to click. Never health or medical topics.
 */

export interface Starter {
  title: string;
  detail: string;
  prompt: string;
}

export type StarterMode = 'chat' | 'project' | 'mixed';

const EVERYDAY: Starter[] = [
  { title: 'Plan a weekend', detail: 'Two relaxed days in Lisbon', prompt: 'Plan a relaxed two-day weekend in Lisbon with a mix of food, sights and downtime.' },
  { title: 'Write an email', detail: 'Politely reschedule a meeting', prompt: 'Write a short, polite email asking to move tomorrow’s meeting to next week.' },
  { title: 'Explain simply', detail: 'How does Wi-Fi work?', prompt: 'Explain how Wi-Fi works in simple terms, in a few short paragraphs.' },
  { title: 'Brainstorm', detail: 'Names for a coffee cart', prompt: 'Brainstorm ten memorable names for a small coffee cart, with a one-line reason for each.' },
  { title: 'Cook with what you have', detail: 'Eggs, rice and spinach', prompt: 'I have eggs, rice, spinach and a lemon. Suggest three quick dinners and the steps for the one you like best.' },
  { title: 'Make a decision', detail: 'Rent or buy a bike?', prompt: 'Help me decide whether to buy or rent a bike for the summer. Ask what you need to know, then give a recommendation.' },
  { title: 'Learn something', detail: 'A 20-minute plan for chess', prompt: 'Teach me the basics of chess with a 20-minute plan: what to learn first and a short exercise for each step.' },
  { title: 'Tidy some writing', detail: 'Make a paragraph clearer', prompt: 'I will paste a paragraph. Rewrite it to be clearer and shorter, and tell me what you changed.' },
  { title: 'Translate and explain', detail: 'A phrase and when to use it', prompt: 'Translate “I’m running a bit late, sorry!” into Spanish, French and German, and say how formal each one is.' },
  { title: 'Plan a trip budget', detail: 'A week in Japan', prompt: 'Help me sketch a rough budget for a week in Japan: flights aside, what should I expect to spend each day?' },
  { title: 'Summarise an idea', detail: 'In five bullet points', prompt: 'Explain how compound interest works, then give me five bullet points I could remember.' },
  { title: 'Write a toast', detail: 'For a friend’s birthday', prompt: 'Write a warm, funny 30-second birthday toast for a close friend who loves hiking and terrible puns.' },
];

const PROJECT: Starter[] = [
  { title: 'Explain this project', detail: 'What it is and how it fits together', prompt: 'Explain this project: what it does, how it is organised, and where I should start reading.' },
  { title: 'Find likely bugs', detail: 'Read it with fresh eyes', prompt: 'Look through the code for likely bugs or risky spots. List the most important few with the file and line, and say why.' },
  { title: 'Review my recent changes', detail: 'What git says I changed', prompt: 'Look at my uncommitted changes with git and review them: anything wrong, missing or worth simplifying?' },
  { title: 'Run the tests', detail: 'And explain any failures', prompt: 'Run the project’s tests and tell me what fails and why. Do not change anything yet.' },
  { title: 'Suggest improvements', detail: 'Small, safe wins first', prompt: 'Suggest a few small, safe improvements to this project, most valuable first, and offer to make the first one.' },
  { title: 'Add some tests', detail: 'For the least-covered part', prompt: 'Find an important part of this project with little or no test coverage and add good tests for it, matching the existing style.' },
  { title: 'Draw the architecture', detail: 'A short written map', prompt: 'Describe the architecture of this project as a short map: the main parts, what each does, and how they talk to each other.' },
  { title: 'Check the dependencies', detail: 'What it relies on', prompt: 'List what this project depends on, and point out anything that looks outdated, unused or surprising.' },
];

const BUILD: Starter[] = [
  { title: 'Build a to-do page', detail: 'One HTML file, saved in the browser', prompt: 'Build a small to-do list web page in a single HTML file that saves items in the browser, then open it for me.' },
  { title: 'Make a tiny game', detail: 'Snake in the browser', prompt: 'Make a simple Snake game in one HTML file with arrow-key controls and a score, then open it for me.' },
  { title: 'Rename my photos', detail: 'A small Python script', prompt: 'Write a small Python script that renames the photos in a folder to their date taken, and explain how to run it.' },
  { title: 'Make a landing page', detail: 'For a small bakery', prompt: 'Build a clean one-page website for a small neighbourhood bakery with a menu and opening hours, then open it for me.' },
  { title: 'Chart some numbers', detail: 'A page that draws a chart', prompt: 'Build a web page with a bar chart of monthly sales from a small sample data set, then open it for me.' },
  { title: 'Write a CLI tool', detail: 'Convert CSV to JSON', prompt: 'Write a small command-line tool that converts a CSV file to JSON, with a clear help message.' },
];

function hash(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/** A small, steady pseudo-random sequence for a seed (so the same chat on the same day gets the same picks). */
function sequence(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(pool: T[], count: number, random: () => number): T[] {
  const left = [...pool];
  const chosen: T[] = [];
  while (chosen.length < count && left.length) chosen.push(left.splice(Math.floor(random() * left.length), 1)[0]);
  return chosen;
}

/** Four starters for where the person is. */
export function pickStarters(mode: StarterMode, seed: string, count = 4): Starter[] {
  const random = sequence(`${mode}:${seed}`);
  if (mode === 'project') return pick(PROJECT, count, random);
  if (mode === 'mixed') return [...pick(EVERYDAY, Math.ceil(count / 2), random), ...pick(BUILD, Math.floor(count / 2), random)];
  return pick(EVERYDAY, count, random);
}

const HELLO = {
  night: ['Still up?', 'Burning the midnight oil?'],
  morning: ['Good morning.', 'Morning.'],
  afternoon: ['Good afternoon.', 'Afternoon.'],
  evening: ['Good evening.', 'Evening.'],
};

/** The big line over an empty chat: a time-of-day hello, or what the project is for. */
export function greeting(now: Date, seed: string, inProject: boolean): string {
  if (inProject) return pick(['What are we working on?', 'What shall we build?', 'Where shall we start?'], 1, sequence(`g:${seed}`))[0];
  const hour = now.getHours();
  const part = hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const hello = pick(HELLO[part], 1, sequence(`h:${seed}`))[0];
  return `${hello} What’s on your mind?`;
}

export const POOLS = { EVERYDAY, PROJECT, BUILD };
