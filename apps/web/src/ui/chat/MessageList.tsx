import { useMemo, useState, type RefObject, type UIEvent } from 'react';
import { Brain, Check, Copy, Layers, RotateCcw, Undo2, Volume2, VolumeX } from 'lucide-react';
import type { CodeSession } from '../../agent/session';
import type { Message } from '../../chat/types';
import type { ModelChoice } from '../../models';
import { reliabilityNote } from '../../chat/reliability';
import { greeting, pickStarters, type StarterMode } from '../../chat/starters';
import { workingLabel } from '../../chat/working';
import { canSpeak } from '../../voice/readAloud';
import { AgentSteps } from '../AgentSteps';
import { MessageAttachments } from '../Attachments';
import { Markdown } from '../Markdown';
import { QuoMark } from '../QuoMark';
import { toast } from '../Toasts';
import { FailureCard } from './FailureCard';
import type { ChatAction, Failure, Undoable } from './types';
import { useReadAloud } from './useReadAloud';

interface MessageListProps {
  conversationId: string | undefined;
  messages: Message[];
  busy: boolean;
  choice: ModelChoice | null;
  code: CodeSession | null;
  failure: Failure | null;
  offlineReady: boolean;
  signedIn: boolean;
  undo: Undoable | null;
  scroller: RefObject<HTMLDivElement | null>;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  onSuggest: (prompt: string) => void;
  onRetry: () => void;
  onUndo: () => void;
  /** Code mode could start here (the desktop app, a model that can use tools): starters mix in things to build. */
  canBuild?: boolean;
  onAction: (action: ChatAction) => void;
}

const formatTokens = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function replyMeta(message: Message): string {
  if (message.stopped) return 'Stopped';
  if (message.own) {
    const steps = message.steps?.length ? ` · ${message.steps.length} step${message.steps.length === 1 ? '' : 's'}` : '';
    const tokens = message.usage ? ` · ${formatTokens(message.usage.input + message.usage.output)} tokens` : '';
    return `${message.modelName ?? 'Model'}${steps} · your ${message.own} key${tokens}`;
  }
  if (message.cloud) {
    const cost = message.charged ? `${message.charged} credit${message.charged === 1 ? '' : 's'}` : 'Free';
    const steps = message.steps?.length ? ` · ${message.steps.length} step${message.steps.length === 1 ? '' : 's'}` : '';
    return `${message.modelName ?? 'Cloud'}${steps} · ${cost}`;
  }
  const caution = reliabilityNote(message.modelId);
  if (message.steps?.length) return `${message.modelName ?? 'Offline model'} · ${message.steps.length} step${message.steps.length === 1 ? '' : 's'} · on this computer${caution ? ` · ${caution}` : ''}`;
  const speed = message.stats && message.stats.tokens > 1 ? `${message.stats.tokensPerSecond.toFixed(1)} tokens/s` : '';
  return [speed, caution].filter(Boolean).join(' · ');
}

function intro(choice: ModelChoice | null, code: CodeSession | null): string {
  if (!choice) return 'Choose a model to start.';
  if (code) {
    const notes = code.info.instructions ? ` It follows the notes in ${code.info.instructions.file}.` : '';
    const privacy = choice.kind === 'local' ? ` ${choice.model.name} runs here, so your code never leaves this computer.` : '';
    const git = code.info.git?.branch ? ` (on ${code.info.git.branch}${code.info.git.changed ? `, ${code.info.git.changed} changed file${code.info.git.changed === 1 ? '' : 's'}` : ''})` : '';
    return `Working in ${code.project.name}${git}.${notes}${privacy} Ask about the code, or ask for a change. ${code.plan ? 'Plan mode is on: nothing is changed or run.' : 'Nothing is changed or run without your OK.'}`;
  }
  if (choice.kind === 'own') {
    const where = choice.provider.custom ? `on ${choice.provider.name}, a server of your own` : `on your ${choice.provider.name} account`;
    return `${choice.model.name} runs ${where}. Your messages go straight from this computer to ${choice.provider.name}, not through Quo.`;
  }
  if (choice.kind === 'cloud') return `${choice.model.name} answers in the cloud${choice.model.free ? ', free every day' : ''}. For complete privacy, switch to an offline model anytime.`;
  return `${choice.model.name} runs on this device. Nothing you type leaves it.${choice.kind === 'local' && choice.model.vision ? ' Attach photos and documents with the paperclip.' : ''}`;
}

/** The conversation: a greeting with starters when it's empty, then every message, then a failed turn's next steps. */
export function MessageList({ conversationId, messages, busy, choice, code, failure, offlineReady, signedIn, undo, scroller, onScroll, onSuggest, onRetry, onUndo, canBuild = false, onAction }: MessageListProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const speech = useReadAloud(conversationId);
  const lastId = messages[messages.length - 1]?.id;
  // A new set of starters for each empty chat, steady while it is on screen (the memo only changes with the chat or where it is).
  const empty = messages.length === 0;
  const mode: StarterMode = code ? 'project' : canBuild ? 'mixed' : 'chat';
  const hello = useMemo(() => {
    const seed = `${conversationId ?? 'new'}:${Math.random().toString(36).slice(2)}`;
    return { title: greeting(new Date(), seed, Boolean(code)), starters: pickStarters(mode, seed) };
  }, [conversationId, mode, empty]); // eslint-disable-line react-hooks/exhaustive-deps

  async function copy(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      setTimeout(() => setCopiedId(id => (id === message.id ? null : id)), 1500);
    } catch {
      toast('Couldn’t copy. Select the text and copy it instead.');
    }
  }

  return (
    <div className="messages" ref={scroller} onScroll={onScroll}>
      {messages.length === 0 && (
        <div className="hello">
          <QuoMark />
          <h1>{hello.title}</h1>
          <p>{intro(choice, code)}</p>
          <div className="suggestions">
            {hello.starters.map((s, index) => (
              <button key={s.title} className="suggestion glass press" style={{ '--i': index } as React.CSSProperties} onClick={() => onSuggest(s.prompt)} disabled={busy || !choice}>
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
              <MessageAttachments items={message.attachments ?? []} />
              {message.content && <div className="bubble">{message.content}</div>}
            </article>
          );
        }
        if (message.summary) {
          return (
            <details key={message.id} className="summary-note">
              <summary><Layers size={14} /> Earlier messages summarised</summary>
              <Markdown text={message.content} muted />
            </details>
          );
        }
        const streaming = isLast && busy;
        return (
          <article key={message.id} className={`msg assistant${isLast ? ' last' : ''}${streaming && message.content ? ' streaming' : ''}`}>
            {message.steps?.length ? <AgentSteps steps={message.steps} live={streaming} /> : null}
            {undo?.messageId === message.id && !busy && (
              <button type="button" className="chip undo-chip press" onClick={onUndo} title="Put the files back the way they were before this reply">
                <Undo2 size={14} /> Undo {undo.count === 1 ? 'the change' : `${undo.count} changes`}
              </button>
            )}
            {message.reasoning && (
              <details className={`reasoning${streaming && !message.content ? ' thinking' : ''}`} open={!message.content}>
                <summary><Brain size={14} /> {message.content ? 'Thought process' : 'Thinking…'}</summary>
                <Markdown text={message.reasoning} muted />
              </details>
            )}
            {message.content
              ? <Markdown text={message.content} />
              : streaming && !message.reasoning && !message.steps?.some(step => step.status === 'running') && <div className="typing" role="status" aria-label={workingLabel(message) || 'Working'}><span className="bar" /><span className="block" /><span className="typing-label">{workingLabel(message)}</span></div>}
            {!streaming && message.content && (
              <div className="msg-actions">
                <button className="icon-btn press" onClick={() => void copy(message)} aria-label="Copy reply" title="Copy">
                  {copiedId === message.id ? <Check size={16} color="var(--indigo)" /> : <Copy size={15} />}
                </button>
                {speech.voicesReady && canSpeak() && (
                  <button className="icon-btn press" onClick={() => speech.toggle(message)} aria-label={speech.speakingId === message.id ? 'Stop reading' : 'Read aloud'} title={speech.speakingId === message.id ? 'Stop reading' : 'Read aloud'}>
                    {speech.speakingId === message.id ? <VolumeX size={15} color="var(--indigo)" /> : <Volume2 size={15} />}
                  </button>
                )}
                {isLast && (
                  <button className="icon-btn press" onClick={onRetry} aria-label="Try again" title="Try again">
                    <RotateCcw size={15} />
                  </button>
                )}
                <span className="msg-meta">{replyMeta(message)}</span>
              </div>
            )}
          </article>
        );
      })}

      {failure && !busy && <FailureCard failure={failure} offlineReady={offlineReady} signedIn={signedIn} onAction={onAction} onRetry={onRetry} />}
    </div>
  );
}
