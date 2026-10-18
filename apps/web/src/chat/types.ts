export interface MessageStats {
  tokens: number;
  tokensPerSecond: number;
  timeToFirstTokenMs: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  modelId?: string;
  stats?: MessageStats;
  /** The user stopped the reply before it finished. */
  stopped?: boolean;
  /** Cloud replies: credits charged (0 when free). */
  charged?: number;
  cloud?: boolean;
  modelName?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

export const newId = (): string => crypto.randomUUID();
