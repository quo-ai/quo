import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowUp, Loader2, Mic, Paperclip, Square } from 'lucide-react';
import { ACCEPT_DOCUMENTS, ACCEPT_IMAGES } from '../../attachments';
import type { Attachment } from '../../chat/types';
import { localEngine } from '../../engine/localEngine';
import { isClaudeAgent } from '../../providers/claudeAgent';
import type { ModelChoice } from '../../models';
import { AttachmentChips } from '../Attachments';
import { CodeChip } from '../CodeChip';
import type { ThinkChoice } from '../../../shared/thinking';
import { ThinkingMenu } from './ThinkingMenu';
import type { ContextUsage } from '../../context/usage';
import { matchCommands, type Command } from '../../chat/commands';
import { CommandList } from './CommandList';
import { ContextMeter } from './ContextMeter';
import { PlanUsage } from './PlanUsage';
import { MentionList } from './MentionList';
import { useMentions } from './useMentions';
import { useVoiceInput } from '../useVoiceInput';
import type { ChatStatus } from './types';
import type { CodeMode } from './useCodeMode';
import { useAttachments } from './useAttachments';

export interface ComposerHandle {
  focus: () => void;
}

interface ComposerProps {
  /** The model menu, first in the row of controls. */
  modelPicker?: ReactNode;
  choice: ModelChoice | null;
  status: ChatStatus;
  conversationId: string | undefined;
  codeMode: CodeMode;
  /** How full the model's memory is, with what can be done about it. */
  /** The slash commands that apply now, and the last thing the user wrote (an arrow up in an empty box brings it back). */
  commands: Command[];
  lastUserText: string;
  context: { usage: ContextUsage | null; canSummarize: boolean; onSummarize: () => void; onNewChat: () => void };
  thinking: ThinkChoice;
  /** What this model really offers; nothing to show when it is fewer than two. */
  thinkingLevels: ThinkChoice[];
  onThinking: (level: ThinkChoice) => void;
  /** Free cloud messages left today, when the model is the free one. */
  freeLeft: number | null;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
}

/** The message box and the row of controls under it. */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { modelPicker, choice, status, conversationId, codeMode, context, commands, lastUserText, thinking, thinkingLevels, onThinking, freeLeft, onSend, onStop },
  ref,
) {
  const [input, setInput] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = status !== 'idle';
  const cloud = choice?.kind === 'cloud';
  const remote = choice !== null && choice.kind !== 'local';
  // Images go to a model that reads them: an offline one marked so, a cloud one the server marks so, and models reached
  // with the person's own key (Claude Agent always; another provider says so itself if its model can't). Documents go
  // to every model, as text in the message. To any model but an offline one, they leave this computer with the message.
  const vision = choice?.kind === 'local' ? Boolean(choice.model.vision) : choice?.kind === 'cloud' ? Boolean(choice.model.vision) : choice?.kind === 'own';
  const files = useAttachments({ enabled: Boolean(choice), vision, resetKey: conversationId });
  const destination = choice?.kind === 'own' ? (isClaudeAgent(choice.provider) ? 'Anthropic' : choice.provider.name) : choice?.kind === 'cloud' ? `${choice.model.provider}, through OpenRouter` : '';
  const { code } = codeMode;
  // Code mode: the desktop app, with a model that can do it (see agent/support.ts).
  const codeAvailable = codeMode.available;

  const voice = useVoiceInput(text => {
    setInput(current => (current.trim() ? `${current.trimEnd()} ${text}` : text));
    inputRef.current?.focus();
  });

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);
  useEffect(() => inputRef.current?.focus(), [conversationId]);

  // Grow the composer with its content.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [input]);

  // Esc cancels a recording.
  useEffect(() => {
    if (voice.state !== 'recording') return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') voice.cancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [voice]);

  const mentions = useMentions({ code, input, setInput, inputRef });
  const slash = matchCommands(input, commands);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashClosed, setSlashClosed] = useState(false);
  useEffect(() => {
    setSlashIndex(0);
    setSlashClosed(false);
  }, [input]);
  const slashOpen = slash.length > 0 && !slashClosed;

  function runCommand(command: Command) {
    if (command.fills) {
      setInput(command.fills);
      inputRef.current?.focus();
      return;
    }
    setInput('');
    command.run();
  }

  function send() {
    const trimmed = input.trim();
    if ((!trimmed && !files.attachments.length) || busy || !choice) return;
    const sent = files.attachments;
    setInput('');
    files.clear();
    onSend(trimmed, sent);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentions.onKey(event)) return;
    if (slashOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        return setSlashIndex(i => (i + (event.key === 'ArrowDown' ? 1 : slash.length - 1)) % slash.length);
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault();
        return runCommand(slash[slashIndex]);
      }
      if (event.key === 'Escape') return setSlashClosed(true);
    }
    // Shift+Tab switches plan mode in Code mode; an arrow up in an empty box brings back the last message.
    if (event.key === 'Tab' && event.shiftKey && code) {
      event.preventDefault();
      return void codeMode.togglePlan();
    }
    if (event.key === 'ArrowUp' && !input && lastUserText && !event.shiftKey) {
      event.preventDefault();
      return setInput(lastUserText);
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  const info = localEngine.info();

  return (
    <div className="composer-wrap">
      {codeMode.caution && codeMode.gate && (
        <div className="code-caution glass thick" role="alert">
          <p><AlertTriangle size={16} /> <span><strong>{codeMode.gate.name}</strong> for Code mode: {codeMode.gate.note} You still approve every change and command.</span></p>
          <div className="code-caution-actions">
            <button type="button" className="btn btn-ghost press small" onClick={codeMode.dismissCaution}>Not now</button>
            <button type="button" className="btn btn-glass press small" onClick={() => void codeMode.confirmCaution()}>Turn on anyway</button>
          </div>
        </div>
      )}
      {slashOpen && <CommandList items={slash} index={slashIndex} onHover={setSlashIndex} onRun={runCommand} />}
      <MentionList items={mentions.items} index={mentions.index} onHover={mentions.setIndex} onPick={mentions.choose} />
      <form className={`composer glass${files.dragging ? ' dragging' : ''}${busy ? ' busy' : ''}`} data-where={cloud ? 'cloud' : choice?.kind === 'own' ? 'own' : 'device'} onSubmit={event => { event.preventDefault(); send(); }} {...files.dropTarget}>
        <AttachmentChips items={files.attachments} onRemove={files.remove} />
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => { setInput(e.target.value); mentions.track(e.target); }}
          onSelect={e => mentions.track(e.currentTarget)}
          onKeyDown={onKeyDown}
          placeholder={!choice ? 'Choose a model to start' : code ? `Ask about ${code.project.name}, or ask for a change` : `Message ${choice.model.name}`}
          rows={1}
          aria-label="Message"
        />
        <div className="composer-bar">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept={vision ? `${ACCEPT_IMAGES},${ACCEPT_DOCUMENTS}` : ACCEPT_DOCUMENTS}
            onChange={event => {
              if (event.target.files) void files.attach(event.target.files);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className="icon-btn round press attach-btn"
            disabled={!choice || busy}
            onClick={() => fileInput.current?.click()}
            aria-label="Attach files"
            title={`${vision ? 'Attach photos, PDFs and text files' : 'Attach PDFs and text files'}${remote ? `. They are sent to ${destination} with your message.` : ''}`}
          >
            <Paperclip size={18} />
          </button>
          {voice.supported && (
            <button
              type="button"
              className={`icon-btn round press mic-btn${voice.state === 'recording' ? ' recording' : ''}`}
              disabled={busy || voice.state === 'transcribing'}
              onClick={() => void voice.toggle()}
              aria-label={voice.state === 'recording' ? 'Stop recording' : 'Speak your message'}
              aria-pressed={voice.state === 'recording'}
              title={voice.state === 'recording' ? 'Stop (Esc to cancel)' : 'Speak your message. It’s turned into text on this device.'}
            >
              {voice.state === 'transcribing' ? <Loader2 size={18} className="spin" /> : voice.state === 'recording' ? <Square size={13} fill="currentColor" /> : <Mic size={18} />}
            </button>
          )}
          {modelPicker}
          {(codeAvailable || codeMode.unavailableReason) && (
            <CodeChip
              unavailable={codeAvailable ? null : codeMode.unavailableReason}
              starting={codeMode.starting}
              disabled={busy}
              session={code}
              plan={codeMode.plan}
              onSwitchProject={project => void codeMode.switchProject(project)}
              onChooseFolder={() => void codeMode.changeFolder()}
              onTogglePlan={() => void codeMode.togglePlan()}
              autonomy={codeMode.autonomy}
              onAutonomy={level => void codeMode.chooseAutonomy(level)}
              onRemove={codeMode.end}
            />
          )}
          {thinkingLevels.length > 1 && !code && <ThinkingMenu levels={thinkingLevels} value={thinking} onChange={onThinking} disabled={busy} local={choice?.kind === 'local'} hints={choice?.kind === 'own' ? choice.model.thinkingHints : undefined} />}
          <span className={`engine-note${status === 'loading' || voice.state === 'transcribing' ? ' working' : ''}`}>
            {voice.state === 'recording' ? `Listening… ${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, '0')}`
              : voice.state === 'transcribing' ? (voice.download !== null ? `Getting the speech model… ${Math.round(voice.download * 100)}%` : 'Turning speech into text…')
              : status === 'loading' ? 'Loading model…'
              : cloud ? <><span className="where" data-where="cloud">In the cloud</span>{freeLeft !== null && <span className="engine-fact">{freeLeft} free today</span>}</>
                : choice?.kind === 'own' ? ''
                : choice ? <span className="where" data-where="device" title={info?.gpuMissing ? 'Your computer has a graphics card, but this model is running on the processor, which is much slower. A graphics driver may be missing.' : info?.device ?? undefined}>{info?.gpu ? 'On your graphics card' : info?.gpuMissing ? 'On your processor' : 'On this device'}</span> : ''}
          </span>
          <span className="spacer" />
          {choice?.kind === 'own' && isClaudeAgent(choice.provider) && <PlanUsage />}
          {context.usage && <ContextMeter usage={context.usage} busy={busy} canSummarize={context.canSummarize} onSummarize={context.onSummarize} onNewChat={context.onNewChat} />}
          {busy ? (
            <button key="stop" type="button" className="send stop" onClick={onStop} aria-label="Stop (Esc)" title="Stop (Esc)">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button key="send" type="submit" className="send" disabled={(!input.trim() && !files.attachments.length) || !choice} aria-label="Send" title="Send (Enter)">
              <ArrowUp size={20} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
});
