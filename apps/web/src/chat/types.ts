import type { ImageAspect } from '../../shared/content';
import type { AgentStep } from '../agent/types';
import type { WebSource } from '../../shared/webSources';

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
  /** Replies from a model reached with the user's own key: the provider's name. Kept on this device; not synced. */
  own?: string;
  /** Not a reply: notes standing in for everything before it, written when the conversation's memory filled. Kept on this device; not synced. */
  summary?: boolean;
  /** The web pages a reply drew on, when the model searched. Kept on this device; not synced. */
  sources?: WebSource[];
  /** Tokens that reply used, when the provider said. Kept on this device; not synced. */
  usage?: { input: number; output: number };
  /** The exact model that answered (own keys, Claude Agent), as the provider reported it. Kept on this device; not synced. */
  served?: string;
  /** Images the reply asked for (src/images/): being made, made, or failed. Kept on this device; not synced. */
  images?: GeneratedImage[];
}

/** An image a reply asked for, made by an image model in Quo's cloud from the prompt the chat's model wrote. */
export interface GeneratedImage {
  id: string;
  prompt: string;
  aspect: ImageAspect;
  /** A change to the last image made, which went with the prompt. */
  edit?: boolean;
  status: 'creating' | 'done' | 'failed';
  dataUrl?: string;
  /** The image model's name. */
  model?: string;
  /** Credits it used (0: one of the day's free images, or made on this computer). */
  charged?: number;
  /** Made on this computer (images/device.ts) or in Quo's cloud. Older images have none: the cloud. */
  where?: 'device' | 'cloud';
  /** Asked for on the image itself ("Make it in the cloud"), instead of where its chat runs (images/place.ts). */
  want?: 'device' | 'cloud';
  /** Not made yet: the person chooses first (an offline chat with no image model). */
  choose?: boolean;
  /** Something to know about how it was made (the chat model was set aside to make room). */
  note?: string;
  /** While it is made on this computer: the step the image engine is on, of how many. */
  progress?: { step: number; steps: number };
  error?: string;
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
