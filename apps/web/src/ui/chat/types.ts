/** What the chat screen can ask the app to do next, from a failed turn's buttons. */
export type ChatAction = 'use-offline' | 'use-free' | 'get-pro' | 'top-up' | 'sign-in' | 'keys';

export interface Failure {
  code: string;
  message: string;
}

export type ChatStatus = 'idle' | 'loading' | 'generating';

/** The agent's changes in the latest Code-mode reply, which can still be taken back. */
export interface Undoable {
  messageId: string;
  count: number;
}
