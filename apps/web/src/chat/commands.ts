/**
 * Slash commands in the message box: type / and the ones that apply right now are listed, Enter runs the highlighted one.
 * Which exist depends on the chat (plan mode only in Code mode, undo only after a change), so the list is built from state
 * (ui/chat/useCommands.ts); this file is only the matching.
 */

export interface Command {
  name: string;
  aliases?: string[];
  hint: string;
  run: () => void;
}

const names = (command: Command): string[] => [command.name, ...(command.aliases ?? [])];

/** The commands a half-typed "/pl" could mean: names that start with it first, in list order, then aliases that do. Nothing once a space follows. */
export function matchCommands(input: string, commands: Command[]): Command[] {
  const typed = /^\/([a-z-]*)$/i.exec(input)?.[1]?.toLowerCase();
  if (typed === undefined) return [];
  const byName = commands.filter(command => command.name.startsWith(typed));
  const byAlias = commands.filter(command => !command.name.startsWith(typed) && (command.aliases ?? []).some(alias => alias.startsWith(typed)));
  return [...byName, ...byAlias];
}

/** The command a message is, exactly ("/plan"), or null if it is just a message. */
export function exactCommand(input: string, commands: Command[]): Command | null {
  const typed = /^\/([a-z-]+)\s*$/i.exec(input.trim())?.[1]?.toLowerCase();
  return typed ? commands.find(command => names(command).includes(typed)) ?? null : null;
}
