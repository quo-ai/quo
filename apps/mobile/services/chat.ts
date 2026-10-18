import { Conversation, Message, ImageAttachment, DocumentAttachment, ToolAction, GenerationStats } from '@/types/chat';

export function createConversation(): Conversation {
  return {
    id: generateId(),
    title: 'New Chat',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function createMessage(
  role: 'user' | 'assistant', 
  content: string, 
  image?: ImageAttachment,
  toolActions?: ToolAction[],
  stats?: GenerationStats,
  document?: DocumentAttachment,
): Message {
  return {
    id: generateId(),
    role,
    content,
    timestamp: Date.now(),
    image,
    document,
    toolActions,
    stats,
  };
}

export function generateTitle(messages: Message[]): string {
  const firstUserMessage = messages.find(m => m.role === 'user');
  if (!firstUserMessage) return 'New Chat';

  // Handle image-only messages
  if (!firstUserMessage.content && firstUserMessage.image) {
    return '📷 Image question';
  }

  // Handle document-only messages
  if (!firstUserMessage.content && firstUserMessage.document) {
    return `📄 ${firstUserMessage.document.name}`;
  }

  const content = firstUserMessage.content;
  if (content.length <= 30) return content;

  return content.substring(0, 30) + '...';
}

