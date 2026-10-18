import { repairAssistantContent, MAX_MESSAGE_CHARS } from '../repairMessage';

/** Reproduces the old bug: accumulated reasoning re-wrapped on every token. */
function corrupt(reasoningTokens: string[], answerTokens: string[]): string {
  let out = '';
  let reasoning = '';
  for (const t of reasoningTokens) {
    reasoning += t;
    out += `<think>${reasoning}</think>${t}`;
  }
  out += `<think>${reasoning}</think></think>`;
  for (const t of answerTokens) out += `<think>${reasoning}</think>${t}`;
  return out;
}

describe('repairAssistantContent', () => {
  it('recovers the reasoning and answer from a corrupted reply', () => {
    const bad = corrupt(['Add ', '2h35 ', 'to 3:40.'], ['You ', 'arrive ', 'at 6:15 PM.']);
    expect(repairAssistantContent(bad)).toBe('<think>Add 2h35 to 3:40.</think>You arrive at 6:15 PM.');
  });

  it('leaves normal replies untouched', () => {
    const ok = '<think>short reasoning</think>The answer.';
    expect(repairAssistantContent(ok)).toBe(ok);
    expect(repairAssistantContent('Plain answer')).toBe('Plain answer');
  });

  it('caps any single message so it cannot exhaust the text layout', () => {
    const huge = 'x'.repeat(MAX_MESSAGE_CHARS + 10);
    const out = repairAssistantContent(huge);
    expect(out.length).toBeLessThan(MAX_MESSAGE_CHARS + 30);
    expect(out.endsWith('[Message truncated]')).toBe(true);
  });
});
