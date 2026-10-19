/** Every shortcut in the app, in one place, so the list people read can't drift from what exists. `mod` is Ctrl, or ⌘ on a Mac. */
export interface Shortcut {
  keys: string[];
  what: string;
  /** Only where there is a project folder (the desktop app). */
  project?: boolean;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Chat',
    items: [
      { keys: ['mod', 'Shift', 'O'], what: 'New chat' },
      { keys: ['mod', 'B'], what: 'Show or hide the sidebar' },
      { keys: ['/'], what: 'Go to the message box' },
      { keys: ['Enter'], what: 'Send' },
      { keys: ['Shift', 'Enter'], what: 'New line' },
      { keys: ['↑'], what: 'Bring back your last message (in an empty box)' },
      { keys: ['Esc'], what: 'Stop a reply' },
      { keys: ['/…'], what: 'Commands: type a slash in the message box' },
    ],
  },
  {
    title: 'Project',
    items: [
      { keys: ['mod', 'Shift', 'E'], what: 'Show or hide the project files', project: true },
      { keys: ['Shift', 'Tab'], what: 'Switch plan mode (reading only)', project: true },
      { keys: ['@'], what: 'Mention a file from the project', project: true },
    ],
  },
  {
    title: 'App',
    items: [
      { keys: ['mod', ','], what: 'Settings' },
      { keys: ['mod', '/'], what: 'This list' },
    ],
  },
  {
    title: 'When Quo asks to change something',
    items: [
      { keys: ['Esc'], what: 'Don’t allow' },
      { keys: ['mod', 'Enter'], what: 'Allow this once' },
    ],
  },
];

/** The keys as they read on this computer. */
export const keyLabel = (key: string, mac: boolean): string => (key === 'mod' ? (mac ? '⌘' : 'Ctrl') : key === 'Shift' && mac ? '⇧' : key);
