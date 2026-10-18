'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, describe, it } = require('node:test');
const { strToU8, zipSync } = require('fflate');
const files = require('../src/agent/files');
const { RepoCache, cleanName, parseRepo } = require('../src/agent/repos');
const safety = require('../src/agent/safety');
const { AgentSession } = require('../src/agent/session');

const temp = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'quo-agent-')));
const write = (root, relative, content) => {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
};
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code, `expected ${code}`);
const throwsCode = (fn, code) => assert.throws(fn, error => error.code === code, `expected ${code}`);
const ctxFor = root => ({ rootReal: root, reads: new Map() });
const node = code => `"${process.execPath}" -e "${code}"`;

function trySymlink(target, link) {
  try {
    fs.symlinkSync(target, link);
    return true;
  } catch {
    return false; // Windows without the privilege
  }
}

describe('paths stay inside the project', () => {
  it('resolves ordinary paths, relative or absolute, to real paths', () => {
    const root = temp();
    write(root, 'src/app.js', 'x');
    assert.equal(safety.resolveInside(root, 'src/app.js').relative, 'src/app.js');
    assert.equal(safety.resolveInside(root, path.join(root, 'src', 'app.js')).relative, 'src/app.js');
    assert.equal(safety.resolveInside(root, '.').relative, '.');
    assert.equal(safety.resolveInside(root, '').relative, '.');
    write(root, '..hidden', 'x');
    assert.equal(safety.resolveInside(root, '..hidden').relative, '..hidden'); // a name that merely starts with dots
  });

  it('refuses ways out: .., absolute paths elsewhere, NUL bytes', () => {
    const root = temp();
    const outside = temp();
    write(outside, 'secret.txt', 'x');
    throwsCode(() => safety.resolveInside(root, '../secret.txt'), 'outside_project');
    throwsCode(() => safety.resolveInside(root, `src/../../${path.basename(outside)}/secret.txt`), 'outside_project');
    throwsCode(() => safety.resolveInside(root, path.join(outside, 'secret.txt')), 'outside_project');
    throwsCode(() => safety.resolveInside(root, 'a\0b'), 'bad_path');
  });

  it('follows links before deciding, so a link out of the project is out of the project', () => {
    const root = temp();
    const outside = temp();
    write(outside, 'passwd', 'x');
    if (!trySymlink(outside, path.join(root, 'escape'))) return;
    throwsCode(() => safety.resolveInside(root, 'escape/passwd'), 'outside_project');
    throwsCode(() => safety.resolveInside(root, 'escape'), 'outside_project');
    write(root, 'real/file.txt', 'x');
    assert.ok(trySymlink(path.join(root, 'real'), path.join(root, 'alias')));
    assert.equal(safety.resolveInside(root, 'alias/file.txt').relative, 'real/file.txt'); // a link that stays inside is fine
  });

  it('lets a file not exist yet only when asked, and only inside the project', () => {
    const root = temp();
    write(root, 'src/a.js', 'x');
    throwsCode(() => safety.resolveInside(root, 'src/new.js'), 'not_found');
    assert.equal(safety.resolveInside(root, 'src/new.js', { allowMissing: true }).relative, 'src/new.js');
    assert.equal(safety.resolveInside(root, 'a/b/c/d.js', { allowMissing: true }).relative, 'a/b/c/d.js');
    throwsCode(() => safety.resolveInside(root, '../x/new.js', { allowMissing: true }), 'outside_project');
    const outside = temp();
    if (trySymlink(outside, path.join(root, 'out'))) throwsCode(() => safety.resolveInside(root, 'out/new.js', { allowMissing: true }), 'outside_project');
  });
});

describe('what counts as a secret', () => {
  it('blocks keys, credentials, .env files and anything in .git, but not their examples', () => {
    for (const secret of ['.env', 'app/.env.local', '.env.production', 'keys/server.pem', 'a/b.key', 'id_rsa', '.ssh/config', '.aws/credentials', '.npmrc', '.git/config', 'sub/.git/HEAD', 'deploy.p12', 'credentials.json', '.netrc']) {
      assert.ok(safety.isSecretPath(secret), secret);
    }
    for (const fine of ['.env.example', '.env.sample', 'src/app.ts', 'id_rsa.pub', 'README.md', 'docs/keys.md', '.gitignore', '.github/workflows/ci.yml', 'environment.ts']) {
      assert.ok(!safety.isSecretPath(fine), fine);
    }
  });

  it('removes well-known secret formats from text, and leaves code alone', () => {
    const text = [
      // Fake secrets are assembled here, so no real-looking one sits in the source for scanners to find.
      `${'-----BEGIN RSA '}${'PRIVATE KEY-----'}\nMIIEow\nabc\n${'-----END RSA '}${'PRIVATE KEY-----'}`,
      `aws ${'AK'}${'IA'}ABCDEFGHIJKLMNOP`,
      `gh ghp_${'a'.repeat(36)}`,
      `openai sk-${'b'.repeat(40)}`,
      `anthropic sk-ant-${'c'.repeat(40)}`,
      `slack xoxb-${'1'.repeat(12)}`,
      `google AIza${'d'.repeat(35)}`,
    ].join('\n');
    const cleaned = safety.redactSecrets(text);
    for (const leaked of ['MIIEow', `${'AK'}${'IA'}ABCDEFGHIJKLMNOP`, 'ghp_', 'sk-bbbb', 'sk-ant-', 'xoxb-', 'AIza']) assert.ok(!cleaned.includes(leaked), leaked);
    const code = 'const key = process.env.API_KEY; // sk- is the prefix\nfunction skip(a) { return a }';
    assert.equal(safety.redactSecrets(code), code);
  });

  it('gives commands an environment without credentials', () => {
    const env = safety.scrubbedEnv({ PATH: '/bin', HOME: '/h', LANG: 'C', GITHUB_TOKEN: 'x', MY_API_KEY: 'x', AWS_REGION: 'x', DB_PASSWORD: 'x', OPENROUTER_API_KEY: 'x', SSH_AUTH_SOCK: 'x', NODE_ENV: 'test', SESSION_COOKIE: 'x' });
    assert.deepEqual(Object.keys(env).sort(), ['HOME', 'LANG', 'NODE_ENV', 'PATH']);
  });

  it('won’t take a whole drive, the home folder, or a system folder as a project', () => {
    const home = temp();
    throwsCode(() => safety.checkProjectRoot(path.parse(home).root, home), 'too_broad');
    throwsCode(() => safety.checkProjectRoot(home, home), 'too_broad');
    throwsCode(() => safety.checkProjectRoot(path.dirname(home), home), 'too_broad');
    if (process.platform !== 'win32') {
      throwsCode(() => safety.checkProjectRoot('/etc', home), 'system_folder');
      throwsCode(() => safety.checkProjectRoot('/usr', home), 'system_folder');
      throwsCode(() => safety.checkProjectRoot('/etc/ssh/x', home), 'system_folder');
      assert.equal(safety.checkProjectRoot('/var/www', home), '/var/www');
    }
    const project = path.join(home, 'projects', 'app');
    fs.mkdirSync(project, { recursive: true });
    assert.equal(safety.checkProjectRoot(project, home), project);
  });
});

describe('reading', () => {
  let root;
  before(() => {
    root = temp();
    write(root, 'package.json', '{"name":"demo"}\n');
    write(root, 'src/app.js', Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n'));
    write(root, 'src/util/math.ts', 'export const add = (a: number, b: number) => a + b;\n');
    write(root, 'node_modules/dep/index.js', 'needle in dependencies');
    write(root, '.env', 'API_TOKEN=supersecret');
    write(root, 'notes.bin', Buffer.from([1, 2, 0, 3]));
    write(root, 'huge.txt', 'x'.repeat(files.LIMITS.maxFileBytes + 1));
  });

  it('lists a folder, folders first, skipping dependencies', async () => {
    const result = await files.listDirectory(ctxFor(root), {});
    assert.match(result.text, /^Project folder\/\nnode_modules\/ \(skipped/m);
    assert.match(result.text, /src\/\n/);
    assert.match(result.text, /package\.json \(\d+ B\)/);
    assert.ok(result.text.indexOf('src/') < result.text.indexOf('package.json'));
    const deep = await files.listDirectory(ctxFor(root), { depth: 2 });
    assert.match(deep.text, / {2}util\//);
    await rejects(files.listDirectory(ctxFor(root), { path: 'package.json' }), 'not_directory');
  });

  it('reads numbered lines, in pages, and says how to read on', async () => {
    const first = await files.readFile(ctxFor(root), { path: 'src/app.js' });
    assert.match(first.text, /^src\/app\.js \(lines 1-400 of 1000\)/);
    assert.match(first.text, /\n {2}1\tline 1\n/);
    assert.match(first.text, /Read on with start_line=401/);
    const page = await files.readFile(ctxFor(root), { path: 'src/app.js', start_line: 998, end_line: 5000 });
    assert.match(page.text, /lines 998-1000 of 1000/);
    assert.ok(!page.text.includes('more lines'));
    assert.deepEqual(page.display, { kind: 'read', path: 'src/app.js', from: 998, to: 1000, total: 1000 });
  });

  it('refuses secrets, binaries, huge files, folders and anything outside', async () => {
    await rejects(files.readFile(ctxFor(root), { path: '.env' }), 'secret');
    await rejects(files.readFile(ctxFor(root), { path: 'notes.bin' }), 'binary');
    await rejects(files.readFile(ctxFor(root), { path: 'huge.txt' }), 'too_large');
    await rejects(files.readFile(ctxFor(root), { path: 'src' }), 'not_file');
    await rejects(files.readFile(ctxFor(root), { path: '../etc/passwd' }), 'outside_project');
    await rejects(files.readFile(ctxFor(root), { path: 'missing.js' }), 'not_found');
    await rejects(files.readFile(ctxFor(root), {}), 'bad_args');
  });

  it('removes secret formats from what it reads', async () => {
    write(root, 'config.js', `const token = 'ghp_${'z'.repeat(36)}';\nexport default token;\n`);
    const result = await files.readFile(ctxFor(root), { path: 'config.js' });
    assert.ok(!result.text.includes('ghp_'));
    assert.match(result.text, /\[token removed\]/);
  });

  it('finds files by pattern, never in dependencies or secrets', async () => {
    const find = async pattern => (await files.findFiles(ctxFor(root), { pattern })).text.split('\n');
    assert.deepEqual(await find('*.ts'), ['src/util/math.ts']);
    assert.deepEqual(await find('src/**/*.ts'), ['src/util/math.ts']);
    assert.deepEqual((await find('*.{json,ts}')).sort(), ['package.json', 'src/util/math.ts']);
    assert.ok((await find('*.js')).every(line => !line.includes('node_modules')));
    assert.deepEqual(await find('.env'), ['No files match .env.']);
    assert.match((await files.findFiles(ctxFor(root), { pattern: '*.zzz' })).text, /No files match/);
  });

  it('searches text, skipping dependencies, secrets and binaries', async () => {
    const hits = await files.searchText(ctxFor(root), { pattern: 'add' });
    assert.match(hits.text, /^src\/util\/math\.ts:1: export const add/);
    assert.ok(!hits.text.includes('node_modules'));
    assert.match((await files.searchText(ctxFor(root), { pattern: 'supersecret' })).text, /No matches/);
    assert.match((await files.searchText(ctxFor(root), { pattern: 'needle' })).text, /No matches/); // only in node_modules
    const insensitive = await files.searchText(ctxFor(root), { pattern: 'LINE 1000' });
    assert.match(insensitive.text, /src\/app\.js:1000/);
    assert.match((await files.searchText(ctxFor(root), { pattern: 'LINE 1000', case_sensitive: true })).text, /No matches/);
    assert.match((await files.searchText(ctxFor(root), { pattern: 'name', glob: '*.json' })).text, /^package\.json:1:/);
  });

  it('searches with regular expressions, and gives up on one that would never finish', async () => {
    const re = await files.searchText(ctxFor(root), { pattern: '^line 99\\d$', regex: true, max_results: 5 });
    assert.match(re.text, /src\/app\.js:991: line 991/);
    await rejects(files.searchText(ctxFor(root), { pattern: '(', regex: true }), 'bad_pattern');
    const evil = temp();
    write(evil, 'a.txt', `${'a'.repeat(60)}b`);
    const started = Date.now();
    await rejects(files.searchText(ctxFor(evil), { pattern: '(a+)+$', regex: true }), 'slow_pattern');
    assert.ok(Date.now() - started < 5000, 'a runaway pattern is cut off quickly');
  });

  it('caps what a search returns', async () => {
    const many = temp();
    write(many, 'a.txt', Array.from({ length: 300 }, () => 'hit').join('\n'));
    const result = await files.searchText(ctxFor(many), { pattern: 'hit', max_results: 20 });
    assert.equal(result.text.split('\n').filter(line => line.startsWith('a.txt:')).length, 20);
    assert.match(result.text, /reached 20 results/);
  });
});

describe('changing files', () => {
  it('needs the file read first, and unchanged since', async () => {
    const root = temp();
    const target = write(root, 'a.js', 'const a = 1;\nconst b = 2;\n');
    const ctx = ctxFor(root);
    await rejects(files.planEdit(ctx, { path: 'a.js', old_string: 'a = 1', new_string: 'a = 3' }), 'read_first');
    await files.readFile(ctx, { path: 'a.js' });
    fs.writeFileSync(target, 'const a = 1;\nconst b = 9;\n'); // changed behind our back
    await rejects(files.planEdit(ctx, { path: 'a.js', old_string: 'a = 1', new_string: 'a = 3' }), 'changed');
  });

  it('plans an exact replacement without writing, then writes it when applied', async () => {
    const root = temp();
    const target = write(root, 'a.js', 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
    const ctx = ctxFor(root);
    await files.readFile(ctx, { path: 'a.js' });
    const plan = await files.planEdit(ctx, { path: 'a.js', old_string: 'b = 2', new_string: 'b = 20' });
    assert.equal(fs.readFileSync(target, 'utf8'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n', 'planning changes nothing');
    assert.equal(plan.added, 1);
    assert.equal(plan.removed, 1);
    assert.match(plan.diff, /-const b = 2;\n\+const b = 20;/);
    await files.applyPlan(ctx, plan);
    assert.equal(fs.readFileSync(target, 'utf8'), 'const a = 1;\nconst b = 20;\nconst c = 3;\n');
    // The session's view moved on with the write, so a second edit needs no re-read.
    const next = await files.planEdit(ctx, { path: 'a.js', old_string: 'c = 3', new_string: 'c = 30' });
    assert.equal(next.replacements, 1);
  });

  it('refuses unclear or pointless edits, and edits to secrets', async () => {
    const root = temp();
    write(root, 'a.js', 'x = 1\nx = 1\n');
    write(root, '.env', 'A=1');
    const ctx = ctxFor(root);
    await files.readFile(ctx, { path: 'a.js' });
    await rejects(files.planEdit(ctx, { path: 'a.js', old_string: 'x = 1', new_string: 'x = 2' }), 'ambiguous');
    await rejects(files.planEdit(ctx, { path: 'a.js', old_string: 'y = 1', new_string: 'y = 2' }), 'not_found');
    await rejects(files.planEdit(ctx, { path: 'a.js', old_string: 'x = 1', new_string: 'x = 1' }), 'no_change');
    await rejects(files.planEdit(ctx, { path: 'a.js', old_string: '', new_string: 'x' }), 'bad_args');
    await rejects(files.planEdit(ctx, { path: '.env', old_string: 'A', new_string: 'B' }), 'secret');
    const all = await files.planEdit(ctx, { path: 'a.js', old_string: 'x = 1', new_string: 'x = 2', replace_all: true });
    assert.equal(all.replacements, 2);
  });

  it('inserts replacement text literally, whatever characters it has', async () => {
    const root = temp();
    const target = write(root, 'a.txt', 'price: PLACEHOLDER\n');
    const ctx = ctxFor(root);
    await files.readFile(ctx, { path: 'a.txt' });
    await files.applyPlan(ctx, await files.planEdit(ctx, { path: 'a.txt', old_string: 'PLACEHOLDER', new_string: "$& $1 $$ $` ''" }));
    assert.equal(fs.readFileSync(target, 'utf8'), "price: $& $1 $$ $` ''\n");
  });

  it('creates files, including in new folders, and replaces only files it has read', async () => {
    const root = temp();
    const ctx = ctxFor(root);
    const created = await files.planWrite(ctx, { path: 'src/new/deep/file.js', content: 'a\nb\n' });
    assert.equal(created.kind, 'create');
    assert.ok(!fs.existsSync(path.join(root, 'src')), 'planning creates nothing');
    await files.applyPlan(ctx, created);
    assert.equal(fs.readFileSync(path.join(root, 'src/new/deep/file.js'), 'utf8'), 'a\nb\n');
    const other = temp();
    write(other, 'old.txt', 'old');
    await rejects(files.planWrite(ctxFor(other), { path: 'old.txt', content: 'new' }), 'read_first');
    const ctx2 = ctxFor(other);
    await files.readFile(ctx2, { path: 'old.txt' });
    assert.equal((await files.planWrite(ctx2, { path: 'old.txt', content: 'new' })).kind, 'overwrite');
  });

  it('won’t write secrets, links, outside the project, or too much', async () => {
    const root = temp();
    const outside = temp();
    const ctx = ctxFor(root);
    await rejects(files.planWrite(ctx, { path: '.env', content: 'A=1' }), 'secret');
    await rejects(files.planWrite(ctx, { path: '.git/hooks/pre-commit', content: '#!/bin/sh' }), 'secret');
    await rejects(files.planWrite(ctx, { path: '../escape.txt', content: 'x' }), 'outside_project');
    await rejects(files.planWrite(ctx, { path: 'big.txt', content: 'x'.repeat(files.LIMITS.maxWriteBytes + 1) }), 'too_large');
    await rejects(files.planWrite(ctx, { path: '.', content: 'x' }), 'bad_path');
    write(outside, 'target.txt', 'x');
    if (trySymlink(path.join(outside, 'target.txt'), path.join(root, 'link.txt'))) {
      await rejects(files.planWrite(ctx, { path: 'link.txt', content: 'overwritten' }), 'outside_project');
    }
    if (trySymlink(outside, path.join(root, 'linkdir'))) {
      await rejects(files.planWrite(ctx, { path: 'linkdir/new.txt', content: 'x' }), 'outside_project');
      assert.ok(!fs.existsSync(path.join(outside, 'new.txt')));
    }
  });

  it('shows a diff with a little context, and counts the changes', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].join('\n');
    const after = ['a', 'b', 'c', 'd', 'E', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm'].join('\n');
    const diff = files.unifiedDiff(before, after);
    assert.equal(diff.added, 2);
    assert.equal(diff.removed, 1);
    assert.match(diff.text, /-e\n\+E/);
    assert.match(diff.text, /\+m/);
    assert.equal(files.unifiedDiff('same', 'same').added, 0);
  });
});

describe('a session', () => {
  const approvals = [];
  const session = (root, answers, extra = {}) => {
    const queue = [...answers];
    return new AgentSession({
      root,
      name: 'demo',
      approve: async request => {
        approvals.push(request);
        return queue.shift() ?? 'deny';
      },
      ...extra,
    });
  };

  it('reads freely, without asking anyone', async () => {
    const root = temp();
    write(root, 'a.txt', 'hello');
    const before = approvals.length;
    const s = session(root, []);
    assert.equal((await s.callTool('read_file', { path: 'a.txt' })).ok, true);
    assert.equal((await s.callTool('list_directory', {})).ok, true);
    assert.equal((await s.callTool('find_files', { pattern: '*.txt' })).ok, true);
    assert.equal((await s.callTool('search_text', { pattern: 'hello' })).ok, true);
    assert.equal(approvals.length, before);
  });

  it('turns every failure into a result the model can read, never a crash', async () => {
    const s = session(temp(), []);
    const missing = await s.callTool('read_file', { path: 'nope.txt' });
    assert.equal(missing.ok, false);
    assert.match(missing.text, /no file or folder/);
    assert.equal((await s.callTool('format_disk', {})).ok, false);
    assert.equal((await s.callTool('read_file', null)).ok, false);
    assert.equal((await s.callTool('read_file', [])).ok, false);
  });

  it('asks before an edit, and changes nothing if the answer is no', async () => {
    const root = temp();
    const target = write(root, 'a.txt', 'one two');
    const s = session(root, ['deny']);
    await s.callTool('read_file', { path: 'a.txt' });
    const result = await s.callTool('edit_file', { path: 'a.txt', old_string: 'one', new_string: '1' });
    assert.equal(result.ok, false);
    assert.equal(result.display.denied, true);
    assert.match(result.text, /didn’t allow/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'one two');
    const asked = approvals[approvals.length - 1];
    assert.equal(asked.kind, 'edit');
    assert.match(asked.title, /Edit a\.txt\?/);
    assert.match(asked.detail, /\+1 −1/);
  });

  it('applies an approved edit, and remembers “this session” for later ones', async () => {
    const root = temp();
    const target = write(root, 'a.txt', 'one two three');
    const s = session(root, ['session']);
    await s.callTool('read_file', { path: 'a.txt' });
    const first = await s.callTool('edit_file', { path: 'a.txt', old_string: 'one', new_string: '1' });
    assert.equal(first.ok, true);
    assert.equal(first.display.kind, 'edit');
    const asked = approvals.length;
    const second = await s.callTool('edit_file', { path: 'a.txt', old_string: 'two', new_string: '2' });
    assert.equal(second.ok, true);
    assert.equal(approvals.length, asked, 'no second question');
    assert.equal(fs.readFileSync(target, 'utf8'), '1 2 three');
    const created = await s.callTool('write_file', { path: 'b/new.txt', content: 'hi' });
    assert.equal(created.display.kind, 'create');
    assert.equal(fs.readFileSync(path.join(root, 'b/new.txt'), 'utf8'), 'hi');
  });

  it('treats a dismissed dialog as no', async () => {
    const root = temp();
    const s = session(root, ['cancel']);
    assert.equal((await s.callTool('write_file', { path: 'x.txt', content: 'x' })).ok, false);
    assert.ok(!fs.existsSync(path.join(root, 'x.txt')));
  });

  it('asks before running a command, and doesn’t run it if refused', async () => {
    const root = temp();
    const s = session(root, ['deny']);
    const marker = path.join(root, 'ran.txt');
    const result = await s.callTool('run_command', { command: node(`require('fs').writeFileSync('ran.txt','x')`) });
    assert.equal(result.ok, false);
    assert.ok(!fs.existsSync(marker));
    assert.equal(approvals[approvals.length - 1].kind, 'command');
  });

  it('runs an approved command in the project, with its output and exit code', async () => {
    const root = temp();
    const s = session(root, ['once']);
    const result = await s.callTool('run_command', { command: node(`console.log('hello from', require('path').basename(process.cwd())); process.exit(3)`) });
    assert.equal(result.ok, true);
    assert.match(result.text, /hello from /);
    assert.match(result.text, /exited with code 3/);
    assert.equal(result.display.exitCode, 3);
  });

  it('remembers an exact command for the session, but not a different one', async () => {
    const root = temp();
    const s = session(root, ['session', 'deny']);
    const command = node(`console.log(1)`);
    await s.callTool('run_command', { command });
    const asked = approvals.length;
    assert.equal((await s.callTool('run_command', { command })).ok, true);
    assert.equal(approvals.length, asked);
    assert.equal((await s.callTool('run_command', { command: node(`console.log(2)`) })).ok, false);
    assert.equal(approvals.length, asked + 1);
  });

  it('hides credentials from commands', async () => {
    const root = temp();
    const s = session(root, ['once'], { env: { ...process.env, QUO_TEST_TOKEN: 'hunter2', QUO_TEST_PLAIN: 'visible' } });
    const result = await s.callTool('run_command', { command: node(`console.log(process.env.QUO_TEST_TOKEN || 'no token', process.env.QUO_TEST_PLAIN)`) });
    assert.match(result.text, /no token visible/);
    assert.ok(!result.text.includes('hunter2'));
  });

  it('stops a command that runs too long', async () => {
    const s = session(temp(), ['once']);
    const started = Date.now();
    const result = await s.callTool('run_command', { command: node(`setTimeout(() => {}, 60000)`), timeout_seconds: 1 });
    assert.equal(result.display.timedOut, true);
    assert.match(result.text, /timed out after 1s/);
    assert.ok(Date.now() - started < 15000);
  });

  it('stops a command when the turn is stopped', async () => {
    const s = session(temp(), ['once']);
    const controller = new AbortController();
    const pending = s.callTool('run_command', { command: node(`setTimeout(() => {}, 60000)`) }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 400);
    const result = await pending;
    assert.equal(result.display.aborted, true);
  });

  it('keeps the middle out of very long output, and removes secrets from it', async () => {
    const s = session(temp(), ['once']);
    const result = await s.callTool('run_command', { command: node(`console.log('a'.repeat(50000)); console.log('gh' + 'p_' + 'q'.repeat(36))`) });
    assert.match(result.text, /characters cut/);
    assert.ok(result.text.length < 40000);
    assert.ok(!result.text.includes('ghp_'));
  });

  it('keeps reference repositories read-only and requires opening them first', async () => {
    const s = session(temp(), []);
    const unopened = await s.callTool('read_file', { repo: 'facebook/react', path: 'README.md' });
    assert.match(unopened.text, /Open facebook\/react first/);
    const write = await s.callTool('write_file', { repo: 'facebook/react', path: 'x', content: 'x' });
    assert.match(write.text, /read-only/);
    const unavailable = await s.callTool('open_repo', { repo: 'facebook/react' });
    assert.equal(unavailable.ok, false);
  });

  it('has a limit on tool calls', async () => {
    const s = session(temp(), []);
    s.calls = 500;
    assert.equal((await s.callTool('list_directory', {})).display.code, 'limit');
  });
});

describe('reference repositories', () => {
  const zipResponse = (entries, status = 200) => new Response(Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([name, content]) => [name, typeof content === 'string' ? strToU8(content) : content])))), { status });
  const cacheWith = (handler, limits) => new RepoCache({ directory: path.join(temp(), 'repos'), fetchFn: async (url, init) => handler(String(url), init), limits });

  it('checks owner, name and ref, and takes a GitHub address too', () => {
    assert.equal(parseRepo('facebook/react').name, 'facebook/react');
    assert.equal(parseRepo('https://github.com/facebook/react.git/').name, 'facebook/react');
    assert.equal(parseRepo('a/b', 'feature/x-1').ref, 'feature/x-1');
    assert.equal(parseRepo('a/b').ref, 'HEAD');
    for (const bad of ['react', 'a/b/c', '../x', 'a/..', '-a/b', 'a b/c', 'a/b?x=1', 'a/b#x', '', undefined, 'http://evil.com/a/b/c']) {
      assert.throws(() => parseRepo(bad), error => error.code === 'bad_repo', String(bad));
    }
    for (const bad of ['../x', 'a/../b', 'x y', 'a?b=c', 'a%2e%2e', '/abs', 'x'.repeat(101)]) {
      assert.throws(() => parseRepo('a/b', bad), error => error.code === 'bad_ref', bad);
    }
  });

  it('cleans zip entry names and drops anything that could escape', () => {
    assert.equal(cleanName('react-main/src/index.js'), 'src/index.js');
    for (const bad of ['react-main/../../etc/passwd', '/etc/passwd', 'react-main/a\\b', 'C:/x', 'react-main/a:b', 'react-main/con ', 'react-main/a//b', 'react-main/./a', 'react-main/a\u0000b']) assert.equal(cleanName(bad), null, bad);
    assert.equal(cleanName('react-main/'), null);
    assert.equal(cleanName('react-main'), null);
  });

  it('downloads from GitHub’s download host only, unpacks it, and describes it', async () => {
    const urls = [];
    const cache = cacheWith(url => {
      urls.push(url);
      return zipResponse({ 'demo-main/README.md': '# Demo\nA demo.', 'demo-main/src/a.js': 'export const a = 1;', 'demo-main/src/deep/b.js': 'b' });
    });
    const repo = await cache.open('someone/demo', 'main');
    assert.deepEqual(urls, ['https://codeload.github.com/someone/demo/zip/main']);
    assert.equal(fs.readFileSync(path.join(repo.root, 'src/a.js'), 'utf8'), 'export const a = 1;');
    assert.deepEqual(repo.top, ['src/', 'README.md']);
    assert.match(repo.excerpt, /# Demo/);
  });

  it('skips unsafe entries, secrets, dependencies and big files, and never writes outside the folder', async () => {
    const outside = temp();
    const cache = cacheWith(() => zipResponse({
      'r-main/ok.txt': 'fine',
      'r-main/../../escape.txt': 'bad',
      'r-main/.env': 'SECRET=1',
      'r-main/keys/id_rsa': 'key',
      'r-main/node_modules/pkg/index.js': 'dep',
      'r-main/.git/config': '[remote "origin"]\nurl = https://github.com/x/y',
      'r-main/big.bin': new Uint8Array(3 * 1024 * 1024),
      'r-main/dist/out.js': 'built output is kept',
    }));
    const repo = await cache.open('o/r');
    const present = fs.readdirSync(repo.root, { recursive: true }).map(String).map(name => name.split(path.sep).join('/')).sort();
    assert.deepEqual(present.filter(name => !name.endsWith('/') && fs.statSync(path.join(repo.root, name)).isFile()).sort(), ['dist/out.js', 'ok.txt']);
    assert.ok(!fs.existsSync(path.join(path.dirname(repo.root), 'escape.txt')));
    assert.ok(!fs.existsSync(path.join(outside, 'escape.txt')));
  });

  it('refuses downloads that are too big, too many files, or from somewhere else', async () => {
    const big = cacheWith(() => zipResponse({ 'r-main/a.txt': 'x'.repeat(5000) }), { zipBytes: 100 });
    await rejects(big.open('o/r'), 'too_large');
    const crowded = cacheWith(() => zipResponse(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`r-main/f${i}.txt`, 'x']))), { files: 10 });
    await rejects(crowded.open('o/r'), 'too_large');
    const heavy = cacheWith(() => zipResponse({ 'r-main/a.txt': 'x'.repeat(5000), 'r-main/b.txt': 'x'.repeat(5000) }), { unpackedBytes: 6000 });
    await rejects(heavy.open('o/r'), 'too_large');
    const elsewhere = cacheWith(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/r.zip' } }));
    await rejects(elsewhere.open('o/r'), 'bad_redirect');
    const plain = cacheWith(() => new Response(null, { status: 302, headers: { location: 'http://codeload.github.com/r.zip' } }));
    await rejects(plain.open('o/r'), 'bad_redirect');
  });

  it('says plainly when a repository isn’t there, is private, or GitHub can’t be reached', async () => {
    await rejects(cacheWith(() => new Response('', { status: 404 })).open('o/r'), 'repo_not_found');
    await rejects(cacheWith(() => new Response('', { status: 429 })).open('o/r'), 'rate_limited');
    await rejects(cacheWith(() => new Response('', { status: 500 })).open('o/r'), 'download_failed');
    await rejects(cacheWith(() => { throw new TypeError('fetch failed'); }).open('o/r'), 'offline');
  });

  it('reuses what it has, refreshes after a day, and removes the least recently used when full', async () => {
    let downloads = 0;
    let clock = 1_000_000;
    const cache = new RepoCache({
      directory: path.join(temp(), 'repos'),
      fetchFn: async () => {
        downloads++;
        return zipResponse({ 'r-main/a.txt': 'x'.repeat(1000) });
      },
      now: () => clock,
      limits: { cacheBytes: 2500 },
    });
    const first = await cache.open('o/one');
    await cache.open('o/one');
    assert.equal(downloads, 1, 'second open reuses the download');
    clock += 25 * 60 * 60 * 1000;
    await cache.open('o/one');
    assert.equal(downloads, 2, 'a day later it is fetched again');
    await cache.open('o/two');
    await cache.open('o/three');
    assert.ok(!fs.existsSync(first.root), 'the oldest was removed to stay under the limit');
    const kept = await cache.open('o/three');
    assert.ok(fs.existsSync(kept.root));
  });

  it('lets a session read an opened repository, and nothing outside it', async () => {
    const cache = cacheWith(() => zipResponse({ 'lib-main/README.md': 'Library', 'lib-main/src/core.js': 'export function core() {}' }));
    const root = temp();
    write(root, 'mine.txt', 'mine');
    const s = new AgentSession({ root, name: 'demo', approve: async () => 'deny', repos: cache });
    const opened = await s.callTool('open_repo', { repo: 'someone/lib' });
    assert.equal(opened.ok, true);
    assert.match(opened.text, /Opened someone\/lib/);
    assert.match(opened.text, /Library/);
    assert.match((await s.callTool('read_file', { repo: 'someone/lib', path: 'src/core.js' })).text, /export function core/);
    assert.match((await s.callTool('search_text', { repo: 'Someone/Lib', pattern: 'core' })).text, /src\/core\.js:1/);
    assert.equal((await s.callTool('read_file', { repo: 'someone/lib', path: '../../mine.txt' })).ok, false);
    assert.equal((await s.callTool('read_file', { path: 'src/core.js' })).ok, false, 'the project doesn’t see the repository’s files');
    assert.equal((await s.callTool('edit_file', { repo: 'someone/lib', path: 'src/core.js', old_string: 'a', new_string: 'b' })).display.code, 'read_only');
  });
});
