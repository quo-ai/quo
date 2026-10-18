import { Message } from '@/types/chat';

/**
 * Prompt and message formatting helpers: system-prompt assembly, chat-message
 * shaping for the native completion call, and reasoning-tag cleanup.
 */

/**
 * Strip model-specific internal reasoning tags while preserving <think> for the UI.
 * Only strips tags known to be emitted by specific model families (Nanbeige)
 * to avoid accidentally eating legitimate content.
 */
export function stripReasoningTags(text: string, stripInternalTags: boolean): string {
  let result = text;

  if (stripInternalTags) {
    // Nanbeige emits structured reasoning stages as XML tags
    const nanbeigeInternalTags = ['imagine', 'understand', 'empathize', 'mood', 'emotion', 'feeling', 'thought', 'reflection'];
    for (const tag of nanbeigeInternalTags) {
      const pattern = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'gi');
      result = result.replace(pattern, '');
    }
  }

  return result
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The text a message contributes to the prompt-token budget, mirroring how
 * buildChatMessages will later serialize it in text mode.
 */
export function getBudgetTextForMessage(msg: Message, preserveReasoning: boolean): string {
  if (msg.role === 'user') {
    let content = userTextWithDocument(msg).trim();
    if (msg.image) {
      content = imageUserText(msg.image, content);
    }
    return content;
  }

  let cleanContent = msg.content.trim();
  if (!preserveReasoning) {
    cleanContent = stripThinkBlocks(cleanContent).trim();
  }
  return cleanContent;
}

/** Remove <think>/[THINK] chain-of-thought blocks. */
export function stripThinkBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\[THINK\][\s\S]*?\[\/THINK\]/gi, '');
}

/**
 * User-turn text for an image message. The token-budget estimator must
 * mirror exactly how buildChatMessages serializes image turns, so both go
 * through this one helper.
 */
/**
 * A user message's text as the model sees it: an attached document's
 * extracted text (kept in memory, stripped before storage) is prepended in
 * XML-style tags, which models handle better than code fences.
 */
export function userTextWithDocument(msg: Message): string {
  const docText = msg.document?.extractedText;
  if (!docText) return msg.content;
  // Quotes/angle brackets would let a crafted filename break out of the
  // attribute and inject prompt structure.
  const safeName = msg.document!.name.replace(/[<>"]/g, '_');
  return `<document filename="${safeName}">\n${docText}\n</document>\n\n${msg.content || 'Please analyse this document.'}`;
}

export function imageUserText(image: { width: number; height: number }, content: string): string {
  const imageInfo = `[Image attached: ${image.width}x${image.height}px]`;
  return content ? `${imageInfo}\n\n${content}` : `${imageInfo}\n\nPlease describe what you see in this image.`;
}

// Date context appended to every system prompt. Day granularity on purpose:
// the system prompt is the start of the cached prompt prefix, so text that
// changed every minute would force the whole conversation to be re-processed
// on every turn. The exact time is available through the get_date tool.
export function getInitialContext(now: Date = new Date()): string {
  const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return `Today is ${date}.`;
}

/**
 * Build the system prompt, injecting the current date/time and, when
 * present, the rolling summary that stands in for older messages and any
 * verbatim messages retrieved by semantic recall.
 */
export function buildSystemContent(
  modelSystemPrompt: string,
  contextSummary?: string | null,
  recallContext?: string | null,
): string {
  let systemContent = modelSystemPrompt;

  // Always state today's date so the model never guesses it
  systemContent = `${systemContent}\n\n${getInitialContext()}`;

  if (contextSummary) {
    systemContent += `\n\n## EARLIER CONVERSATION SUMMARY\nOlder messages were removed to save space. This is what they contained:\n${contextSummary}`;
  }

  if (recallContext) {
    systemContent += `\n\n## RELEVANT EARLIER MESSAGES\nRetrieved verbatim from older parts of this conversation because they may relate to the current question:\n${recallContext}`;
  }

  return systemContent;
}

/**
 * Format the fitted conversation history for the native completion call.
 * In vision mode user images become image_url content parts; in text mode
 * they are replaced with a short placeholder description.
 */
export function buildChatMessages(
  messages: Message[],
  systemContent: string,
  useVision: boolean,
  preserveReasoning: boolean,
): Array<{ role: string; content: any }> {
  const chatMessages: Array<{ role: string; content: any }> = [
    { role: 'system', content: systemContent },
  ];

  // Only the newest image is sent as pixels: re-encoding every earlier image
  // each turn is slow and can overflow the context window (images aren't in
  // the token budget beyond a fixed buffer). Older ones become placeholders.
  let latestImageIndex = -1;
  if (useVision) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && messages[i].image) {
        latestImageIndex = i;
        break;
      }
    }
  }

  for (const [index, msg] of messages.entries()) {
    if (msg.role === 'user') {
      if (useVision && (index === latestImageIndex || !msg.image)) {
        const content: any[] = [];
        if (msg.image?.base64) {
          const mimeType = msg.image.mimeType || 'image/jpeg';
          content.push({
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${msg.image.base64}` },
          });
        } else if (msg.image?.uri) {
          // Use URI as-is if it already has a scheme (file:// or content://).
          // Prefix file:// only for paths without a scheme (e.g. /path/to/file).
          const imageUrl =
            msg.image.uri.startsWith('file://') || msg.image.uri.startsWith('content://')
              ? msg.image.uri
              : `file://${msg.image.uri}`;
          content.push({ type: 'image_url', image_url: { url: imageUrl } });
        }
        const text = userTextWithDocument(msg);
        if (text) {
          content.push({ type: 'text', text });
        } else if (msg.image) {
          content.push({ type: 'text', text: 'What do you see in this image? Describe it in detail.' });
        }
        chatMessages.push({ role: 'user', content });
      } else {
        let content = userTextWithDocument(msg).trim();
        if (msg.image) {
          content = imageUserText(msg.image, content);
        }
        chatMessages.push({ role: 'user', content });
      }
    } else if (msg.role === 'assistant') {
      // Strip legacy memory notices and (except for Ministral, which reuses
      // its reasoning) thinking blocks to save context.
      let cleanContent = msg.content.replace(/\s*\[MEMORY_NOTICE:[^\]]+\]/gi, '').trim();
      if (!preserveReasoning) {
        cleanContent = stripThinkBlocks(cleanContent).trim();
      }
      if (cleanContent) {
        chatMessages.push({ role: 'assistant', content: cleanContent });
      }
    }
  }

  return chatMessages;
}
