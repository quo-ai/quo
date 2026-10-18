import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { titleFrom } from '../chat/store';
import { newId, type Attachment, type Conversation, type Message } from '../chat/types';
import { replyInCloud, replyOffline, replyOwn, replyWithAgent, type ReplyTarget } from '../chat/replies';
import { ApiError } from '../cloud/api';
import type { Account } from '../cloud/account';
import { stopCloud } from '../cloud/cloudEngine';
import { localEngine } from '../engine/localEngine';
import { stopOwn } from '../providers/generate';
import { agentBridge, NativeError } from '../native';
import type { ModelChoice } from '../models';
import { beginGeneration, endGeneration } from '../sync';
import { Composer, type ComposerHandle } from './chat/Composer';
import { MessageList } from './chat/MessageList';
import type { ChatAction, ChatStatus, Failure, Undoable } from './chat/types';
import { useCodeMode } from './chat/useCodeMode';
import { toast } from './Toasts';

export type { ChatAction } from './chat/types';

export interface ChatHandle {
  focus: () => void;
}

interface ChatProps {
  choice: ModelChoice | null;
  account: Account | null;
  /** True when an offline model is installed and could take over. */
  offlineReady: boolean;
  conversation: Conversation | null;
  /** `persist` is false for streaming updates, true once a turn settles;
   *  `created` is true only for the call that starts a new conversation. */
  onChange: (conversation: Conversation, persist: boolean, created?: boolean) => void;
  onAction: (action: ChatAction) => void;
}

/** The chat screen: the conversation, the message box, and the turn that connects them to a model. */
export const Chat = forwardRef<ChatHandle, ChatProps>(function Chat(
  { choice, account, offlineReady, conversation, onChange, onAction },
  ref,
) {
  const [thinking, setThinking] = useState(false);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [undo, setUndo] = useState<Undoable | null>(null);
  const agentRun = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const stickToBottom = useRef(true);
  const messages = conversation?.messages ?? [];
  const busy = status !== 'idle';
  const cloud = choice?.kind === 'cloud';
  const codeMode = useCodeMode({ available: Boolean(agentBridge()) && (choice?.kind === 'cloud' || choice?.kind === 'own') && choice.model.agent, conversationId: conversation?.id, modelId: choice?.model.id });
  const { code } = codeMode;

  useImperativeHandle(ref, () => ({ focus: () => composer.current?.focus() }), []);

  // Follow the stream only while the user is at the bottom.
  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, failure]);

  useEffect(() => {
    setFailure(null);
    setUndo(null);
    stickToBottom.current = true;
  }, [conversation?.id]);
  useEffect(() => setUndo(null), [code]);

  const stop = () => {
    stopCloud();
    stopOwn();
    agentRun.current?.abort();
    code?.stop();
    void localEngine.stop();
  };

  // Esc stops a reply in progress.
  useEffect(() => {
    if (!busy) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') stop();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy]);

  async function run(base: Conversation | null, userText: string, created: boolean, sent: Attachment[] = []) {
    if (!choice) return;
    setFailure(null);
    setUndo(null);
    stickToBottom.current = true;
    const now = Date.now();
    const user: Message = { id: newId(), role: 'user', content: userText, ...(sent.length ? { attachments: sent } : {}) };
    const assistant: Message = { id: newId(), role: 'assistant', content: '', modelId: choice.model.id, modelName: choice.model.name, cloud, ...(choice.kind === 'own' ? { own: choice.provider.name } : {}) };
    let current: Conversation = base
      ? { ...base, updatedAt: now, messages: [...base.messages, user, assistant] }
      : { id: newId(), title: titleFrom(userText || sent[0]?.name || 'New chat'), createdAt: now, updatedAt: now, messages: [user, assistant] };
    const update = (patch: Partial<Message>, persist: boolean) => {
      current = { ...current, messages: current.messages.map(m => (m.id === assistant.id ? { ...m, ...patch } : m)) };
      onChange(current, persist);
    };
    onChange(current, true, created);
    const target: ReplyTarget = { prior: current.messages.filter(m => m.id !== assistant.id), update, setStatus };

    beginGeneration(); // Quo Sync waits until the reply is finished
    try {
      if ((choice.kind === 'cloud' || choice.kind === 'own') && code && choice.model.agent) {
        setStatus('generating');
        const controller = new AbortController();
        agentRun.current = controller;
        try {
          const changes = await replyWithAgent(choice, code, controller.signal, target);
          if (changes > 0) setUndo({ messageId: assistant.id, count: changes });
        } finally {
          agentRun.current = null;
        }
      } else if (choice.kind === 'cloud') {
        await replyInCloud(choice, thinking, target);
      } else if (choice.kind === 'own') {
        await replyOwn(choice, target);
      } else {
        await replyOffline(choice, thinking, target);
      }
    } catch (err) {
      if (!(err instanceof ApiError)) console.error(err);
      setFailure(err instanceof ApiError
        ? { code: err.code, message: err.message }
        : err instanceof NativeError && err.code !== 'failed'
          ? { code: 'local_failed', message: err.message }
          : { code: 'local_failed', message: 'The model couldn’t answer. Try a smaller model, or reload the page.' });
      current = { ...current, messages: current.messages.filter(m => m.id !== assistant.id || m.content || m.steps?.length) };
      onChange(current, true);
    } finally {
      endGeneration();
      setStatus('idle');
    }
  }

  /** Puts the files back the way they were before the latest reply, and says what happened. */
  async function takeBack() {
    if (!code || !undo) return;
    try {
      const { restored, skipped } = await code.undo(undo.count);
      setUndo(null);
      const left = skipped.length ? ` ${skipped.join(', ')} changed since, so ${skipped.length === 1 ? 'it was' : 'they were'} left alone.` : '';
      toast(restored.length ? `Put back ${restored.join(', ')}.${left}` : `Nothing was put back.${left}`);
    } catch (error) {
      toast(error instanceof NativeError ? error.message : 'Couldn’t undo that.');
    }
  }

  /** Regenerates the last reply (or retries a failed turn) with the current model. */
  function retry() {
    if (!conversation || busy) return;
    const list = conversation.messages;
    const lastUserIndex = list.map(m => m.role).lastIndexOf('user');
    if (lastUserIndex < 0) return;
    void run({ ...conversation, messages: list.slice(0, lastUserIndex) }, list[lastUserIndex].content, false, list[lastUserIndex].attachments);
  }

  const send = (text: string, attachments: Attachment[] = []) => {
    if (busy || !choice) return;
    void run(conversation, text, !conversation, attachments);
  };

  return (
    <>
      <MessageList
        conversationId={conversation?.id}
        messages={messages}
        busy={busy}
        choice={choice}
        code={code}
        failure={failure}
        offlineReady={offlineReady}
        signedIn={Boolean(account?.user)}
        undo={undo}
        scroller={scroller}
        onScroll={event => {
          const el = event.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        onSuggest={send}
        onRetry={retry}
        onUndo={() => void takeBack()}
        onAction={onAction}
      />
      <Composer
        ref={composer}
        choice={choice}
        status={status}
        conversationId={conversation?.id}
        codeMode={codeMode}
        thinking={thinking}
        onThinking={setThinking}
        freeLeft={cloud && choice.model.free && account ? account.free.remaining : null}
        onSend={send}
        onStop={stop}
      />
    </>
  );
});
