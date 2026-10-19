import { afterEach, describe, expect, it, vi } from 'vitest';
import { codePanel } from '../codePanel';
import { fileRefFromHref, parseFileRef } from '../fileRefs';
import type { CodeSession } from '../session';

describe('a file named in the agent’s words', () => {
  it.each([
    ['src/app.ts', { path: 'src/app.ts' }],
    ['src/app.ts:42', { path: 'src/app.ts', line: 42 }],
    ['src/app.ts:42:7', { path: 'src/app.ts', line: 42 }],
    ['./pages/index.html', { path: './pages/index.html' }],
    ['index.html', { path: 'index.html' }],
    ['README.md#L12', { path: 'README.md', line: 12 }],
    ['packages/api/src/a-b_c.test.tsx', { path: 'packages/api/src/a-b_c.test.tsx' }],
    [['', 'srv', 'app', 'main.py'].join('/'), { path: '/srv/app/main.py' }],
  ])('is a file: %s', (text, expected) => expect(parseFileRef(text)).toEqual(expected));

  it.each(['useState', 'v1.2.3', 'e.g.', 'a b.ts', 'https://example.com/a.html', '../secret.txt', 'src/..', '--flag.js', '', 'x', 'a/b', 'src/app.ts:abc', 'file.verylongextension', '.env', 'C:\\x\\a.js'])('is not: %s', text => expect(parseFileRef(text)).toBeNull());

  it('reads a markdown link only when it points into the project', () => {
    expect(fileRefFromHref('src/app.ts')).toEqual({ path: 'src/app.ts' });
    expect(fileRefFromHref('my%20app/index.html')).toBeNull(); // spaces are never a path here
    for (const bad of ['https://example.com/a.html', 'mailto:' + 'a' + '@b.co', '#section', '//cdn.example.com/a.js', 'javascript:alert(1)', 'file:///etc/passwd', undefined, '']) expect(fileRefFromHref(bad as string)).toBeNull();
  });
});

describe('which mentioned paths are real', () => {
  afterEach(() => {
    codePanel.setSession(null);
    vi.useRealTimers();
  });

  const session = (real: string[]) => ({ exists: vi.fn(async (paths: string[]) => paths.filter(path => real.includes(path))) }) as unknown as CodeSession & { exists: ReturnType<typeof vi.fn> };

  it('asks the project once, in one batch, and remembers the answer', async () => {
    vi.useFakeTimers();
    const s = session(['src/a.ts']);
    codePanel.setSession(s);
    for (const path of ['src/a.ts', 'node.js', 'src/a.ts', 'index.html']) codePanel.request(path);
    await vi.advanceTimersByTimeAsync(100);
    expect(s.exists).toHaveBeenCalledTimes(1);
    expect(s.exists.mock.calls[0][0].sort()).toEqual(['index.html', 'node.js', 'src/a.ts']);
    expect([...codePanel.get().known]).toEqual(expect.arrayContaining([['src/a.ts', true], ['node.js', false], ['index.html', false]]));
    codePanel.request('src/a.ts');
    await vi.advanceTimersByTimeAsync(100);
    expect(s.exists).toHaveBeenCalledTimes(1);
  });

  it('looks again at paths that were missing once files may have changed, and forgets everything for another project', async () => {
    vi.useFakeTimers();
    const first = session([]);
    codePanel.setSession(first);
    codePanel.request('new.html');
    await vi.advanceTimersByTimeAsync(100);
    expect(codePanel.get().known.get('new.html')).toBe(false);
    codePanel.bump();
    expect(codePanel.get().known.has('new.html')).toBe(false);
    expect(codePanel.get().known.size).toBe(0);
    codePanel.setSession(session(['x.ts']));
    expect(codePanel.get().known.size).toBe(0);
  });

  it('opens on a file, with a line, and remembers it was open', () => {
    codePanel.openFile('src/a.ts', 9);
    expect(codePanel.get()).toMatchObject({ open: true, tab: 'files', path: 'src/a.ts', line: 9 });
    codePanel.close();
    expect(codePanel.get().open).toBe(false);
  });
});
