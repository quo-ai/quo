export interface ImageAttachment {
  uri: string;
  width: number;
  height: number;
  base64?: string;
  mimeType?: string; // e.g., 'image/jpeg', 'image/png', 'image/bmp', 'image/gif', etc.
}

export interface DocumentAttachment {
  uri: string;
  name: string;         // Original filename (e.g. "finances.pdf")
  mimeType: string;     // e.g. 'application/pdf', 'text/plain'
  size: number;         // File size in bytes
  extractedText: string; // Text extracted from the document
}

export interface ToolAction {
  type: 'memory_save' | 'memory_delete' | 'memory_list' | 'info_query' | 'tool_call';
  name: string;
  result: string;
}

// Generation statistics from llama.rn
export interface NativeToolCall {
  type: 'function';
  id?: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface GenerationStats {
  // Token counts
  promptTokens: number;      // Tokens in the prompt/context
  completionTokens: number;  // Tokens generated
  totalTokens: number;       // Total tokens used
  
  // Timing (in seconds)
  promptTime: number;        // Time to process prompt
  generationTime: number;    // Time to generate response
  totalTime: number;         // Total time
  
  // Speed
  tokensPerSecond: number;   // Generation speed
  
  // Context
  contextSize: number;       // Max context size
  contextUsed: number;       // Context tokens used (percentage)
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  image?: ImageAttachment;
  document?: DocumentAttachment;
  toolActions?: ToolAction[]; // Tool calls executed during this message
  stats?: GenerationStats;    // Generation statistics for assistant messages
  /** Quo Sync: fields other apps (web, desktop) put on this message, kept so they survive a round trip. */
  x?: Record<string, unknown>;
}

// Rolling digest of the oldest messages in a conversation. Once created, the
// summary replaces the messages it covers in the LLM prompt so long chats
// keep their early content as a compact digest instead of forgetting it.
export interface ContextSummary {
  text: string;
  coversMessageCount: number; // number of leading messages folded into the summary
  updatedAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  contextSummary?: ContextSummary;
  /** Quo Sync: fields other apps put on this chat, kept so they survive a round trip. */
  x?: Record<string, unknown>;
}

export interface AppSettings {
  modelId: string; // ID from AVAILABLE_MODELS
  modelName: string; // Display name
  temperature: number;
  maxTokens: number;
  darkMode: boolean;
  showGenerationStats?: boolean;
  enableThinking?: boolean;
  enableSpeculative?: boolean; // Draft-model speed boost (experimental)
}

/** Receives the full visible text so far on each update, then ('', true) at the end. */
export type StreamCallback = (text: string, done: boolean) => void;

