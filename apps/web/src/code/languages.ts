import type { LanguageRegistration } from 'shiki/core';

/**
 * The languages Quo colours. Each grammar is its own file, fetched the first time a reply or a file uses it and cached
 * then (vite.config.ts), not when the app installs; anything else is shown plain. Keep the list to what people write.
 */
type Grammar = () => Promise<{ default: LanguageRegistration[] }>;

export const LANGUAGES = {
  astro: () => import('@shikijs/langs/astro'),
  bat: () => import('@shikijs/langs/bat'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  dart: () => import('@shikijs/langs/dart'),
  diff: () => import('@shikijs/langs/diff'),
  docker: () => import('@shikijs/langs/docker'),
  elixir: () => import('@shikijs/langs/elixir'),
  go: () => import('@shikijs/langs/go'),
  graphql: () => import('@shikijs/langs/graphql'),
  haskell: () => import('@shikijs/langs/haskell'),
  hcl: () => import('@shikijs/langs/hcl'),
  html: () => import('@shikijs/langs/html'),
  ini: () => import('@shikijs/langs/ini'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  jsx: () => import('@shikijs/langs/jsx'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  latex: () => import('@shikijs/langs/latex'),
  lua: () => import('@shikijs/langs/lua'),
  makefile: () => import('@shikijs/langs/makefile'),
  markdown: () => import('@shikijs/langs/markdown'),
  nginx: () => import('@shikijs/langs/nginx'),
  'objective-c': () => import('@shikijs/langs/objective-c'),
  perl: () => import('@shikijs/langs/perl'),
  php: () => import('@shikijs/langs/php'),
  powershell: () => import('@shikijs/langs/powershell'),
  prisma: () => import('@shikijs/langs/prisma'),
  proto: () => import('@shikijs/langs/proto'),
  python: () => import('@shikijs/langs/python'),
  r: () => import('@shikijs/langs/r'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  scala: () => import('@shikijs/langs/scala'),
  scss: () => import('@shikijs/langs/scss'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  shellsession: () => import('@shikijs/langs/shellsession'),
  sql: () => import('@shikijs/langs/sql'),
  svelte: () => import('@shikijs/langs/svelte'),
  swift: () => import('@shikijs/langs/swift'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  vue: () => import('@shikijs/langs/vue'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml'),
  zig: () => import('@shikijs/langs/zig'),
} satisfies Record<string, Grammar>;

export type Language = keyof typeof LANGUAGES;

/** Other names for them: what follows ``` in a reply, and file extensions. */
const ALIASES: Record<string, Language> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python', python3: 'python', pyw: 'python',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', shell: 'shellscript', fish: 'shellscript', ksh: 'shellscript',
  console: 'shellsession', terminal: 'shellsession',
  yml: 'yaml', md: 'markdown', mdx: 'markdown',
  'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', h: 'c',
  cs: 'csharp', 'c#': 'csharp',
  rb: 'ruby', rs: 'rust', golang: 'go', kt: 'kotlin', kts: 'kotlin',
  dockerfile: 'docker', containerfile: 'docker', make: 'makefile', mk: 'makefile',
  ps1: 'powershell', ps: 'powershell', pwsh: 'powershell', cmd: 'bat',
  objc: 'objective-c', m: 'objective-c', hs: 'haskell', pl: 'perl', ex: 'elixir', exs: 'elixir',
  tf: 'hcl', terraform: 'hcl', tex: 'latex', gql: 'graphql', json5: 'jsonc',
  htm: 'html', xhtml: 'html', svg: 'xml', plist: 'xml', csproj: 'xml',
  cfg: 'ini', conf: 'ini', properties: 'ini', env: 'ini', patch: 'diff', protobuf: 'proto',
};

/** The language for a name in a reply (```ts) or an extension, or null to show it plain. */
export function languageOf(name: string | undefined | null): Language | null {
  const key = (name ?? '').trim().toLowerCase();
  if (!key) return null;
  if (Object.hasOwn(LANGUAGES, key)) return key as Language;
  return Object.hasOwn(ALIASES, key) ? ALIASES[key] : null;
}

/** The language of a file, from its name: Dockerfile and Makefile by name, the rest by extension. */
export function languageOfPath(path: string): Language | null {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (name === 'dockerfile' || name === 'containerfile' || name.startsWith('dockerfile.')) return 'docker';
  if (name === 'makefile' || name === 'gnumakefile') return 'makefile';
  if (name === '.env' || name.startsWith('.env.')) return 'ini';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? languageOf(name.slice(dot + 1)) : null;
}
