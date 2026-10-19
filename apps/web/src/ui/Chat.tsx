import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { titleFrom } from '../chat/store';
import { newId, type Attachment, type Conversation, type Message } from '../chat/types';
import { AGENT_CONTEXT } from '../agent/local';
import { rememberChatProject } from '../agent/session';
import { modelMessages, summarize } from '../chat/summary';
import { autoSummarize, MIN_MESSAGES, SUMMARIZE_AT } from '../context/settings';
import { contextUsage, ratio, type ContextMode } from '../context/usage';
import { replyInCloud, replyOffline, replyOwn, replyWithAgent, replyWithWeb, type ReplyTarget } from '../chat/replies';
import { ApiError } from '../cloud/api';
import type { Account } from '../cloud/account';
import { stopCloud } from '../cloud/cloudEngine';
import { localEngine } from '../engine/localEngine';
import { reportNetworkFailure } from '../net/status';
import { stopOwn } from '../providers/generate';
import { codeSupport } from '../agent/support';
import { NativeError } from '../native';
import type { ModelChoice } from '../models';
import { beginGeneration, endGeneration } from '../sync';
import { Composer, type ComposerHandle } from './chat/Composer';
import { MessageList } from './chat/MessageList';
import type { ChatAction, ChatStatus, Failure, Undoable } from './chat/types';
import { buildCommands } from './chat/useCommands';
import { useCodeMode } from './chat/useCodeMode';
import { useWebMode } from './chat/useWebMode';
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
  /** A turn failed. Returns true if the chat was moved to another model (which is when the message runs again). */
  onFailure?: (failure: Failure) => boolean;
}

/** The chat screen: the conversation, the message box, and the turn that connects them to a model. */
export const Chat = forwardRef<ChatHandle, ChatProps>(function Chat(
  { choice, account, offlineReady, conversation, onChange, onAction, onFailure },
  ref,
) {
  const [thinking, setThinking] = useState(false);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [undo, setUndo] = useState<Undoable | null>(null);
  const agentRun = useRef<AbortController | null>(null);
  const runAgain = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const stickToBottom = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const messages = conversation?.messages ?? [];
  const busy = status !== 'idle';
  const cloud = choice?.kind === 'cloud';
  const codeMode = useCodeMode({ support: codeSupport(choice), conversationId: conversation?.id, modelId: choice?.model.id });
  const { code } = codeMode;
  const web = useWebMode(choice, Boolean(code), conversation?.id);
  // How full the model's memory is: counted live while it works, estimated from the messages otherwise.
  const [live, setLive] = useState<{ tokens: number; exact: boolean } | null>(null);
  const mode: ContextMode = code ? 'code' : web.on && web.how === 'tools' ? 'web' : 'chat';
  const usage = contextUsage(choice, mode, modelMessages(messages), live);

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
    if (code) rememberChatProject(current.id, code.project.id);
    const target: ReplyTarget = { prior: modelMessages(current.messages.filter(m => m.id !== assistant.id)), update, setStatus, onContext: (tokens, exact) => setLive({ tokens, exact }) };

    beginGeneration(); // Quo Sync waits until the reply is finished
    try {
      const searching = web.on && web.how === 'tools';
      if (code && (choice.kind === 'local' || choice.model.agent)) {
        setStatus('generating');
        const controller = new AbortController();
        agentRun.current = controller;
        code.webOn = searching;
        try {
          const changes = await replyWithAgent(choice, code, controller.signal, target);
          if (changes > 0) setUndo({ messageId: assistant.id, count: changes });
        } finally {
          agentRun.current = null;
        }
      } else if (searching && (choice.kind === 'own' || choice.kind === 'local') && sent.length === 0) {
        // Web search with a model that calls tools. (A message with photos or documents goes the ordinary way.)
        setStatus('generating');
        const controller = new AbortController();
        agentRun.current = controller;
        try {
          await replyWithWeb(choice, current.id, controller.signal, target);
        } finally {
          agentRun.current = null;
        }
      } else if (choice.kind === 'cloud') {
        const searched = await replyInCloud(choice, thinking, target, { web: web.on && web.how === 'native' });
        if (searched === 'limit') toast('Today’s free web searches are used up, so Quo answered without searching.');
      } else if (choice.kind === 'own') {
        await replyOwn(choice, target, { web: web.on && web.how === 'native' });
      } else {
        await replyOffline(choice, thinking, target);
      }
    } catch (err) {
      if (!(err instanceof ApiError)) console.error(err);
      const failed: Failure = err instanceof ApiError
        ? { code: err.code, message: err.message }
        : err instanceof NativeError && err.code !== 'failed'
          ? { code: 'local_failed', message: err.message }
          : { code: 'local_failed', message: 'The model couldn’t answer. Try a smaller model, or reload the page.' };
      setFailure(failed);
      if (failed.code === 'offline' || failed.code === 'provider_unreachable') reportNetworkFailure();
      // The chat may have been moved to the offline model: the message runs again there, once.
      runAgain.current = Boolean(onFailure?.(failed));
      current = { ...current, messages: current.messages.filter(m => m.id !== assistant.id || m.content || m.steps?.length) };
      onChange(current, true);
    } finally {
      endGeneration();
      setLive(null);
      setStatus('idle');
    }
  }

  /** The model writes notes on the conversation, and it goes on from those. Returns the conversation with them added, or null if that failed. */
  async function summarizeConversation(base: Conversation, automatic: boolean): Promise<Conversation | null> {
    if (!choice) return null;
    setStatus('generating');
    beginGeneration();
    try {
      const notes = await summarize(choice, base.messages, { contextSize: code && choice.kind === 'local' ? AGENT_CONTEXT : undefined });
      const note: Message = { id: newId(), role: 'assistant', content: notes, summary: true, modelName: choice.model.name };
      const updated: Conversation = { ...base, updatedAt: Date.now(), messages: [...base.messages, note] };
      onChange(updated, true);
      toast(automatic ? 'The memory was nearly full, so Quo summarised the earlier messages.' : 'Summarised. The conversation goes on from the notes.');
      return updated;
    } catch (error) {
      toast(error instanceof ApiError || error instanceof NativeError || error instanceof Error ? error.message : 'Couldn’t summarise the conversation.');
      return null;
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

  // Moved to another model after a failure: run the message again on it.
  const modelId = choice?.model.id;
  useEffect(() => {
    if (!runAgain.current) return;
    runAgain.current = false;
    retry();
  }, [modelId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Regenerates the last reply (or retries a failed turn) with the current model. */
  function retry() {
    if (!conversation || busy) return;
    const list = conversation.messages;
    const lastUserIndex = list.map(m => m.role).lastIndexOf('user');
    if (lastUserIndex < 0) return;
    void run({ ...conversation, messages: list.slice(0, lastUserIndex) }, list[lastUserIndex].content, false, list[lastUserIndex].attachments);
  }

  async function copyLast() {
    const reply = [...messages].reverse().find(m => m.role === 'assistant' && !m.summary && m.content);
    if (!reply) return;
    try {
      await navigator.clipboard.writeText(reply.content);
      toast('Copied the last reply');
    } catch {
      toast('Couldn’t copy. Select the text and copy it instead.');
    }
  }

  const commands = buildCommands(
    {
      busy,
      hasUserMessage: messages.some(m => m.role === 'user'),
      hasReply: messages.some(m => m.role === 'assistant' && !m.summary && m.content),
      codeAvailable: codeMode.available,
      codeOn: Boolean(code),
      plan: codeMode.plan,
      webAvailable: web.usable,
      webOn: web.on,
      canThink: Boolean(choice && choice.kind !== 'own' && choice.model.supportsThinking && !code && !(web.on && web.how === 'tools')),
      thinking,
      canSummarize: Boolean(conversation) && modelMessages(messages).length >= 2,
      canUndo: Boolean(undo) && !busy,
    },
    {
      newChat: () => onAction('new-chat'),
      stop,
      retry,
      copy: () => void copyLast(),
      summarize: () => conversation && void summarizeConversation(conversation, false),
      toggleCode: () => void codeMode.toggle(),
      togglePlan: () => void codeMode.togglePlan(),
      toggleWeb: web.toggle,
      toggleThinking: () => setThinking(on => !on),
      undo: () => void takeBack(),
      chooseFolder: () => void codeMode.changeFolder(),
      models: () => onAction('models'),
      keys: () => onAction('keys'),
    },
  );

  const send = async (text: string, attachments: Attachment[] = []) => {
    if (busy || !choice) return;
    let base = conversation;
    // Nearly full: make room first, as the person chose (it can be turned off in the memory menu).
    const full = usage ? ratio(usage) : null;
    if (base && autoSummarize() && full !== null && full >= SUMMARIZE_AT && modelMessages(base.messages).length >= MIN_MESSAGES) base = (await summarizeConversation(base, true)) ?? base;
    void run(base, text, !conversation, attachments);
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
          setAtBottom(stickToBottom.current);
        }}
        onSuggest={send}
        onRetry={retry}
        onUndo={() => void takeBack()}
        onAction={onAction}
      />
      {!atBottom && messages.length > 0 && (
        <button type="button" className="jump glass thick press" onClick={() => { stickToBottom.current = true; scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }}>
          <ArrowDown size={15} /> Latest
        </button>
      )}
      <Composer
        ref={composer}
        choice={choice}
        status={status}
        conversationId={conversation?.id}
        codeMode={codeMode}
        web={web}
        commands={commands}
        lastUserText={[...messages].reverse().find(m => m.role === 'user')?.content ?? ''}
        context={{ usage, canSummarize: Boolean(conversation) && modelMessages(messages).length >= 2, onSummarize: () => conversation && void summarizeConversation(conversation, false), onNewChat: () => onAction('new-chat') }}
        thinking={thinking}
        onThinking={setThinking}
        freeLeft={cloud && choice.model.free && account ? account.free.remaining : null}
        onSend={send}
        onStop={stop}
      />
    </>
  );
});
