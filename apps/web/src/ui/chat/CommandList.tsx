import type { Command } from '../../chat/commands';

/** The commands matching what was typed after /. Keys move through them; a click runs one. */
export function CommandList({ items, index, onHover, onRun }: { items: Command[]; index: number; onHover: (index: number) => void; onRun: (command: Command) => void }) {
  if (!items.length) return null;
  return (
    <div className="cmd-list glass thick" role="listbox" aria-label="Commands">
      {items.map((command, i) => (
        <button key={command.name} type="button" role="option" aria-selected={i === index} className={`cmd${i === index ? ' on' : ''}`} onMouseDown={event => event.preventDefault()} onMouseEnter={() => onHover(i)} onClick={() => onRun(command)}>
          <span className="cmd-name">/{command.name}</span>
          <span className="cmd-hint">{command.hint}</span>
        </button>
      ))}
    </div>
  );
}
