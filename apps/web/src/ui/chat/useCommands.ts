import type { Command } from '../../chat/commands';

export interface CommandState {
  busy: boolean;
  /** There is at least one message from the user, and one reply. */
  hasUserMessage: boolean;
  hasReply: boolean;
  codeAvailable: boolean;
  codeOn: boolean;
  plan: boolean;
  canThink: boolean;
  /** The level now, in words. */
  thinking: string;
  canSummarize: boolean;
  canUndo: boolean;
}

export interface CommandActions {
  newChat: () => void;
  stop: () => void;
  retry: () => void;
  copy: () => void;
  summarize: () => void;
  toggleCode: () => void;
  togglePlan: () => void;
  toggleThinking: () => void;
  undo: () => void;
  chooseFolder: () => void;
  models: () => void;
  keys: () => void;
}

const on = (value: boolean) => (value ? 'on' : 'off');

/** The commands that make sense in this chat right now. */
export function buildCommands(state: CommandState, actions: CommandActions): Command[] {
  const list: (Command | false)[] = [
    { name: 'new', hint: 'Start a new chat', run: actions.newChat },
    state.busy && { name: 'stop', hint: 'Stop the reply', run: actions.stop },
    !state.busy && state.hasUserMessage && { name: 'retry', hint: 'Run the last message again', run: actions.retry },
    state.hasReply && { name: 'copy', hint: 'Copy the last reply', run: actions.copy },
    !state.busy && state.canSummarize && { name: 'summarise', aliases: ['summarize', 'compact'], hint: 'Summarise earlier messages to free memory', run: actions.summarize },
    state.codeAvailable && !state.busy && { name: 'code', hint: `Code mode on or off (now ${on(state.codeOn)})`, run: actions.toggleCode },
    state.codeOn && { name: 'plan', hint: `Plan mode: Quo only reads (now ${on(state.plan)})`, run: actions.togglePlan },
    state.codeOn && !state.busy && { name: 'folder', hint: 'Choose another project folder', run: actions.chooseFolder },
    state.canUndo && { name: 'undo', hint: 'Put back the files the last reply changed', run: actions.undo },
    state.canThink && { name: 'think', hint: `Change how much it thinks (now ${state.thinking})`, run: actions.toggleThinking },
    { name: 'model', hint: 'Choose a model', run: actions.models },
    { name: 'keys', hint: 'Your API keys', run: actions.keys },
  ];
  return list.filter((command): command is Command => command !== false);
}
