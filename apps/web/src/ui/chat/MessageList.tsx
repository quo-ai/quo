import { Fragment, useEffect, useMemo, useState, type RefObject, type UIEvent } from 'react';
import { Brain, Check, Copy, CornerUpLeft, Layers, Pencil, RotateCcw, Undo2, Volume2, VolumeX } from 'lucide-react';
import type { CodeSession } from '../../agent/session';
import { laterMessages } from '../../chat/rewind';
import type { Message } from '../../chat/types';
import type { ModelChoice } from '../../models';
import { isClaudeAgent } from '../../providers/claudeAgent';
import { greeting, pickStarters, type StarterMode } from '../../chat/starters';
import { workingLabel } from '../../chat/working';
import { canSpeak } from '../../voice/readAloud';
import { AgentSteps } from '../AgentSteps';
import { EditMessage } from './EditMessage';
import { MessageAttachments } from '../Attachments';
import { Markdown } from '../Markdown';
import { GeneratedImages } from './GeneratedImages';
import { Sources } from './Sources';
import { QuoMark } from '../QuoMark';
import { toast } from '../Toasts';
import { FailureCard } from './FailureCard';
import type { ChatAction, Failure, Undoable } from './types';
import { useReadAloud } from './useReadAloud';
import { ModelChange, ReplyWhere, moves, whereOf } from './Where';

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
  /** Send an earlier message again, edited: the messages after it go (Chat.tsx). */
  onEdit: (messageId: string, text: string) => void;
  /** Go back to an earlier reply: the messages after it go, with a moment to undo. */
  onGoBack: (messageId: string) => void;
  /** Code mode could start here (the desktop app, a model that can use tools): starters mix in things to build. */
  canBuild?: boolean;
  onAction: (action: ChatAction) => void;
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
    if (isClaudeAgent(choice.provider)) return `${choice.model.name} runs through your Claude Code login, on your Claude plan. Your messages go from this computer to Anthropic, not through Quo.`;
    const where = choice.provider.custom ? `on ${choice.provider.name}, a server of your own` : `on your ${choice.provider.name} account`;
    return `${choice.model.name} runs ${where}. Your messages go straight from this computer to ${choice.provider.name}, not through Quo.`;
  }
  if (choice.kind === 'cloud') return `${choice.model.name} answers in the cloud${choice.model.free ? ', free every day' : ''}. For complete privacy, switch to an offline model anytime.`;
  return `${choice.model.name} runs on this device. Nothing you type leaves it.${choice.kind === 'local' && choice.model.vision ? ' Attach photos and documents with the paperclip.' : ''}`;
}

/** The conversation: a greeting with starters when it's empty, then every message, then a failed turn's next steps. */
export function MessageList({ conversationId, messages, busy, choice, code, failure, offlineReady, signedIn, undo, scroller, onScroll, onSuggest, onRetry, onUndo, onEdit, onGoBack, canBuild = false, onAction }: MessageListProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => setEditingId(null), [conversationId]);
  const speech = useReadAloud(conversationId);
  const lastId = messages[messages.length - 1]?.id;
  const moved = useMemo(() => moves(messages), [messages]);
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
    <div className={`messages${messages.length === 0 ? ' empty' : ''}`} ref={scroller} onScroll={onScroll}>
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
          const move = moved.get(message.id);
          return (
            <Fragment key={message.id}>
              {move && <ModelChange move={move} />}
              <article className="msg user">
                <MessageAttachments items={message.attachments ?? []} />
                {editingId === message.id && !busy
                  ? (
                    <EditMessage
                      initial={message.content}
                      later={laterMessages(messages, messages.indexOf(message))}
                      onCancel={() => setEditingId(null)}
                      onSend={text => {
                        setEditingId(null);
                        onEdit(message.id, text);
                      }}
                    />
                  )
                  : (
                    <>
                      {message.content && <div className="bubble">{message.content}</div>}
                      {!busy && message.content && (
                        <div className="msg-actions">
                          <button className="icon-btn press" onClick={() => setEditingId(message.id)} aria-label="Edit this message" title="Edit, and go on from here">
                            <Pencil size={15} />
                          </button>
                          <button className="icon-btn press" onClick={() => void copy(message)} aria-label="Copy message" title="Copy">
                            {copiedId === message.id ? <Check size={16} color="var(--indigo)" /> : <Copy size={15} />}
                          </button>
                        </div>
                      )}
                    </>
                  )}
              </article>
            </Fragment>
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
          <article key={message.id} className={`msg assistant${isLast ? ' last' : ''}${streaming ? ' live' : ''}${streaming && message.content ? ' streaming' : ''}`} data-where={whereOf(message)}>
            {message.steps?.length ? <AgentSteps steps={message.steps} live={streaming} /> : null}
            {undo?.messageId === message.id && !busy && (
              <button type="button" className="chip undo-chip press" onClick={onUndo} title="Put the files back the way they were before this reply">
                <Undo2 size={14} /> Undo {undo.count === 1 ? 'the change' : `${undo.count} changes`}
              </button>
            )}
            {message.reasoning && (
              <details className={`reasoning${streaming && !message.content ? ' thinking' : ''}`} open={!message.content}>
                <summary><Brain size={14} /> {message.content ? 'Thought process' : 'Thinking…'}</summary>
                <Markdown text={message.reasoning} muted live={streaming && !message.content} />
              </details>
            )}
            {message.content
              ? <Markdown text={message.content} live={streaming} />
              : streaming && !message.reasoning && !message.images?.length && !message.steps?.some(step => step.status === 'running') && <div className="typing" role="status" aria-label={workingLabel(message) || 'Working'}><span className="bar" /><span className="block" /><span className="typing-label">{workingLabel(message)}</span></div>}
            {message.images?.length ? <GeneratedImages images={message.images} /> : null}
            {!streaming && message.sources?.length ? <Sources sources={message.sources} /> : null}
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
                {!isLast && !busy && (
                  <button className="icon-btn press" onClick={() => onGoBack(message.id)} aria-label="Go back to this reply" title="Go back to here: the messages after this reply are removed">
                    <CornerUpLeft size={15} />
                  </button>
                )}
                <ReplyWhere message={message} />
              </div>
            )}
          </article>
        );
      })}

      {failure && !busy && <FailureCard failure={failure} offlineReady={offlineReady} signedIn={signedIn} onAction={onAction} onRetry={onRetry} />}
    </div>
  );
}
