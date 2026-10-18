import { createConversation, createMessage, generateTitle } from '../chat';
import { Message } from '@/types/chat';

describe('createConversation', () => {
  it('creates an empty conversation with an id and timestamps', () => {
    const conversation = createConversation();
    expect(conversation.id).toBeTruthy();
    expect(conversation.title).toBe('New Chat');
    expect(conversation.messages).toEqual([]);
    expect(conversation.createdAt).toBeGreaterThan(0);
    expect(conversation.updatedAt).toBe(conversation.createdAt);
  });
});

describe('createMessage', () => {
  it('creates a message with role and content', () => {
    const message = createMessage('user', 'hello');
    expect(message.role).toBe('user');
    expect(message.content).toBe('hello');
    expect(message.id).toBeTruthy();
    expect(message.timestamp).toBeGreaterThan(0);
  });

  it('attaches optional tool actions and stats', () => {
    const message = createMessage('assistant', 'done', undefined, [
      { type: 'info_query', name: 'get_date', result: 'Monday' },
    ]);
    expect(message.toolActions).toHaveLength(1);
  });
});

describe('generateTitle', () => {
  const user = (content: string, extra?: Partial<Message>): Message => ({
    id: '1',
    role: 'user',
    content,
    timestamp: 1,
    ...extra,
  });

  it('uses short first user message as-is', () => {
    expect(generateTitle([user('Hi there')])).toBe('Hi there');
  });

  it('truncates long messages to 30 chars', () => {
    const title = generateTitle([user('a'.repeat(50))]);
    expect(title).toBe('a'.repeat(30) + '...');
  });

  it('labels image-only messages', () => {
    expect(generateTitle([user('', { image: { uri: 'x', width: 1, height: 1 } })])).toBe('📷 Image question');
  });

  it('labels document-only messages with the filename', () => {
    const doc = { uri: 'x', name: 'report.pdf', mimeType: 'application/pdf', size: 10, extractedText: '' };
    expect(generateTitle([user('', { document: doc })])).toBe('📄 report.pdf');
  });

  it('falls back when there is no user message', () => {
    expect(generateTitle([])).toBe('New Chat');
  });
});
