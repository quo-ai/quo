import { useEffect, useState } from 'react';

/**
 * Lightweight notices ("Copied", "Chat deleted · Undo", "Model ready").
 * Call `toast()` from anywhere; <Toasts /> renders them.
 */

interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  action?: ToastAction;
}

let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

function emit() {
  listeners.forEach(listener => listener(items));
}

export function toast(message: string, options: { action?: ToastAction; durationMs?: number } = {}): void {
  const item: ToastItem = { id: nextId++, message, action: options.action };
  items = [...items.slice(-2), item];
  emit();
  setTimeout(() => dismiss(item.id), options.durationMs ?? (options.action ? 6000 : 2400));
}

function dismiss(id: number) {
  items = items.filter(item => item.id !== id);
  emit();
}

export function Toasts() {
  const [list, setList] = useState(items);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);

  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map(item => (
        <div key={item.id} className="toast glass thick">
          <span>{item.message}</span>
          {item.action && (
            <button
              className="btn btn-soft press"
              onClick={() => {
                item.action!.run();
                dismiss(item.id);
              }}
            >
              {item.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
