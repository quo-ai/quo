import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Brain, Check, Lock, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import {
  addMemory, clearMemories, deleteMemory, listMemories, MAX_MEMORIES, MAX_MEMORY_CHARS, MEMORY_ERRORS, MemoryError, onMemoriesChanged,
  updateMemory, type Memory,
} from '../memory/store';
import { useSyncStatus } from '../sync';
import { toast } from './Toasts';

const explain = (error: unknown) => (error instanceof MemoryError ? MEMORY_ERRORS[error.code] : 'Couldn’t save that. Try again.');

/** The things Quo has been told to remember: add, change and delete them. */
export function MemorySheet({ onClose }: { onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  const sync = useSyncStatus();
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    sheet.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Shows what's there, and keeps up with what Quo Sync brings in from other devices.
  useEffect(() => {
    let current = true;
    const load = () => void listMemories().then(list => current && setMemories(list));
    load();
    const stop = onMemoriesChanged(load);
    return () => {
      current = false;
      stop();
    };
  }, []);

  async function add(event: FormEvent) {
    event.preventDefault();
    try {
      await addMemory(draft);
      setDraft('');
    } catch (error) {
      toast(explain(error));
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    try {
      await updateMemory(editing.id, editing.text);
      setEditing(null);
    } catch (error) {
      toast(explain(error));
      if (error instanceof MemoryError && error.code === 'missing') setEditing(null);
    }
  }

  async function clearAll() {
    await clearMemories();
    setConfirmClear(false);
  }

  const count = memories?.length ?? 0;

  return (
    <div className="scrim" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sheet glass thick" role="dialog" aria-modal="true" aria-labelledby="memory-title" tabIndex={-1} ref={sheet}>
        <div className="sheet-head">
          <h2 id="memory-title">Memories</h2>
          <button className="icon-btn round press" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        <div className="sheet-body">
          <p className="auth-lede">Things you’d like Quo to remember about you, so you don’t have to say them again.</p>
          <ul className="sync-points">
            <li><Lock size={16} /><span>Your offline models read them before every reply. They’re never sent to a cloud model.</span></li>
            <li><RefreshCw size={16} /><span>{sync.phase === 'off' ? 'With Quo Sync on, they follow you to your other devices, including the Android app.' : 'They sync with your other devices, including the Android app.'}</span></li>
          </ul>

          <form className="memory-add" onSubmit={event => void add(event)}>
            <div className="field-wrap">
              <Brain size={18} />
              <input
                className="field"
                value={draft}
                onChange={event => setDraft(event.target.value)}
                maxLength={MAX_MEMORY_CHARS}
                placeholder="e.g. I’m vegetarian, and I live in Leeds"
                aria-label="Something to remember"
              />
            </div>
            <button className="btn btn-primary press" type="submit" disabled={!draft.trim()}>Remember</button>
          </form>

          {memories === null ? null : count === 0 ? (
            <p className="note memory-empty">Nothing yet. Add something above, and offline models will know it from now on.</p>
          ) : (
            <>
              <ul className="memory-list">
                {memories.map(memory => (
                  <li key={memory.id}>
                    {editing?.id === memory.id ? (
                      <form className="memory-edit" onSubmit={event => void save(event)}>
                        <input
                          className="field memory-edit-field"
                          autoFocus
                          value={editing.text}
                          maxLength={MAX_MEMORY_CHARS}
                          onChange={event => setEditing({ id: memory.id, text: event.target.value })}
                          onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setEditing(null); } }}
                          aria-label="Edit memory"
                        />
                        <button className="icon-btn press" type="submit" aria-label="Save"><Check size={16} /></button>
                        <button className="icon-btn press" type="button" onClick={() => setEditing(null)} aria-label="Cancel"><X size={16} /></button>
                      </form>
                    ) : (
                      <>
                        <span className="memory-text">{memory.content}</span>
                        <button className="icon-btn press" onClick={() => setEditing({ id: memory.id, text: memory.content })} aria-label={`Edit “${memory.content}”`}><Pencil size={15} /></button>
                        <button className="icon-btn press" onClick={() => void deleteMemory(memory.id)} aria-label={`Delete “${memory.content}”`}><Trash2 size={15} /></button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <div className="memory-foot">
                <span className="note">{count} of {MAX_MEMORIES}</span>
                {confirmClear
                  ? (
                    <span className="memory-confirm">
                      <button className="btn-link danger" onClick={() => void clearAll()}>Yes, delete all</button>
                      <button className="btn-link" onClick={() => setConfirmClear(false)}>Cancel</button>
                    </span>
                  )
                  : <button className="btn-link muted" onClick={() => setConfirmClear(true)}>Delete all…</button>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
