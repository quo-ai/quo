import type { AgentStep } from '../agent/types';

export interface MessageStats {
  tokens: number;
  tokensPerSecond: number;
  timeToFirstTokenMs: number;
}

/** A file attached to a message. Images are shrunk first; documents are read to text. */
export interface Attachment {
  id: string;
  kind: 'image' | 'document';
  name: string;
  /** Images: a downscaled JPEG as a data URL. */
  dataUrl?: string;
  width?: number;
  height?: number;
  /** Documents: the extracted text. */
  text?: string;
  /** Synced from another device, which keeps the file's contents. */
  omitted?: boolean;
}

/** Fields another app (the phone app) put on a chat or message that this one doesn't use; kept so they survive a round trip. */
export type Extra = Record<string, unknown>;

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
  reasoning?: string;
  modelId?: string;
  stats?: MessageStats;
  timestamp?: number;
  x?: Extra;
  /** The user stopped the reply before it finished. */
  stopped?: boolean;
  /** Code mode: what the agent did to produce this reply. Kept on this device; not synced. */
  steps?: AgentStep[];
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
  x?: Extra;
}

export const newId = (): string => crypto.randomUUID();
