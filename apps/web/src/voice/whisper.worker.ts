import { env, pipeline } from '@huggingface/transformers';
// Hosted with the app, not fetched from a CDN (Transformers.js defaults to jsDelivr).
import ortModule from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

/**
 * Speech to text with Whisper, in a worker so the page stays responsive.
 * Runs on the processor (WebAssembly): about 8x faster than real time for the
 * base model on a laptop, with nothing sent anywhere. The model files are
 * downloaded from Hugging Face once and kept in the browser's cache.
 */

env.allowLocalModels = false;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = { mjs: ortModule, wasm: ortWasm };

export type WorkerRequest =
  | { type: 'load'; model: string }
  | { type: 'transcribe'; id: number; audio: Float32Array; language?: string };

export type WorkerEvent =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };

type Recognizer = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;

let recognizer: Promise<Recognizer> | null = null;
const send = (event: WorkerEvent) => postMessage(event);

function load(model: string): Promise<Recognizer> {
  recognizer ??= (async () => {
    const asr = await pipeline('automatic-speech-recognition', model, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: (info: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (info.status === 'progress' && info.file) send({ type: 'progress', file: info.file, loaded: info.loaded ?? 0, total: info.total ?? 0 });
      },
    });
    return asr as unknown as Recognizer;
  })().catch(error => {
    recognizer = null;
    throw error;
  });
  return recognizer;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'load') {
      await load(request.model);
      send({ type: 'ready' });
    } else {
      const asr = await recognizer;
      if (!asr) throw new Error('not_loaded');
      // Long recordings are read in 30-second windows with a little overlap.
      const output = await asr(request.audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        task: 'transcribe',
        ...(request.language ? { language: request.language } : {}),
      });
      const text = (Array.isArray(output) ? output.map(part => part.text).join(' ') : output.text).trim();
      send({ type: 'result', id: request.id, text });
    }
  } catch (error) {
    send({ type: 'error', id: request.type === 'transcribe' ? request.id : undefined, message: error instanceof Error ? error.message : String(error) });
  }
};
