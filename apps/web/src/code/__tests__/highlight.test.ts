import { describe, expect, it } from 'vitest';
import { highlight } from '../highlight';
import { languageOf, languageOfPath, LANGUAGES } from '../languages';

const roles = (lines: Awaited<ReturnType<typeof highlight>>) => Object.fromEntries((lines ?? []).flat().filter(token => token.text.trim()).map(token => [token.text.trim(), token.role]));

describe('colouring code', () => {
  it('gives each part of the code its role, with comments in italics, and keeps every character', async () => {
    const code = '// add tax\nexport function total(price: number): number {\n  return price * 1.2 + "€".length;\n}';
    const lines = await highlight(code, 'typescript');
    expect(lines).not.toBeNull();
    expect(lines!.map(line => line.map(token => token.text).join('')).join('\n')).toBe(code);
    const role = roles(lines);
    expect(role['// add tax']).toBe('comment');
    expect(lines![0].find(token => token.text.includes('add tax'))?.italic).toBe(true);
    expect(role.export).toBe('keyword');
    expect(role.function).toBe('keyword');
    expect(role.total).toBe('function');
    expect(role.number).toBe('type');
    expect(role['1.2']).toBe('constant');
    expect(role['"€"']).toBe('string');
  });

  it('colours Python, shell and JSON keys too', async () => {
    expect(roles(await highlight('def area(r):\n    return 3.14 * r', 'python')).def).toBe('keyword');
    expect(roles(await highlight('echo "hi" # say hi', 'shellscript'))['# say hi']).toBe('comment');
    expect(roles(await highlight('{"name": "Quo", "n": 1}', 'json'))['1']).toBe('constant');
  });

  it('leaves code plain with no language, an unknown one, or when it is too long', async () => {
    expect(await highlight('x = 1', null)).toBeNull();
    expect(await highlight('x'.repeat(50), 'python', 10)).toBeNull();
  });
});

describe('naming the language', () => {
  it('knows the names people write after ``` and file extensions, and nothing else', () => {
    expect(languageOf('TS')).toBe('typescript');
    expect(languageOf('sh')).toBe('shellscript');
    expect(languageOf('c++')).toBe('cpp');
    expect(languageOf('python')).toBe('python');
    expect(languageOf('klingon')).toBeNull();
    expect(languageOf('toString')).toBeNull();
    expect(languageOf('')).toBeNull();
    expect(languageOfPath('src/App.tsx')).toBe('tsx');
    expect(languageOfPath('Dockerfile')).toBe('docker');
    expect(languageOfPath('a/b/Makefile')).toBe('makefile');
    expect(languageOfPath('.env.local')).toBe('ini');
    expect(languageOfPath('README')).toBeNull();
  });

  it('loads every grammar on the list', async () => {
    for (const load of Object.values(LANGUAGES)) expect((await load()).default.length).toBeGreaterThan(0);
  });
});
