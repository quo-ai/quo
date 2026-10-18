export function parseChainOfThought(content: string): { thinking: string | null; content: string } {
  // Extract thinking first, then sanitize the *thinking* text only.
  // We keep the main response text intact (it should already be cleaned in llm.ts).
  const qwenMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
  if (qwenMatch) {
    const thinking = qwenMatch[1]
      .replace(/<\/?[a-z_]+>/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const remainingContent = content.replace(qwenMatch[0], '').trim();
    return { thinking, content: remainingContent };
  }


  // Qwen streaming: closing tag only (thinking started in previous chunk)
  const closingOnlyMatch = content.match(/^([\s\S]*?)<\/think>/i);
  if (closingOnlyMatch) {
    const thinking = closingOnlyMatch[1]
      .replace(/<\/?[a-z_]+>/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const remainingContent = content.replace(/^[\s\S]*?<\/think>\s*/i, '').trim();
    return { thinking, content: remainingContent };
  }

  // Qwen streaming: open tag, still thinking
  const openThinkMatch = content.match(/<think>([\s\S]*)$/i);
  if (openThinkMatch) {
    return {
      thinking: openThinkMatch[1].replace(/<\/?[a-z_]+>/gi, '').replace(/\n{3,}/g, '\n\n').trim(),
      content: '',
    };
  }

  // Mistral format: [THINK]...[/THINK]
  const mistralMatch = content.match(/\[THINK\]([\s\S]*?)\[\/THINK\]/i);
  if (mistralMatch) {
    const thinking = mistralMatch[1].replace(/<\/?[a-z_]+>/gi, '').replace(/\n{3,}/g, '\n\n').trim();
    const remainingContent = content.replace(/\[THINK\][\s\S]*?\[\/THINK\]/gi, '').trim();
    return { thinking, content: remainingContent };
  }

  // Mistral streaming: closing tag only
  const mistralClosingMatch = content.match(/^([\s\S]*?)\[\/THINK\]/i);
  if (mistralClosingMatch) {
    const thinking = mistralClosingMatch[1].replace(/<\/?[a-z_]+>/gi, '').replace(/\n{3,}/g, '\n\n').trim();
    const remainingContent = content.replace(/^[\s\S]*?\[\/THINK\]\s*/i, '').trim();
    return { thinking, content: remainingContent };
  }

  // Mistral streaming: open tag, still thinking
  const mistralOpenMatch = content.match(/\[THINK\]([\s\S]*)$/i);
  if (mistralOpenMatch) {
    return {
      thinking: mistralOpenMatch[1].replace(/<\/?[a-z_]+>/gi, '').replace(/\n{3,}/g, '\n\n').trim(),
      content: '',
    };
  }

  return { thinking: null, content };
}
