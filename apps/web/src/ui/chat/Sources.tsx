import { Globe } from 'lucide-react';
import type { WebSource } from '../../../shared/webSources';

/** "example.com" from an address, for a short label. */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * The pages a reply drew on, under it: a numbered chip per site, the page's title on hover. No icons are fetched from
 * the sites (that would tell them who is reading); titles come from a third party and are drawn as text only.
 */
export function Sources({ sources }: { sources: WebSource[] }) {
  return (
    <nav className="sources" aria-label="Sources">
      <span className="sources-label"><Globe size={13} /> Sources</span>
      {sources.map((source, index) => (
        <a key={source.url} className="source-chip press" href={source.url} target="_blank" rel="noopener noreferrer" title={source.title ? `${source.title}\n${source.url}` : source.url}>
          <span className="source-n">{index + 1}</span>
          <span className="source-site">{siteOf(source.url)}</span>
        </a>
      ))}
    </nav>
  );
}
