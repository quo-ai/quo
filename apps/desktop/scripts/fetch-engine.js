'use strict';

// Downloads the pinned llama.cpp release for each target, checks its SHA-256
// against engine.lock.json, and unpacks it to engine/<target>/ (gitignored).
// electron-builder bundles that folder, so the app ships the exact build
// listed in the lock file and never downloads code at run time.
//
//   node scripts/fetch-engine.js                 current platform
//   node scripts/fetch-engine.js mac-arm64 mac-x64
//   node scripts/fetch-engine.js --all
//
// To update llama.cpp: pick a release, put its asset names and SHA-256 (shown
// on the release page) in engine.lock.json, run this, then `npm run smoke:engine`.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'engine.lock.json'), 'utf8'));
const cacheDir = path.join(root, '.engine-cache');

function currentTarget() {
  const platform = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform];
  const arch = { arm64: 'arm64', x64: 'x64' }[process.arch];
  return `${platform}-${arch}`;
}

async function download(url, file) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  const out = fs.createWriteStream(file);
  const hash = crypto.createHash('sha256');
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    if (!out.write(value)) await new Promise(resolve => out.once('drain', resolve));
  }
  await new Promise((resolve, reject) => out.end(error => (error ? reject(error) : resolve())));
  return hash.digest('hex');
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed (${result.error?.message ?? `exit ${result.status}`})`);
}

function extract(archive, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  if (archive.endsWith('.zip')) {
    // Not `tar`: on Windows runners GNU tar comes first on the path and reads "D:\..." as a remote host.
    if (process.platform === 'win32') {
      run('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force', archive, destination]);
    } else {
      run('unzip', ['-q', archive, '-d', destination]);
    }
    return;
  }
  // --strip-components drops the archive's top-level folder.
  run('tar', ['-xzf', archive, '-C', destination, '--strip-components=1']);
}

// Only llama-server and its libraries ship. The release's other programs (CLI,
// benchmarks, the RPC server, ...) are removed along with the libraries only they
// use. Every other shared library stays: the macOS llama-server links some that
// Linux loads on demand (libggml-rpc), so which ones are needed differs by OS.
const UNUSED = [/^llama(-(?!server(\.exe)?$)[a-z0-9-]+)?(\.exe)?$/, /^ggml-rpc-server(\.exe)?$/, /^(lib)?llama-(?!server-impl)[a-z-]+-impl/];
function prune(directory) {
  for (const name of fs.readdirSync(directory)) {
    if (UNUSED.some(pattern => pattern.test(name))) fs.rmSync(path.join(directory, name), { force: true });
  }
}

async function fetchTarget(target) {
  const asset = lock.assets[target];
  if (!asset) throw new Error(`No engine for "${target}". Known: ${Object.keys(lock.assets).join(', ')}`);
  const destination = path.join(root, 'engine', target);
  const stamp = path.join(destination, '.release');
  const wanted = `${lock.release} ${asset.sha256}`;
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === wanted) {
    console.log(`engine/${target}: ${lock.release} already in place`);
    return;
  }

  fs.mkdirSync(cacheDir, { recursive: true });
  const archive = path.join(cacheDir, asset.file);
  const url = `${lock.source}/download/${lock.release}/${asset.file}`;
  const cached = fs.existsSync(archive) && crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') === asset.sha256;
  if (!cached) {
    console.log(`engine/${target}: downloading ${asset.file}`);
    const actual = await download(url, archive);
    if (actual !== asset.sha256) {
      fs.rmSync(archive, { force: true });
      throw new Error(`Checksum mismatch for ${asset.file}\n  expected ${asset.sha256}\n  got      ${actual}`);
    }
  }
  extract(archive, destination);
  prune(destination);
  const binary = path.join(destination, target.startsWith('win') ? 'llama-server.exe' : 'llama-server');
  if (!fs.existsSync(binary)) throw new Error(`${binary} is missing after unpacking`);
  if (!target.startsWith('win')) fs.chmodSync(binary, 0o755);
  fs.writeFileSync(stamp, wanted);
  console.log(`engine/${target}: ${lock.release} ready`);
}

(async () => {
  const args = process.argv.slice(2);
  const targets = args.includes('--all') ? Object.keys(lock.assets) : args.filter(a => !a.startsWith('--'));
  for (const target of targets.length ? targets : [currentTarget()]) await fetchTarget(target);
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
