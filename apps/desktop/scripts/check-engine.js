'use strict';

// Checks the bundled llama.cpp engine without Electron.
//
//   node scripts/check-engine.js --version
//       Just runs llama-server --version: proves the binary and its libraries
//       load on this OS (what CI does for each platform).
//   node scripts/check-engine.js <model.gguf> [mmproj.gguf]
//       Loads the model and streams real replies, tests thinking, stopping
//       and (with an mmproj) an image. Prints speeds.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { LlamaEngine, engineTarget } = require('../src/engine/llama');

const target = engineTarget();
const directory = process.env.QUO_ENGINE_DIR ?? path.join(__dirname, '..', 'engine', target ?? 'unsupported');
const engine = new LlamaEngine({ directory });

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

/** A 192x192 PNG: a red circle on a white background. */
function redCirclePng() {
  const size = 192;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3, 255);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      if ((x - 96) ** 2 + (y - 96) ** 2 < 70 ** 2) {
        row[1 + x * 3] = 220;
        row[2 + x * 3] = 30;
        row[3 + x * 3] = 30;
      }
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Streams a chat completion; returns text, reasoning, speed, and time to first token. */
async function chat(messages, extra = {}, { abortAfterMs } = {}) {
  const { origin, key } = engine.target();
  const controller = new AbortController();
  if (abortAfterMs) setTimeout(() => controller.abort(), abortAfterMs);
  const started = performance.now();
  let first = 0;
  let content = '';
  let reasoning = '';
  let timings = null;
  try {
    const response = await fetch(`${origin}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ messages, stream: true, max_tokens: 200, temperature: 0.7, ...extra }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const part of response.body) {
      buffer += decoder.decode(part, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop();
      for (const event of events) {
        const data = event.replace(/^data: /, '');
        if (!data || data === '[DONE]') continue;
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta ?? {};
        if ((delta.content || delta.reasoning_content) && !first) first = performance.now();
        content += delta.content ?? '';
        reasoning += delta.reasoning_content ?? '';
        if (chunk.timings) timings = chunk.timings;
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  }
  return { content, reasoning, timings, firstTokenMs: first ? Math.round(first - started) : null, aborted: controller.signal.aborted };
}

(async () => {
  if (!target || !engine.available) {
    console.error(`No engine at ${directory}. Run: npm run fetch:engine`);
    process.exit(1);
  }

  if (process.argv.includes('--version')) {
    const run = spawnSync(engine.binary, ['--version'], { cwd: directory, encoding: 'utf8', windowsHide: true });
    if (run.status !== 0) {
      console.error(run.error?.message ?? run.stderr);
      process.exit(1);
    }
    console.log(`${run.stdout}${run.stderr}`.trim().split('\n')[0]);
    return;
  }

  const [modelPath, mmprojPath] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  if (!modelPath || !fs.existsSync(modelPath)) {
    console.error('Usage: node scripts/check-engine.js --version | <model.gguf> [mmproj.gguf]');
    process.exit(1);
  }

  console.log('devices:', JSON.stringify(await engine.devices()));
  const t0 = performance.now();
  const status = await engine.start({ modelId: 'check', modelPath, mmprojPath, contextSize: 8192 });
  console.log(`loaded in ${Math.round(performance.now() - t0)} ms:`, JSON.stringify(status));

  const plain = await chat([{ role: 'user', content: 'Write three sentences about bicycles.' }], { chat_template_kwargs: { enable_thinking: false } });
  console.log(`reply: ${plain.timings?.predicted_per_second.toFixed(1)} tok/s, first token ${plain.firstTokenMs} ms, prompt ${plain.timings?.prompt_per_second.toFixed(0)} tok/s`);
  console.log(`  "${plain.content.trim().slice(0, 90)}…"`);
  if (!plain.content.trim()) fail('no reply text');
  if (plain.reasoning) fail('reasoning appeared with thinking off');

  const thinking = await chat([{ role: 'user', content: 'What is 17 times 23? Be brief.' }], { chat_template_kwargs: { enable_thinking: true }, max_tokens: 400 });
  console.log(`thinking on: reasoning ${thinking.reasoning.length} chars, answer ${thinking.content.length} chars`);
  if (!thinking.reasoning) console.log('  (this model produced no separate reasoning)');

  // Stopping: with one slot, a new request only starts quickly if the aborted one stopped.
  const stopped = await chat([{ role: 'user', content: 'Count from 1 to 500, one number per line.' }], { max_tokens: 1500 }, { abortAfterMs: 700 });
  const after = await chat([{ role: 'user', content: 'Say "ok".' }], { max_tokens: 8 });
  console.log(`stop: aborted=${stopped.aborted}, next reply started in ${after.firstTokenMs} ms`);
  if (!stopped.aborted || after.firstTokenMs === null || after.firstTokenMs > 3000) fail('stopping a reply did not free the engine');

  if (mmprojPath) {
    const image = `data:image/png;base64,${redCirclePng().toString('base64')}`;
    const seen = await chat(
      [{ role: 'user', content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: 'What colour is the shape in this image? Answer with one word.' }] }],
      { chat_template_kwargs: { enable_thinking: false }, max_tokens: 30 },
    );
    console.log(`vision: "${seen.content.trim()}"`);
    if (!/red/i.test(seen.content)) fail('the model did not describe the image correctly');
  }

  await engine.stop();
  console.log(process.exitCode ? 'FAILED' : 'OK');
})().catch(error => {
  fail(error.stack ?? String(error));
  engine.killNow();
});
