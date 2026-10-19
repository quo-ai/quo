import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, File, FileText, Folder, FolderOpen, Globe, Image } from 'lucide-react';
import type { CodeSession } from '../../agent/session';
import type { FileEntry } from '../../native';

type Listing = { state: 'loading' } | { state: 'error' } | { state: 'ok'; entries: FileEntry[]; truncated: boolean };

const PAGES = /\.(html?|xhtml)$/i;
const IMAGES = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const TEXT = /\.(md|txt|json|ya?ml|toml|css|scss|js|jsx|ts|tsx|py|rs|go|java|kt|c|h|cpp|cs|rb|php|sh|sql)$/i;

function Icon({ entry, open }: { entry: FileEntry; open: boolean }) {
  if (entry.dir) return open ? <FolderOpen size={15} /> : <Folder size={15} />;
  if (PAGES.test(entry.name)) return <Globe size={15} />;
  if (IMAGES.test(entry.name)) return <Image size={15} />;
  return TEXT.test(entry.name) ? <FileText size={15} /> : <File size={15} />;
}

/** The project's folders and files, one folder at a time as they are opened. Reading only. */
export function FileTree({ session, tick, selected, onSelect }: { session: CodeSession; tick: number; selected: string | null; onSelect: (path: string) => void }) {
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['.']));

  const load = useCallback(async (path: string) => {
    try {
      const result = await session.browse(path);
      setListings(current => ({ ...current, [path]: { state: 'ok', entries: result.entries, truncated: result.truncated } }));
    } catch {
      setListings(current => ({ ...current, [path]: { state: 'error' } }));
    }
  }, [session]);

  // A different project starts again; the agent's work (tick) refreshes every folder that is open.
  useEffect(() => {
    setListings({});
    setExpanded(new Set(['.']));
  }, [session]);
  useEffect(() => {
    for (const path of expanded) void load(path);
  }, [tick, session]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opening a file from a link in a message opens the folders above it.
  useEffect(() => {
    if (!selected?.includes('/') || selected.startsWith('/') || selected.startsWith('.')) return;
    const parts = selected.split('/').slice(0, -1);
    const folders = parts.map((_, index) => parts.slice(0, index + 1).join('/'));
    setExpanded(current => new Set([...current, ...folders]));
    for (const folder of folders) void load(folder);
  }, [selected, load]);

  const toggle = (path: string) => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        void load(path);
      }
      return next;
    });
  };

  const rows = (path: string, depth: number): React.ReactNode => {
    const listing = listings[path];
    if (!listing || listing.state === 'loading') return <div className="fp-note" style={{ paddingLeft: 14 + depth * 14 }}>Loading…</div>;
    if (listing.state === 'error') return <div className="fp-note" style={{ paddingLeft: 14 + depth * 14 }}>Couldn’t read this folder.</div>;
    return (
      <>
        {listing.entries.length === 0 && <div className="fp-note" style={{ paddingLeft: 14 + depth * 14 }}>Empty</div>}
        {listing.entries.map(entry => {
          const open = entry.dir && expanded.has(entry.path);
          return (
            <div key={entry.path}>
              <button type="button" className={`fp-row${selected === entry.path ? ' selected' : ''}${entry.ignored ? ' dim' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => (entry.dir ? toggle(entry.path) : onSelect(entry.path))} title={entry.path}>
                <span className="fp-chev">{entry.dir ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}</span>
                <Icon entry={entry} open={open} />
                <span className="fp-name">{entry.name}</span>
              </button>
              {open && rows(entry.path, depth + 1)}
            </div>
          );
        })}
        {listing.truncated && <div className="fp-note" style={{ paddingLeft: 14 + depth * 14 }}>More files than are shown here.</div>}
      </>
    );
  };

  return <div className="fp-tree" role="tree">{rows('.', 0)}</div>;
}
