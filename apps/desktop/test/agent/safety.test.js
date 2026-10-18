'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const safety = require('../../src/agent/safety');
const { temp, write, throwsCode, trySymlink } = require('./helpers');

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
