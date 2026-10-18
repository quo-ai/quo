import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AlertCircle, ArrowUp, Brain, Check, Cloud, Copy, HardDrive, RotateCcw, Square } from 'lucide-react';
import { buildContext } from '../chat/context';
import { titleFrom } from '../chat/store';
import { newId, type Conversation, type Message } from '../chat/types';
import { ApiError } from '../cloud/api';
import { accountsEnabled, applyUsage, type Account } from '../cloud/account';
import { generateCloud, stopCloud } from '../cloud/cloudEngine';
import { localEngine } from '../engine/localEngine';
import { CLOUD_CONTEXT, type ModelChoice } from '../models';
import { Markdown } from './Markdown';
import { QuoMark } from './QuoMark';
import { toast } from './Toasts';

const LOCAL_PROMPT = 'You are Quo, a helpful private AI assistant running entirely on the user’s device. Be clear and concise. Use markdown when it helps readability.';
const CLOUD_PROMPT = 'You are Quo, a helpful AI assistant. Be clear and concise. Use markdown when it helps readability.';

// Everyday starters. Never health or medical topics.
const SUGGESTIONS = [
  { title: 'Plan a weekend', detail: 'Two relaxed days in Lisbon', prompt: 'Plan a relaxed two-day weekend in Lisbon with a mix of food, sights and downtime.' },
  { title: 'Write an email', detail: 'Politely reschedule a meeting', prompt: 'Write a short, polite email asking to move tomorrow’s meeting to next week.' },
  { title: 'Explain simply', detail: 'How does Wi-Fi work?', prompt: 'Explain how Wi-Fi works in simple terms, in a few short paragraphs.' },
  { title: 'Brainstorm', detail: 'Names for a coffee cart', prompt: 'Brainstorm ten memorable names for a small coffee cart, with a one-line reason for each.' },
];

export type ChatAction = 'use-offline' | 'use-free' | 'get-pro' | 'top-up' | 'sign-in';

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

interface Failure {
  code: string;
  message: string;
}

export const Chat = forwardRef<ChatHandle, ChatProps>(function Chat(
  { choice, account, offlineReady, conversation, onChange, onAction },
  ref,
) {
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'generating'>('idle');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const messages = conversation?.messages ?? [];
  const busy = status !== 'idle';
  const cloud = choice?.kind === 'cloud';
  const supportsThinking = choice?.model.supportsThinking ?? false;

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  // Follow the stream only while the user is at the bottom.
  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, failure]);

  useEffect(() => {
    setFailure(null);
    stickToBottom.current = true;
    inputRef.current?.focus();
  }, [conversation?.id]);

  // Grow the composer with its content.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [input]);

  const stop = () => {
    stopCloud();
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

  async function run(base: Conversation | null, userText: string, created: boolean) {
    if (!choice) return;
    setFailure(null);
    stickToBottom.current = true;
    const now = Date.now();
    const user: Message = { id: newId(), role: 'user', content: userText };
    const assistant: Message = { id: newId(), role: 'assistant', content: '', modelId: choice.model.id, modelName: choice.model.name, cloud };
    let current: Conversation = base
      ? { ...base, updatedAt: now, messages: [...base.messages, user, assistant] }
      : { id: newId(), title: titleFrom(userText), createdAt: now, updatedAt: now, messages: [user, assistant] };
    const update = (patch: Partial<Message>, persist: boolean) => {
      current = { ...current, messages: current.messages.map(m => (m.id === assistant.id ? { ...m, ...patch } : m)) };
      onChange(current, persist);
    };
    onChange(current, true, created);
    const prior = current.messages.filter(m => m.id !== assistant.id);

    try {
      if (choice.kind === 'cloud') {
        setStatus('generating');
        const history = buildContext(CLOUD_PROMPT, prior, CLOUD_CONTEXT.contextSize, CLOUD_CONTEXT.maxTokens);
        const result = await generateCloud(choice.model.id, history, {
          thinking,
          onUpdate: ({ content, reasoning }) => update({ content, reasoning }, false),
        });
        applyUsage(result);
        update({ content: result.content, reasoning: result.reasoning || undefined, stopped: result.stopped || undefined, charged: result.charged }, true);
      } else {
        const model = choice.model;
        const history = buildContext(LOCAL_PROMPT, prior, model.contextSize, model.maxTokens);
        if (localEngine.modelId !== model.id) setStatus('loading');
        await localEngine.load(model);
        setStatus('generating');
        const result = await localEngine.generate(model, history, {
          thinking,
          onUpdate: ({ content, reasoning }) => update({ content, reasoning }, false),
        });
        update({
          content: result.content,
          reasoning: result.reasoning || undefined,
          stopped: result.stopped || undefined,
          stats: { tokens: result.tokens, tokensPerSecond: result.tokensPerSecond, timeToFirstTokenMs: result.timeToFirstTokenMs },
        }, true);
      }
    } catch (err) {
      if (!(err instanceof ApiError)) console.error(err);
      setFailure(err instanceof ApiError
        ? { code: err.code, message: err.message }
        : { code: 'local_failed', message: 'The model couldn’t answer. Try a smaller model, or reload the page.' });
      current = { ...current, messages: current.messages.filter(m => m.id !== assistant.id || m.content) };
      onChange(current, true);
    } finally {
      setStatus('idle');
    }
  }

  function send(text = input) {
    const trimmed = text.trim();
    if (!trimmed || busy || !choice) return;
    setInput('');
    void run(conversation, trimmed, !conversation);
  }

  /** Regenerates the last reply (or retries a failed turn) with the current model. */
  function retry() {
    if (!conversation || busy) return;
    const list = conversation.messages;
    const lastUserIndex = list.map(m => m.role).lastIndexOf('user');
    if (lastUserIndex < 0) return;
    void run({ ...conversation, messages: list.slice(0, lastUserIndex) }, list[lastUserIndex].content, false);
  }

  async function copy(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      setTimeout(() => setCopiedId(id => (id === message.id ? null : id)), 1500);
    } catch {
      toast('Couldn’t copy. Select the text and copy it instead.');
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  const info = localEngine.info();
  const lastId = messages[messages.length - 1]?.id;
  const freeLeft = cloud && choice.model.free && account ? account.free.remaining : null;

  return (
    <>
      <div
        className="messages"
        ref={scroller}
        onScroll={event => {
          const el = event.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {messages.length === 0 && (
          <div className="hello">
            <QuoMark />
            <h1>What’s on your mind?</h1>
            <p>{!choice ? 'Choose a model to start.'
              : cloud ? `${choice.model.name} answers in the cloud${choice.model.free ? ', free every day' : ''}. For complete privacy, switch to an offline model anytime.`
                : `${choice.model.name} runs on this device. Nothing you type leaves it.`}</p>
            <div className="suggestions">
              {SUGGESTIONS.map(s => (
                <button key={s.title} className="suggestion glass press" onClick={() => send(s.prompt)} disabled={busy || !choice}>
                  <strong>{s.title}</strong>
                  <span>{s.detail}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(message => {
          const isLast = message.id === lastId;
          if (message.role === 'user') {
            return (
              <article key={message.id} className="msg user">
                <div className="bubble">{message.content}</div>
              </article>
            );
          }
          const streaming = isLast && busy;
          return (
            <article key={message.id} className={`msg assistant${isLast ? ' last' : ''}`}>
              {message.reasoning && (
                <details className="reasoning" open={!message.content}>
                  <summary><Brain size={14} /> {message.content ? 'Thought process' : 'Thinking…'}</summary>
                  <Markdown text={message.reasoning} muted />
                </details>
              )}
              {message.content
                ? <Markdown text={message.content} />
                : streaming && !message.reasoning && <div className="typing" aria-label="Writing"><span /><span /><span /></div>}
              {!streaming && message.content && (
                <div className="msg-actions">
                  <button className="icon-btn press" onClick={() => void copy(message)} aria-label="Copy reply" title="Copy">
                    {copiedId === message.id ? <Check size={16} color="var(--indigo)" /> : <Copy size={15} />}
                  </button>
                  {isLast && (
                    <button className="icon-btn press" onClick={retry} aria-label="Try again" title="Try again">
                      <RotateCcw size={15} />
                    </button>
                  )}
                  <span className="msg-meta">{replyMeta(message)}</span>
                </div>
              )}
            </article>
          );
        })}

        {failure && !busy && (
          <FailureCard failure={failure} offlineReady={offlineReady} signedIn={Boolean(account?.user)} accounts={accountsEnabled(account)} onAction={onAction} onRetry={retry} />
        )}
      </div>

      <div className="composer-wrap">
        <form className="composer glass" onSubmit={event => { event.preventDefault(); send(); }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={choice ? `Message ${choice.model.name}` : 'Choose a model to start'}
            rows={1}
            aria-label="Message"
          />
          <div className="composer-bar">
            {supportsThinking && (
              <button type="button" className="chip press" aria-pressed={thinking} onClick={() => setThinking(t => !t)} title="Reason step by step before answering">
                <Brain size={14} /> Think
              </button>
            )}
            <span className="engine-note">
              {status === 'loading' ? 'Loading model…'
                : cloud ? <><Cloud size={13} /> Cloud{freeLeft !== null ? ` · ${freeLeft} free today` : ''}</>
                  : choice ? <><HardDrive size={13} /> {info?.backend === 'webgpu' ? 'On your GPU' : 'On this device'} · private</> : ''}
            </span>
            <span className="spacer" />
            {busy ? (
              <button key="stop" type="button" className="send stop" onClick={stop} aria-label="Stop (Esc)" title="Stop (Esc)">
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button key="send" type="submit" className="send" disabled={!input.trim() || !choice} aria-label="Send" title="Send (Enter)">
                <ArrowUp size={20} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </form>
        <div className="composer-hint">
          {cloud ? 'Cloud replies via OpenRouter · Quo doesn’t store your messages' : 'Runs privately on this device'} · Enter to send · Shift+Enter for a new line
        </div>
      </div>
    </>
  );
});

function replyMeta(message: Message): string {
  if (message.stopped) return 'Stopped';
  if (message.cloud) {
    const cost = message.charged ? `${message.charged} credit${message.charged === 1 ? '' : 's'}` : 'Free';
    return `${message.modelName ?? 'Cloud'} · ${cost}`;
  }
  return message.stats && message.stats.tokens > 1 ? `${message.stats.tokensPerSecond.toFixed(1)} tokens/s` : '';
}

/** A failed turn with the next sensible step, never a dead end. */
function FailureCard({ failure, offlineReady, signedIn, accounts, onAction, onRetry }: {
  failure: Failure;
  offlineReady: boolean;
  signedIn: boolean;
  /** Sign-in and purchases exist on this server. */
  accounts: boolean;
  onAction: (action: ChatAction) => void;
  onRetry: () => void;
}) {
  const offline = offlineReady && <button className="btn btn-soft press" onClick={() => onAction('use-offline')}><HardDrive size={15} /> Use offline model</button>;
  let title = failure.message;
  let actions: ReactNode;
  switch (failure.code) {
    case 'free_limit':
      title = 'You’ve used today’s free cloud messages.';
      actions = <>{offline}{accounts && <button className="btn btn-primary press" onClick={() => onAction(signedIn ? 'get-pro' : 'sign-in')}>{signedIn ? 'Get Pro' : 'Sign in for more'}</button>}</>;
      break;
    case 'insufficient_credits':
      actions = <><button className="btn btn-primary press" onClick={() => onAction('top-up')}>Get credits</button><button className="btn btn-soft press" onClick={() => onAction('use-free')}>Use the free model</button>{offline}</>;
      break;
    case 'sign_in_required':
      actions = <><button className="btn btn-primary press" onClick={() => onAction('sign-in')}>Sign in</button><button className="btn btn-soft press" onClick={() => onAction('use-free')}>Use the free model</button></>;
      break;
    case 'offline':
      title = offlineReady ? 'You’re offline. Your offline model can keep going.' : 'You’re offline. The offline model will be ready once it finishes downloading.';
      actions = <>{offline}<button className="btn btn-soft press" onClick={onRetry}><RotateCcw size={15} /> Try again</button></>;
      break;
    default:
      actions = <><button className="btn btn-soft press" onClick={onRetry}><RotateCcw size={15} /> Try again</button>{offline}</>;
  }
  return (
    <div className="failure glass thick" role="alert">
      <p><AlertCircle size={17} /> {title}</p>
      <div className="failure-actions">{actions}</div>
    </div>
  );
}
