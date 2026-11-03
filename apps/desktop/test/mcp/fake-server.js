'use strict';

// A stand-in tool server (MCP over stdio) for the tests. It answers like a real one, and also misbehaves: it writes a log
// line to its output, asks Quo for things Quo doesn't offer, returns secrets, pictures and far too much text.

const readline = require('node:readline');

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
const asked = [];
const TOOLS = [
  { name: 'echo', description: 'Says back what it is given.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
  { name: 'leak', description: 'Returns a token.', inputSchema: { type: 'object' } },
  { name: 'picture', description: 'Returns a picture and a caption.', inputSchema: { type: 'object' } },
  { name: 'huge', description: 'Returns a lot.', inputSchema: { type: 'object' } },
  { name: 'broken', description: 'Fails.', inputSchema: { type: 'object' } },
  { name: 'what was I told', description: 'Says what Quo answered to its own questions.', inputSchema: { type: 'object' } },
  { name: 'env', description: 'Says which environment settings it has.', inputSchema: { type: 'object' } },
];

process.stdout.write('starting up (a log line where a message should be)\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.id !== undefined && !message.method) return asked.push(message); // Quo's answer to our question
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'fake', version: '1' } } });
    // Asks for the model and the person's folders, which Quo must refuse.
    send({ jsonrpc: '2.0', id: 900, method: 'sampling/createMessage', params: { messages: [] } });
    send({ jsonrpc: '2.0', id: 901, method: 'roots/list' });
    send({ jsonrpc: '2.0', id: 902, method: 'ping' });
    return;
  }
  if (message.method === 'tools/list') return send({ jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } });
  if (message.method !== 'tools/call') return;
  const { name, arguments: args } = message.params;
  const reply = result => send({ jsonrpc: '2.0', id: message.id, result });
  if (name === 'echo') return reply({ content: [{ type: 'text', text: `You said: ${args.text}` }] });
  if (name === 'leak') return reply({ content: [{ type: 'text', text: `Here: ${'gh' + 'p_'}${'A'.repeat(36)}` }] });
  if (name === 'picture') return reply({ content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }, { type: 'text', text: 'A caption' }] });
  if (name === 'huge') return reply({ content: [{ type: 'text', text: 'x'.repeat(200_000) }] });
  if (name === 'broken') return reply({ content: [{ type: 'text', text: 'It broke.' }], isError: true });
  if (name === 'what was I told') return reply({ content: [{ type: 'text', text: JSON.stringify(asked) }] });
  if (name === 'env') return reply({ content: [{ type: 'text', text: Object.keys(process.env).sort().join(',') }] });
});
