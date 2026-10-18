/**
 * What Quo Sync actually stores: the same shapes on every platform, whatever
 * each app keeps on disk. An app converts its own chats and memories to these
 * to upload, and back when it receives them (the web app in adapters.ts, the
 * phone app in services/sync/adapters.ts). See SYNC.md.
 *
 * Fields one platform doesn't understand travel in `x` and come back unchanged,
 * so a chat that goes phone → web → phone loses nothing.
 */

export type Extra = Record<string, unknown>;

/** A file attached to a message. Only its name is synced; the contents stay on the device they were added on. */
export interface WireAttachment {
  id: string;
  kind: 'image' | 'document';
  name: string;
  width?: number;
  height?: number;
  omitted: true;
}

export interface WireStats {
  tokens: number;
  tokensPerSecond: number;
  timeToFirstTokenMs: number;
}

export interface WireMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** The model's thinking, apart from its answer. */
  reasoning?: string;
  timestamp?: number;
  modelId?: string;
  modelName?: string;
  stats?: WireStats;
  stopped?: boolean;
  cloud?: boolean;
  charged?: number;
  attachments?: WireAttachment[];
  x?: Extra;
}

export interface WireChat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: WireMessage[];
  x?: Extra;
}

/** Something the assistant remembers about the user. */
export interface WireMemory {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}
