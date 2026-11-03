'use strict';

// quo:// links from outside the app (Hugging Face's "Use this model"): only one shape opens anything, it only shows a
// model, and only the app's own page can collect it. Tries to abuse each part.

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { describe, it } = require('node:test');
const { parseModelLink, linkInArgs, setupLinks } = require('../src/links');

describe('which links Quo understands', () => {
  it('reads a Hugging Face model, with or without a file', () => {
    assert.deepEqual(parseModelLink('quo://models/huggingface/unsloth/gemma-4-E2B-it-GGUF'), { repo: 'unsloth/gemma-4-E2B-it-GGUF' });
    assert.deepEqual(parseModelLink('quo://models/huggingface/unsloth/gemma-4-E2B-it-GGUF/'), { repo: 'unsloth/gemma-4-E2B-it-GGUF' });
    assert.deepEqual(parseModelLink('quo://models/huggingface/bartowski/Qwen_3.5-9B-GGUF?file=Qwen_3.5-9B-Q4_K_M.gguf'), { repo: 'bartowski/Qwen_3.5-9B-GGUF', file: 'Qwen_3.5-9B-Q4_K_M.gguf' });
    assert.deepEqual(parseModelLink('quo://models/huggingface/a/b?file=sub%2Fmodel-Q8_0.gguf'), { repo: 'a/b', file: 'sub/model-Q8_0.gguf' });
  });

  it('ignores every other address, scheme and shape', () => {
    for (const href of [
      'https://huggingface.co/unsloth/gemma', 'javascript:alert(1)', 'file:///etc/passwd', 'app://quo/index.html',
      'quo://agent/run?cmd=rm', 'quo://models/ollama/a/b', 'quo://models/huggingface/onlyowner', 'quo://models/huggingface/a/b/c',
      'quo://models/huggingface//b', 'quo://models/huggingface/../b', 'quo://models/huggingface/a/..', 'quo://models/huggingface/a/b..c',
      'quo://models/huggingface/a%2Fb/c', 'quo://models/huggingface/-a/b', 'quo://models/huggingface/a/b c',
      'quo://user:pass@models/huggingface/a/b', 'quo://models:99/huggingface/a/b', 'quo://models/huggingface/a/b#x',
      'quo://evil.com/huggingface/a/b', 'quo:models/huggingface/a/b', `quo://models/huggingface/${'a'.repeat(97)}/b`,
      `quo://models/huggingface/a/b?file=${'x'.repeat(600)}.gguf`, '', 'not a link',
    ]) assert.equal(parseModelLink(href), null, href);
    for (const value of [undefined, null, 42, {}, ['quo://models/huggingface/a/b']]) assert.equal(parseModelLink(value), null);
  });

  it('takes only a .gguf inside the repository as the file, and no other options', () => {
    for (const file of ['../../etc/passwd.gguf', '/abs/model.gguf', '.hidden.gguf', 'model.bin', 'model.gguf.exe', 'a\\b.gguf', 'x/../y.gguf', 'model .gguf', 'C:%5Cm.gguf']) {
      assert.equal(parseModelLink(`quo://models/huggingface/a/b?file=${encodeURIComponent(file)}`), null, file);
    }
    assert.equal(parseModelLink('quo://models/huggingface/a/b?file=m.gguf&download=1'), null);
    assert.equal(parseModelLink('quo://models/huggingface/a/b?file=m.gguf&file=n.gguf'), null);
    assert.equal(parseModelLink('quo://models/huggingface/a/b?run=1'), null);
  });

  it('finds the link among a program’s arguments', () => {
    assert.equal(linkInArgs(['/opt/Quo/quo-desktop', '--no-sandbox', 'quo://models/huggingface/a/b']), 'quo://models/huggingface/a/b');
    assert.equal(linkInArgs(['quo-desktop', '--flag']), undefined);
    assert.equal(linkInArgs(null), undefined);
  });
});

describe('how a link reaches the page', () => {
  const fakeElectron = ({ packaged = true } = {}) => {
    const app = Object.assign(new EventEmitter(), { isPackaged: packaged, registered: [], setAsDefaultProtocolClient(scheme) { this.registered.push(scheme); } });
    const handlers = new Map();
    return { app, ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) }, handlers };
  };
  const page = { senderFrame: { url: 'app://quo/index.html' } };

  it('keeps the link that started the app until the page takes it, once', () => {
    const electron = fakeElectron();
    const links = setupLinks({ getWindow: () => null, focus: () => {}, electron, argv: ['quo', 'quo://models/huggingface/a/b?file=m.gguf'] });
    links.start({ enabled: true });
    assert.deepEqual(electron.app.registered, ['quo']);
    const take = electron.handlers.get('links:take');
    assert.deepEqual(take(page), { ok: { repo: 'a/b', file: 'm.gguf' } });
    assert.deepEqual(take(page), { ok: null });
  });

  it('takes a link in the smoke test without making that build the one quo:// opens', () => {
    const electron = fakeElectron();
    const links = setupLinks({ getWindow: () => null, focus: () => {}, electron, argv: ['quo', '--smoke', 'quo://models/huggingface/a/b'] });
    links.start({ enabled: true, register: false });
    assert.deepEqual(electron.app.registered, []);
    assert.deepEqual(electron.handlers.get('links:take')(page), { ok: { repo: 'a/b' } });
  });

  it('tells a running app, focuses it, and keeps only links it understands', () => {
    const electron = fakeElectron();
    const sent = [];
    let focused = 0;
    const win = { isDestroyed: () => false, webContents: { send: channel => sent.push(channel) } };
    const links = setupLinks({ getWindow: () => win, focus: () => focused++, electron, argv: [] });
    links.start({ enabled: true });
    links.fromArgs(['quo', 'quo://agent/run?cmd=rm']);
    const event = { preventDefault() { this.prevented = true; } };
    electron.app.emit('open-url', event, 'javascript:alert(1)');
    assert.equal(event.prevented, true);
    assert.deepEqual([sent, focused], [[], 0]);
    electron.app.emit('open-url', event, 'quo://models/huggingface/a/b');
    assert.deepEqual([sent, focused], [['links:open'], 1]);
    assert.deepEqual(electron.handlers.get('links:take')(page), { ok: { repo: 'a/b' } });
  });

  it('gives nothing to any other page, and does nothing without the engine or in a dev build', () => {
    const electron = fakeElectron();
    const links = setupLinks({ getWindow: () => null, focus: () => {}, electron, argv: ['quo', 'quo://models/huggingface/a/b'] });
    links.start({ enabled: true });
    for (const url of ['https://huggingface.co/', 'app://other/', 'file:///x']) assert.equal(electron.handlers.get('links:take')({ senderFrame: { url } }).error.code, 'untrusted');
    assert.deepEqual(electron.handlers.get('links:take')(page), { ok: { repo: 'a/b' } }); // still there for the app itself

    const noEngine = fakeElectron();
    setupLinks({ getWindow: () => null, focus: () => {}, electron: noEngine, argv: ['quo', 'quo://models/huggingface/a/b'] }).start({ enabled: false });
    assert.deepEqual([noEngine.app.registered, noEngine.handlers.size], [[], 0]);

    const dev = fakeElectron({ packaged: false });
    setupLinks({ getWindow: () => null, focus: () => {}, electron: dev, argv: [] }).start({ enabled: true });
    assert.deepEqual(dev.app.registered, []);
  });
});
