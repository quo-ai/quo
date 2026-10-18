import type { WorkerEvent, WorkerRequest } from './whisper.worker';

/**
 * Voice input: Whisper (base, multilingual) running in this browser. The model
 * (about 100 MB) downloads the first time you use the microphone and is kept for
 * next time. Audio never leaves the device.
 */

const MODEL = 'onnx-community/whisper-base';

export type SpeechState = 'idle' | 'loading' | 'ready';

class SpeechToText {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>();
  private files = new Map<string, { loaded: number; total: number }>();
  private progressListeners = new Set<(fraction: number) => void>();
  state: SpeechState = 'idle';

  onProgress(listener: (fraction: number) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  private post(request: WorkerRequest, transfer: Transferable[] = []) {
    this.worker!.postMessage(request, transfer);
  }

  /** Loads the model (downloading it on first use). Safe to call again. */
  prepare(): Promise<void> {
    if (this.ready) return this.ready;
    this.state = 'loading';
    this.ready = new Promise<void>((resolve, reject) => {
      const worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<WorkerEvent>) => {
        const message = event.data;
        if (message.type === 'progress') {
          this.files.set(message.file, { loaded: message.loaded, total: message.total });
          let loaded = 0;
          let total = 0;
          for (const file of this.files.values()) {
            loaded += file.loaded;
            total += file.total;
          }
          const fraction = total ? Math.min(1, loaded / total) : 0;
          this.progressListeners.forEach(listener => listener(fraction));
        } else if (message.type === 'ready') {
          this.state = 'ready';
          resolve();
        } else if (message.type === 'result') {
          this.pending.get(message.id)?.resolve(message.text);
          this.pending.delete(message.id);
        } else if (message.type === 'error') {
          if (message.id === undefined) return reject(new Error(message.message));
          this.pending.get(message.id)?.reject(new Error(message.message));
          this.pending.delete(message.id);
        }
      };
      worker.onerror = () => reject(new Error('worker_failed'));
      this.post({ type: 'load', model: MODEL });
    }).catch(error => {
      this.reset();
      throw error;
    });
    return this.ready;
  }

  private reset() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.state = 'idle';
    this.files.clear();
    for (const { reject } of this.pending.values()) reject(new Error('cancelled'));
    this.pending.clear();
  }

  async transcribe(audio: Float32Array, language?: string): Promise<string> {
    await this.prepare();
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ type: 'transcribe', id, audio, language }, [audio.buffer]);
    });
  }
}

export const speech = new SpeechToText();
