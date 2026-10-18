// Downloads the starter model so release builds bundle it and first-time
// users skip the download wall:
//   - canonical copy: assets-native/bundled-models/ (referenced by the iOS
//     app bundle via plugins/withIosBundledModel)
//   - Android: copied into the Play Asset Delivery pack
//     (android/starter_model_pack)
//
// Keep MODEL_FILENAME in sync with the starter model
// (DEFAULT_MODEL_ID) in constants/models.ts and plugins/withIosBundledModel.js.
//
// Runs automatically on EAS builds via the eas-build-post-install hook;
// run manually before local release builds: npm run fetch:starter-model
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const MODEL_FILENAME = 'Qwen3.5-0.8B-Q4_K_M.gguf';
// Pinned to a fixed repo commit (not `main`) so a re-upload upstream can't
// silently change what ships inside release builds. To bump: take the
// X-Repo-Commit / X-Linked-Size / X-Linked-ETag headers from
//   curl -sI https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/<file>
// (X-Linked-ETag is the LFS sha256).
const MODEL_REPO = 'unsloth/Qwen3.5-0.8B-GGUF';
const MODEL_REVISION = '6ab461498e2023f6e3c1baea90a8f0fe38ab64d0';
const MODEL_BYTES = 532517120;
const MODEL_SHA256 = 'bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517';
const MODEL_URL =
  `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${MODEL_FILENAME}?download=true`;

// Canonical location (also what the iOS bundle references).
const canonicalDir = path.join(__dirname, '..', 'assets-native', 'bundled-models');
const canonical = path.join(canonicalDir, MODEL_FILENAME);

const androidPackDir = path.join(
  __dirname,
  '..',
  'android',
  'starter_model_pack',
  'src',
  'main',
  'assets',
  'bundled-models',
);
const androidPackDest = path.join(androidPackDir, MODEL_FILENAME);

// With --debug-assets, the model is also copied into the app module's debug
// assets so local `npm run android` builds get the same instant-start
// experience as Play-delivered builds (asset packs only exist in AABs).
// Costs ~530MB extra in the debug APK — installs get slower, so it is opt-in.
const debugAssetsDir = path.join(
  __dirname,
  '..',
  'android',
  'app',
  'src',
  'debug',
  'assets',
  'bundled-models',
);
const debugDest = path.join(debugAssetsDir, MODEL_FILENAME);

// Exact size match: a truncated (or different) GGUF passes existence checks
// and crashes at initLlama.
function isValid(file) {
  return fs.existsSync(file) && fs.statSync(file).size === MODEL_BYTES;
}

async function main() {
  const easPlatform = process.env.EAS_BUILD_PLATFORM; // undefined locally
  const wantAndroid = !easPlatform || easPlatform === 'android';

  if (!isValid(canonical)) {
    // A pre-existing Android pack copy saves a re-download.
    if (isValid(androidPackDest)) {
      fs.mkdirSync(canonicalDir, { recursive: true });
      fs.copyFileSync(androidPackDest, canonical);
      console.log('[starter-model] reused existing Android pack copy');
    } else {
      fs.mkdirSync(canonicalDir, { recursive: true });
      console.log(`[starter-model] downloading ${MODEL_FILENAME} ...`);

      const res = await fetch(MODEL_URL);
      if (!res.ok || !res.body) {
        throw new Error(`download failed: HTTP ${res.status}`);
      }

      const tmp = `${canonical}.tmp`;
      const hash = crypto.createHash('sha256');
      const source = Readable.fromWeb(res.body);
      source.on('data', (chunk) => hash.update(chunk));
      await pipeline(source, fs.createWriteStream(tmp));

      const size = fs.statSync(tmp).size;
      const digest = hash.digest('hex');
      if (size !== MODEL_BYTES || digest !== MODEL_SHA256) {
        fs.unlinkSync(tmp);
        throw new Error(
          `downloaded file mismatch (size ${size}, expected ${MODEL_BYTES}; sha256 ${digest}) — aborted`,
        );
      }
      fs.renameSync(tmp, canonical);
      console.log(`[starter-model] done (${Math.round(size / 1e6)} MB)`);
    }
  } else {
    console.log(`[starter-model] already present (${Math.round(fs.statSync(canonical).size / 1e6)} MB)`);
  }

  if (wantAndroid && !isValid(androidPackDest)) {
    fs.mkdirSync(androidPackDir, { recursive: true });
    console.log('[starter-model] copying into Android asset pack...');
    fs.copyFileSync(canonical, androidPackDest);
  }

  syncDebugAssets();
}

function syncDebugAssets() {
  if (!process.argv.includes('--debug-assets')) return;
  if (isValid(debugDest)) {
    console.log('[starter-model] debug assets already in place');
    return;
  }
  fs.mkdirSync(debugAssetsDir, { recursive: true });
  console.log('[starter-model] copying into debug assets (adds ~530MB to debug APKs)...');
  fs.copyFileSync(canonical, debugDest);
  console.log('[starter-model] debug assets ready — next npm run android bundles the starter model');
}

main().catch((error) => {
  console.error(`[starter-model] ${error.message}`);
  process.exit(1);
});
