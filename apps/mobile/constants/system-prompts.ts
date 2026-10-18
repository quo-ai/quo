/**
 * System prompts for each model.
 *
 * Small on-device models follow a few clear instructions far better than a
 * long rule list (instruction-following degrades as rules are added, and
 * early rules win), so the core prompt is short and direct. It is also
 * byte-stable: dynamic context (date, conversation summary, recall) is
 * appended after it (services/llm/prompt.ts) so llama.rn can reuse the
 * cached prompt prefix across turns.
 *
 * Tools: 'native' models receive tool definitions through their own chat
 * template (services/tools.ts TOOL_DEFINITIONS), so the prompt only states
 * the usage policy. 'text' models get the [TOOL:...] protocol spelled out.
 */

type ToolPrompt = 'native' | 'text' | 'none';

const CORE = `You are Quo, a private AI assistant running entirely on the user's device. You have no internet access, so you can't browse, search or look up live information.

- Reply in the user's language.
- Be direct and concise. Skip filler and don't restate the question.
- Use Markdown when it helps. Put code in fenced blocks with a language tag, and write maths in LaTeX.
- If you don't know something or it may be out of date, say so briefly.`;

const VISION = 'You can see images the user attaches and answer questions about them.';

const NATIVE_TOOL_POLICY =
  'Only use the memory tools for lasting facts about the user, such as their name or preferences. Use get_date when you need the current time.';

const TEXT_TOOLS = `To use a tool, write the call on its own line exactly as shown:
[TOOL:save_memory(content="The user is vegetarian")] saves a lasting fact about the user
[TOOL:delete_memory(content="The user is vegetarian")] removes a saved fact
[TOOL:list_memories()] lists saved facts
[TOOL:get_date()] gets the current date and time
Only save lasting facts about the user, such as their name or preferences.`;

// Mistral's official reasoning-format instructions for Ministral 3
// Reasoning (SYSTEM_PROMPT.txt in the model repo), which the model card
// says to keep in the system prompt.
const MINISTRAL_REASONING_FORMAT = `First draft your thinking process (inner monologue) until you arrive at a response. Write both your thoughts and the response in the same language as the input.

Your thinking process must follow the template below:[THINK]Your thoughts or/and draft, like working through an exercise on scratch paper. Be as casual and as long as you want until you are confident to generate the response to the user.[/THINK]Here, provide a self-contained response.`;

function buildPrompt({ tools, vision = false, extra }: { tools: ToolPrompt; vision?: boolean; extra?: string }): string {
  return [
    CORE,
    vision ? VISION : null,
    tools === 'native' ? NATIVE_TOOL_POLICY : tools === 'text' ? TEXT_TOOLS : null,
    extra,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function getSystemPrompt(modelId: string): string {
  switch (modelId) {
    case 'qwen35-0.8b':
    case 'qwen35-2b':
    case 'llama32-3b':
    case 'nanbeige4-3b-thinking':
      return buildPrompt({ tools: 'native' });
    case 'qwen35-4b':
    case 'gemma4-e2b':
    case 'ministral-3b-instruct':
      return buildPrompt({ tools: 'native', vision: true });
    case 'ministral-3b-reasoning':
      return buildPrompt({ tools: 'native', vision: true, extra: MINISTRAL_REASONING_FORMAT });
    case 'gemma3-4b':
      return buildPrompt({ tools: 'text', vision: true });
    case 'smollm3-3b':
      // Thinking is toggled via the template's enable_thinking flag; a
      // hard-coded /no_think here would silently override the user's choice.
      return buildPrompt({ tools: 'text' });
    case 'gemma3-1b':
    case 'phi4-mini':
      return buildPrompt({ tools: 'none' });
    default:
      // Custom GGUFs: unknown template, so use the portable text protocol.
      return buildPrompt({ tools: 'text' });
  }
}
