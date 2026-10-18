'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { blockedName, check, scanText } = require('./check-secrets');

// Fake secrets are assembled here so none sits in the source for a scanner to find.
const fake = {
  privateKey: `${'-----BEGIN RSA '}${'PRIVATE KEY-----'}\nabc\n${'-----END RSA '}${'PRIVATE KEY-----'}`,
  aws: `${'AK'}${'IA'}${'ABCDEFGHIJKLMNOP'}`,
  github: `${'gh'}${'p_'}${'a'.repeat(36)}`,
  openai: `${'sk'}-${'b'.repeat(40)}`,
  anthropic: `${'sk'}-${'ant'}-${'c'.repeat(40)}`,
  slack: `${'xo'}${'xb-'}${'1'.repeat(12)}`,
  google: `${'AI'}${'za'}${'d'.repeat(35)}`,
  database: `${'post'}${'gres://'}admin:${'hunter2hunter2'}@db.example.com/app`,
};
const rules = text => scanText(text, 'a.txt').map(finding => finding.rule);
// Addresses and home folders are assembled too: the scanner would (rightly) refuse this file otherwise.
const email = (name, domain) => `${name}@${domain}`;
const home = (root, name, rest) => `${root}${name}${rest}`;

describe('file names that must never be committed', () => {
  it('blocks .env files, keys, keystores and credentials, wherever they are', () => {
    for (const file of ['.env', 'apps/web/.env.production', '.env.local', 'server.pem', 'a/b/tls.key', 'release.jks', 'upload.keystore', 'AuthKey.p8', 'x.p12', 'id_rsa', 'home/.ssh/config', '.netrc',
      'apps/mobile/android/signing.properties', 'apps/mobile/android/app/google-services.json', 'GoogleService-Info.plist', 'apps/web/.vercel/project.json', 'credentials.json', 'secrets.yaml', 'service-account-prod.json', 'terraform.tfstate']) {
      assert.ok(blockedName(file), file);
    }
  });

  it('allows examples, public keys, ordinary files, and the standard Android debug key', () => {
    for (const file of ['.env.example', 'apps/web/.env.sample', '.env.template', 'id_rsa.pub', 'src/env.ts', 'README.md', 'GoogleService-Info.plist.example', 'apps/mobile/android/signing.properties.example', 'apps/mobile/android/app/debug.keystore']) {
      assert.equal(blockedName(file), null, file);
    }
    assert.ok(blockedName('other/debug.keystore'), 'only the one known debug key is allowed');
  });
});

describe('secrets inside files', () => {
  it('finds each kind, and says only where and what kind', () => {
    assert.deepEqual(rules(fake.privateKey), ['a private key']);
    assert.deepEqual(rules(`key ${fake.aws}`), ['an AWS access key']);
    assert.deepEqual(rules(`t ${fake.github}`), ['a GitHub token']);
    assert.deepEqual(rules(`k ${fake.openai}`), ['an API key (OpenAI, Anthropic or OpenRouter)']);
    assert.deepEqual(rules(`k ${fake.anthropic}`), ['an API key (OpenAI, Anthropic or OpenRouter)']);
    assert.deepEqual(rules(`t ${fake.slack}`), ['a Slack token']);
    assert.deepEqual(rules(`k ${fake.google}`), ['a Google API key']);
    assert.deepEqual(rules(`DATABASE_URL=${fake.database}`), ['a database URL with a password']);
    const finding = scanText(`line one\nline two ${fake.github}`, 'a.txt')[0];
    assert.deepEqual(Object.keys(finding).sort(), ['line', 'rule']);
    assert.equal(finding.line, 2);
    assert.ok(!JSON.stringify(scanText(fake.github, 'a.txt')).includes('ghp_'));
  });

  it('finds a hard-coded secret, but not a word-and-dash test value or an environment lookup', () => {
    assert.deepEqual(rules(`const apiKey = "${'a1b2c3d4'.repeat(4)}";`), ['a hard-coded secret']);
    assert.deepEqual(rules(`password: '${'Zq9'.repeat(10)}'`), ['a hard-coded secret']);
    assert.deepEqual(rules("config.cronSecret = 'cron-secret-for-tests-but-wrong';"), []);
    assert.deepEqual(rules('const token = process.env.API_TOKEN;'), []);
    assert.deepEqual(rules('API_TOKEN=your-token-here'), []);
  });

  it('leaves ordinary code and prose alone', () => {
    assert.deepEqual(rules('function skip(a) { return a } // sk- is the prefix; AKIA is mentioned; ghp_ too'), []);
    assert.deepEqual(rules('The quick brown fox jumps over the lazy dog. https://example.com/a?b=c'), []);
  });
});

describe('personal traces', () => {
  it('finds a home folder with someone’s name in it, but not placeholders or CI users', () => {
    for (const bad of [home('/home/', 'alice', '/projects/app'), home('/Users/', 'bob', '/Desktop'), home('C:\\Users\\', 'carol', '\\code'), home('C:\\\\Users\\\\', 'dave', '\\\\x')]) assert.deepEqual(rules(`cd ${bad}`), ['a local path with a personal name in it'], bad);
    for (const fine of ['/home/runner/work', '/home/user/app', '/Users/you/x', '/home/dev', '/home/node', '/home/$USER/x', 'C:\\Users\\runneradmin\\x', '/home/<you>/x']) assert.deepEqual(rules(`cd ${fine}`), [], fine);
  });

  it('finds an email address that is not ours, and allows ours, placeholders and noreply addresses', () => {
    assert.deepEqual(rules(`contact ${email('someone.private', 'proton.me')}`), ['an email address that isn’t ours']);
    assert.deepEqual(rules(`contact ${email('astralabsltd', 'gmail.com')}`), []);
    assert.deepEqual(rules(`${email('me', 'example.com')}, ${email('a', 'example.org')}, ${email('123+user', 'users.noreply.github.com')}, ${email('hello', 'quoai.app')}`), []);
  });

  it('does not read lockfiles, where package authors’ addresses are listed', () => {
    const author = `"author": "Someone <${email('someone', 'gmail.com')}>"`;
    assert.deepEqual(scanText(author, 'package-lock.json'), []);
    assert.deepEqual(scanText(author, 'apps/web/package.json').map(f => f.rule), ['an email address that isn’t ours']);
  });
});

describe('checking a repository', () => {
  function repo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quo-secrets-'));
    const run = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    run('init', '-q');
    run('config', 'user.email', '1+t@users.noreply.github.com');
    run('config', 'user.name', 't');
    return { dir, run, write: (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); } };
  }

  it('passes a clean repository', () => {
    const { dir, run, write } = repo();
    write('a.js', 'console.log(1)\n');
    write('.env.example', 'TOKEN=your-token\n');
    run('add', '.');
    assert.deepEqual(check({ cwd: dir }), []);
    assert.deepEqual(check({ cwd: dir, staged: true }), []);
  });

  it('stops a staged secrets file or token, and says where without saying what', () => {
    const { dir, run, write } = repo();
    write('.env', 'A=1\n');
    write('src/config.js', `export const t = '${fake.github}';\n`);
    run('add', '-f', '.');
    const problems = check({ cwd: dir, staged: true });
    assert.equal(problems.length, 2);
    assert.ok(problems.some(p => p.includes('.env is an .env file')));
    assert.ok(problems.some(p => p.includes('src/config.js:1 has a GitHub token')));
    assert.ok(!problems.join('\n').includes('ghp_'));
  });

  it('finds what is in the working files even if it isn’t staged yet', () => {
    const { dir, run, write } = repo();
    write('a.js', 'ok\n');
    run('add', '.');
    write('a.js', `const k = '${fake.openai}';\n`);
    assert.equal(check({ cwd: dir }).length, 1);
    assert.deepEqual(check({ cwd: dir, staged: true }), []);
  });

  it('finds, in history, a secret that was committed and then deleted', () => {
    const { dir, run, write } = repo();
    write('keys.js', `export const k = '${fake.aws}';\n`);
    write('server.pem', 'x\n');
    run('add', '-f', '.');
    run('commit', '-q', '-m', 'oops');
    run('rm', '-q', '-f', 'keys.js', 'server.pem');
    run('commit', '-q', '-m', 'remove it');
    assert.deepEqual(check({ cwd: dir }), [], 'gone from the files now');
    const history = check({ cwd: dir, history: true });
    assert.ok(history.some(p => p.includes('history: keys.js:1 has an AWS access key')), history.join('\n'));
    assert.ok(history.some(p => p.includes('history: server.pem is a key, certificate or keystore')));
  });
});
