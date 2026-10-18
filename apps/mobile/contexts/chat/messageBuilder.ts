import { Message, ImageAttachment, DocumentAttachment } from '@/types/chat';
import { createMessage } from '@/services/chat';
import { llmService } from '@/services/llm';
import { stripImageBase64 } from './helpers';

// Builds the persisted user message and the (richer) message sent to the LLM
// for a new outgoing chat message, including token-aware document embedding.
export async function buildUserMessages({
  content,
  image,
  document,
  liveMessages,
}: {
  content: string;
  image?: ImageAttachment;
  document?: DocumentAttachment;
  liveMessages: Message[];
}): Promise<{ userMessage: Message; llmUserMessage: Message }> {
  // The document's extracted text stays on the in-memory message so every
  // later turn (and regenerate) can still see it; the prompt builder renders
  // it (userTextWithDocument) and storage strips it before persisting.
  let storedDocument = document;
  if (document?.extractedText) {
    let docText = document.extractedText;

    // Token-aware truncation: ensure the document fits within the model's
    // context window, leaving room for system prompt, history, and output.
    try {
      const historyText = liveMessages.map(m => m.content).join('\n');
      const historyTokens = await llmService.estimateTokens(historyText);
      const budget = llmService.getDocumentTokenBudget(historyTokens);
      const docTokens = await llmService.estimateTokens(docText);
      if (docTokens > budget) {
        // Rough proportional trim (chars ≈ tokens * 4)
        const ratio = budget / docTokens;
        const trimmedLen = Math.floor(docText.length * ratio);
        docText = docText.slice(0, trimmedLen) + '\n\n[... Document truncated to fit context window]';
      }
    } catch {
      // Non-fatal — fall back to the character-based limit in fileExtractor
    }
    storedDocument = { ...document, extractedText: docText };
  }

  const userMessage = createMessage('user', content, stripImageBase64(image), undefined, undefined, storedDocument);
  // The LLM copy additionally carries the transient image base64.
  const llmUserMessage = { ...userMessage, image };

  return { userMessage, llmUserMessage };
}
