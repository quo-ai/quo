'use strict';

// The tool servers (MCP) the person added and turned on: started from main only, after a native dialog approved exactly
// what each runs (config.js keeps the fingerprint), stopped when turned off, when their entry changes and when Quo quits.
// Models see each tool as `mcp__<server>__<tool>`; every call goes through Code mode's approvals first (agent/session.js,
// ipc.js for chats without a folder). What a tool returns reaches the model as text, secrets redacted, within a limit.

const os = require('node:os');
const { EventEmitter } = require('node:events');
const { McpClient } = require('./client');
const { readConfig, readApprovals, writeApprovals } = require('./config');
const { redactSecrets, scrubbedEnv } = require('../agent/safety');

const MAX_TOOLS = 40;
const MAX_DESCRIPTION = 1000;
const MAX_SCHEMA = 16_000;
const MAX_RESULT = 40_000;
const PREFIX = 'mcp__';

const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}… (cut: the tool returned more than Quo passes on)` : text);
const wordOf = value => String(value).replace(/[^A-Za-z0-9_-]/g, '_');

/** A tool's result as text for the model: words kept, pictures and sounds left out (said so), secrets redacted. */
function resultText(result, maxChars = MAX_RESULT) {
  const parts = [];
  for (const item of Array.isArray(result?.content) ? result.content : []) {
    if (item?.type === 'text' && typeof item.text === 'string') parts.push(item.text);
    else if (item?.type === 'image' || item?.type === 'audio') parts.push(`[${item.type === 'image' ? 'A picture' : 'A sound'} (${String(item.mimeType ?? '').slice(0, 40)}) was left out: Quo passes on text only.]`);
    else if (item?.type === 'resource') parts.push(typeof item.resource?.text === 'string' ? item.resource.text : `[A file: ${String(item.resource?.uri ?? '').slice(0, 300)}]`);
    else if (item?.type === 'resource_link') parts.push(`[${String(item.name ?? 'Link').slice(0, 100)}: ${String(item.uri ?? '').slice(0, 300)}]`);
  }
  if (!parts.length && result?.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
  return clip(redactSecrets(parts.join('\n\n') || '(The tool returned nothing.)'), maxChars);
}

class McpManager extends EventEmitter {
  /** @param {{ configFile: string, approvalsFile: string, version: string, env?: NodeJS.ProcessEnv, platform?: string, spawnImpl?: Function }} options */
  constructor({ configFile, approvalsFile, version, env = process.env, platform = process.platform, spawnImpl }) {
    super();
    Object.assign(this, { configFile, approvalsFile, version, env, platform, spawnImpl });
    this.entries = [];
    this.problem = null;
    this.approvals = {};
    this.running = new Map(); // name → { client, fingerprint, state, message }
    this.tools = new Map(); // full name → { server, tool, description, parameters }
  }

  /** Reads the file and what was approved, and starts what is on (at launch, and after the file changed). */
  async load() {
    const config = await readConfig(this.configFile);
    this.entries = config.servers;
    this.problem = config.problem ?? null;
    this.approvals = await readApprovals(this.approvalsFile);
    for (const [name, run] of this.running) {
      const entry = this.entries.find(one => one.name === name);
      if (!entry || entry.fingerprint !== run.fingerprint || entry.disabled) this.stopOne(name);
    }
    await Promise.all(this.entries.filter(entry => this.isOn(entry) && !this.running.has(entry.name)).map(entry => this.startOne(entry)));
    this.changed();
  }

  entry(name) {
    return this.entries.find(one => one.name === name && !one.problem) ?? null;
  }

  approved(entry) {
    return this.approvals[entry.name]?.fingerprint === entry.fingerprint;
  }

  isOn(entry) {
    return !entry.problem && !entry.disabled && this.approved(entry) && this.approvals[entry.name].on;
  }

  /** What settings show: names, states, tool names and descriptions, problems. Never a command, an argument or a value. */
  state() {
    const servers = this.entries.map(entry => {
      if (entry.problem) return { name: entry.name, state: 'problem', message: entry.problem, tools: [] };
      const run = this.running.get(entry.name);
      const changed = Boolean(this.approvals[entry.name]) && !this.approved(entry);
      const state = run ? run.state : entry.disabled ? 'disabled' : changed ? 'changed' : 'off';
      const tools = [...this.tools.values()].filter(tool => tool.server === entry.name).map(tool => ({ name: tool.tool, description: tool.description.slice(0, 200) }));
      return { name: entry.name, state, tools, ...(run?.message ? { message: run.message } : changed ? { message: 'Its entry in the file changed. Turn it on again to approve what it runs now.' } : {}) };
    });
    return { servers, ...(this.problem ? { problem: this.problem } : {}) };
  }

  /** Turns a server on: `confirm(entry)` (a native dialog showing what it runs) unless that exact entry was approved. */
  async turnOn(name, confirm) {
    const entry = this.entry(name);
    if (!entry) throw new Error('unknown_server');
    if (entry.disabled) throw new Error('disabled');
    if (!this.approved(entry) && !(await confirm(entry))) return this.state();
    this.approvals[name] = { fingerprint: entry.fingerprint, on: true };
    await writeApprovals(this.approvalsFile, this.approvals);
    if (!this.running.has(name)) await this.startOne(entry);
    this.changed();
    return this.state();
  }

  async turnOff(name) {
    if (this.approvals[name]) {
      this.approvals[name].on = false;
      await writeApprovals(this.approvalsFile, this.approvals);
    }
    this.stopOne(name);
    this.changed();
    return this.state();
  }

  async startOne(entry) {
    // Scrubbed like Code mode's commands (no tokens or keys of Quo's own environment), plus what the person put in "env".
    const env = { ...scrubbedEnv(this.env), ...entry.env };
    const client = new McpClient({ name: entry.name, command: entry.command, args: entry.args, env, cwd: entry.cwd ?? os.homedir(), version: this.version, platform: this.platform, ...(this.spawnImpl ? { spawnImpl: this.spawnImpl } : {}) });
    const run = { client, fingerprint: entry.fingerprint, state: 'starting', message: '' };
    this.running.set(entry.name, run);
    this.changed();
    client.on('tools', () => {
      this.indexTools();
      this.changed();
    });
    client.on('exit', reason => {
      if (this.running.get(entry.name) !== run) return;
      run.state = 'error';
      run.message = reason;
      this.indexTools();
      this.changed();
    });
    try {
      await client.start();
      if (this.running.get(entry.name) === run && run.state === 'starting') run.state = 'on';
    } catch (error) {
      run.state = 'error';
      run.message = error?.message ?? 'The tool server couldn’t be started.';
      client.close();
    }
    this.indexTools();
    this.changed();
  }

  stopOne(name) {
    const run = this.running.get(name);
    if (!run) return;
    this.running.delete(name);
    run.client.close();
    this.indexTools();
  }

  /** The tools of running servers, under names models accept (letters, digits, _ and -, at most 64), first ones first. */
  indexTools() {
    this.tools.clear();
    for (const [server, run] of this.running) {
      if (run.state !== 'on') continue;
      for (const tool of run.client.tools) {
        if (this.tools.size >= MAX_TOOLS) return;
        const name = `${PREFIX}${server}__${wordOf(tool.name)}`.slice(0, 64);
        if (this.tools.has(name)) continue;
        const schema = tool.inputSchema && typeof tool.inputSchema === 'object' && tool.inputSchema.type === 'object' ? tool.inputSchema : { type: 'object', properties: {} };
        if (JSON.stringify(schema).length > MAX_SCHEMA) continue;
        this.tools.set(name, { server, tool: tool.name, description: String(tool.description ?? '').slice(0, MAX_DESCRIPTION), parameters: schema });
      }
    }
  }

  has(name) {
    return this.tools.has(name);
  }

  describe(name) {
    const tool = this.tools.get(name);
    return tool ? { server: tool.server, tool: tool.tool } : null;
  }

  /** Definitions for models, as the agent's own tools are given (shared/agentTools.ts). */
  definitions() {
    return [...this.tools.entries()].map(([name, tool]) => ({ name, description: `${tool.description || tool.tool} (From the tool server “${tool.server}” the user added.)`, parameters: tool.parameters }));
  }

  /** Runs a tool the person already approved (the caller asks). A failure is a result the model can read, not a throw. */
  async call(name, args, { signal, maxChars = MAX_RESULT } = {}) {
    const tool = this.tools.get(name);
    const run = tool ? this.running.get(tool.server) : null;
    const display = { kind: 'tool', server: tool?.server ?? '', tool: tool?.tool ?? name };
    if (!tool || !run || run.state !== 'on') return { ok: false, text: 'That tool server isn’t running. The user can turn it on in Settings → Tool servers.', display: { ...display, error: true } };
    try {
      const result = await run.client.call(tool.tool, args, { signal });
      const text = resultText(result, maxChars);
      return { ok: result?.isError !== true, text, display: { ...display, ...(result?.isError ? { error: true } : {}) } };
    } catch (error) {
      return { ok: false, text: error?.message ?? 'The tool server didn’t answer.', display: { ...display, error: true } };
    }
  }

  changed() {
    this.emit('changed', this.state());
  }

  closeAll() {
    for (const name of [...this.running.keys()]) this.stopOne(name);
  }
}

module.exports = { McpManager, resultText, PREFIX, MAX_TOOLS };
