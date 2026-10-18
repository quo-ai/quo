import { buildChatMessages, getBudgetTextForMessage } from '../llm/prompt';
import { Message } from '@/types/chat';

const image = { uri: 'file:///img.jpg', width: 100, height: 100, mimeType: 'image/jpeg' } as Message['image'];

describe('buildChatMessages vision', () => {
  it('sends only the newest image as pixels; older images become placeholders', () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'first', timestamp: 1, image },
      { id: 'a1', role: 'assistant', content: 'a cat', timestamp: 2 },
      { id: 'u2', role: 'user', content: 'second', timestamp: 3, image },
      { id: 'a2', role: 'assistant', content: 'a dog', timestamp: 4 },
      { id: 'u3', role: 'user', content: 'what colour is it?', timestamp: 5 },
    ];
    const chat = buildChatMessages(messages, 'sys', true, false);
    const users = chat.filter(m => m.role === 'user');
    expect(typeof users[0].content).toBe('string');
    expect(users[1].content.some((part: any) => part.type === 'image_url')).toBe(true);
    expect(users[2].content).toEqual([{ type: 'text', text: 'what colour is it?' }]);
  });
});

describe('documents in history', () => {
  const docMessage: Message = {
    id: 'u1',
    role: 'user',
    content: 'summarise',
    timestamp: 1,
    document: { uri: 'x', name: 'a"b.pdf', mimeType: 'application/pdf', size: 1, extractedText: 'SECTION 3: hello' },
  };

  it('renders the document for every turn that still carries its text', () => {
    const chat = buildChatMessages([docMessage], 'sys', false, false);
    expect(chat[1].content).toBe('<document filename="a_b.pdf">\nSECTION 3: hello\n</document>\n\nsummarise');
    expect(getBudgetTextForMessage(docMessage, false)).toContain('SECTION 3');
  });

  it('falls back to plain content once the text was stripped (e.g. after restart)', () => {
    const stripped = { ...docMessage, document: { ...docMessage.document!, extractedText: '' } };
    expect(buildChatMessages([stripped], 'sys', false, false)[1].content).toBe('summarise');
  });
});
