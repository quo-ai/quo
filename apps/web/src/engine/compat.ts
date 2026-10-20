import compatWasm from '@wllama/wllama-compat/wasm/wllama.wasm?url';
import compatWorker from '@wllama/wllama-compat/wasm/wllama.js?raw';

/**
 * wllama's build for browsers without JSPI or 64-bit memory (Safari, older Chrome), hosted by the app: left to itself,
 * wllama fetches it from jsDelivr. Its own file so only those browsers load it (localEngine.ts); the build names it
 * wllama-compat-*, cached on first use (vite.config.ts), and the desktop app leaves it out (it never needs it).
 */
export const WLLAMA_COMPAT = { wasm: compatWasm, worker: { code: compatWorker } };
