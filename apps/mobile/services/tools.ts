import { ToolAction, NativeToolCall } from '@/types/chat';
import { memoryService } from './memory';
import * as Localization from 'expo-localization';

export interface ParsedToolCall {
  name: string;
  args: Record<string, string>;
}

/**
 * Parse tool calls from model output using simple text format
 * Format: [TOOL:tool_name(param1="value1", param2="value2")]
 * Also handles variations: [Tool: name()], [tool:name()], etc.
 */
// [TOOL:name(args)] (case-insensitive), optionally wrapped in markdown
// emphasis like **[TOOL:get_date()]**. Args end at the first ")]", so
// parentheses inside quoted values are fine.
const TOOL_CALL_PATTERN = /(?:\*\*|__)?\[tool:\s*(\w+)\(([\s\S]*?)\)\](?:\*\*|__)?/gi;

// key="value" or key='value'; the value may contain the other quote kind
// and backslash escapes.
const STRICT_ARG_PATTERN = /(\w+)\s*=\s*(["'])((?:\\.|(?!\2)[^\\])*)\2/g;

// Single argument spanning to the last matching quote — recovers values the
// model didn't escape, e.g. content='User's dog is Rex'.
const LENIENT_SINGLE_ARG_PATTERN = /^\s*(\w+)\s*=\s*(["'])([\s\S]*)\2\s*$/;

function unescapeArg(value: string): string {
  return value.replace(/\\(["'\\])/g, '$1');
}

function parseToolArgs(argsString: string): Record<string, string> {
  const args: Record<string, string> = {};
  for (const match of argsString.matchAll(STRICT_ARG_PATTERN)) {
    args[match[1]] = unescapeArg(match[3]);
  }

  // If the strict pass left unparsed text behind, an unescaped quote cut a
  // value short; fall back to treating the whole string as one argument.
  const leftover = argsString.replace(STRICT_ARG_PATTERN, '').replace(/[\s,]/g, '');
  if (leftover) {
    const lenient = argsString.match(LENIENT_SINGLE_ARG_PATTERN);
    if (lenient) return { [lenient[1]]: unescapeArg(lenient[3]) };
  }
  return args;
}

/**
 * Tool definitions for models with native tool calling (toolFormat
 * 'native'): passed to llama.rn's completion as `tools`, rendered by the
 * model's own chat template, with calls grammar-constrained and returned
 * parsed in `tool_calls`. Names and arguments match executeToolCalls.
 */
export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description: 'Save a lasting fact about the user (for example their name or a preference) so it can be recalled in future chats.',
      parameters: {
        type: 'object',
        properties: { content: { type: 'string', description: 'The fact to remember, as a short sentence.' } },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_memory',
      description: 'Delete a previously saved fact about the user.',
      parameters: {
        type: 'object',
        properties: { content: { type: 'string', description: 'The saved fact to remove.' } },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_memories',
      description: 'List the facts saved about the user.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_date',
      description: 'Get the current date and time.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_user_info',
      description: "Get the user's locale, timezone and measurement units.",
      parameters: { type: 'object', properties: {} },
    },
  },
] as const;

export function parseToolCalls(text: string): ParsedToolCall[] {
  return Array.from(text.matchAll(TOOL_CALL_PATTERN), match => ({
    name: match[1],
    args: parseToolArgs(match[2]),
  }));
}

/**
 * Strip tool call markers from response text for display
 */
export function stripToolCalls(text: string): string {
  return text
    .replace(TOOL_CALL_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Convert native llama.rn tool_calls to our ParsedToolCall format.
 * Native format: { function: { name, arguments: JSON string } }
 */
export function convertNativeToolCalls(nativeCalls: NativeToolCall[]): ParsedToolCall[] {
  return nativeCalls.map(tc => {
    let args: Record<string, string> = {};
    try {
      const parsed = JSON.parse(tc.function.arguments);
      for (const [key, val] of Object.entries(parsed)) {
        args[key] = String(val);
      }
    } catch {
      // If arguments aren't valid JSON, treat as a single "content" arg
      if (tc.function.arguments) {
        args['content'] = tc.function.arguments;
      }
    }
    return { name: tc.function.name, args };
  });
}

/**
 * Execute parsed tool calls and return results for UI display
 */
export async function executeToolCalls(
  toolCalls: ParsedToolCall[],
  options?: { isPremium?: boolean; onMemoryLimit?: () => void }
): Promise<ToolAction[]> {
  const toolActions: ToolAction[] = [];
  const isPremium = options?.isPremium ?? false;

  for (const { name, args } of toolCalls) {
    let result: string;
    let actionType: ToolAction['type'] = 'tool_call';

    switch (name) {
      case 'save_memory':
        result = await saveMemory(args.content, isPremium, options?.onMemoryLimit);
        actionType = 'memory_save';
        break;
      case 'delete_memory':
        result = await deleteMemory(args.content);
        actionType = 'memory_delete';
        break;
      case 'list_memories':
        result = await listMemories();
        actionType = 'memory_list';
        break;
      case 'get_date':
        result = getDate();
        actionType = 'info_query';
        break;
      case 'get_user_info':
        result = getUserInfo();
        actionType = 'info_query';
        break;
      default:
        result = `Unknown tool: ${name}`;
    }

    toolActions.push({ type: actionType, name, result });
  }

  return toolActions;
}

// Memory implementations
async function saveMemory(content: string, isPremium: boolean = false, onMemoryLimit?: () => void): Promise<string> {
  try {
    await memoryService.addMemory(content, isPremium);
    return `Saved: "${content}"`;
  } catch (error: any) {
    const message = error?.message ?? String(error);
    if (!isPremium && message.toLowerCase().includes('memory is full')) {
      onMemoryLimit?.();
      return 'Memory is full. Premium unlocks more memory slots.';
    }
    return `Failed: ${message}`;
  }
}

async function deleteMemory(content: string): Promise<string> {
  try {
    const success = await memoryService.deleteMemoryByContent(content);
    return success ? `Deleted: "${content}"` : `Not found: "${content}"`;
  } catch (error) {
    return `Failed: ${error}`;
  }
}

async function listMemories(): Promise<string> {
  try {
    const memories = await memoryService.getMemories();
    if (memories.length === 0) return 'No memories stored.';
    return memories.map((m: any, i: number) => `${i + 1}. ${m.content}`).join('\n');
  } catch (error) {
    return `Failed: ${error}`;
  }
}

// Date/time tool - descriptive format for the model, compact enough for UI stripping
function getDate(): string {
  const now = new Date();
  const tz = Localization.getCalendars()[0]?.timeZone || 'UTC';
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  // "Current date and time: " prefix is stripped in the UI but kept for model context
  return `Current date and time: ${dateStr} at ${timeStr} (${tz})`;
}

// User info tool - shorthand format
function getUserInfo(): string {
  const locales = Localization.getLocales();
  const calendars = Localization.getCalendars();
  const locale = locales[0];
  const calendar = calendars[0];
  
  const parts: string[] = [];
  if (locale?.regionCode) parts.push(`region:${locale.regionCode}`);
  if (calendar?.timeZone) parts.push(`tz:${calendar.timeZone}`);
  if (locale?.languageCode) parts.push(`lang:${locale.languageCode}`);
  if (calendar?.uses24hourClock !== undefined) parts.push(calendar.uses24hourClock ? '24h' : '12h');
  if (locale?.temperatureUnit) parts.push(`temp:${locale.temperatureUnit}`);
  if (locale?.measurementSystem) parts.push(`units:${locale.measurementSystem}`);
  
  return parts.join(' | ') || 'No user info available';
}
