/**
 * Records the microphone and returns 16 kHz mono samples, which is what
 * Whisper reads. MediaRecorder captures the audio; decodeAudioData resamples it.
 */

export interface Recording {
  /** Stops and returns the samples (empty if nothing useful was captured). */
  stop(): Promise<Float32Array>;
  /** Stops and throws the audio away. */
  cancel(): void;
}

export const MAX_RECORDING_MS = 3 * 60_000;
const MIN_SAMPLES = 16_000 * 0.4;

export function canRecord(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
}

export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = event => {
    if (event.data.size) chunks.push(event.data);
  };
  const finished = new Promise<void>(resolve => {
    recorder.onstop = () => resolve();
  });
  const release = () => stream.getTracks().forEach(track => track.stop());
  recorder.start(250);
  const limit = setTimeout(() => recorder.state === 'recording' && recorder.stop(), MAX_RECORDING_MS);

  const end = async () => {
    clearTimeout(limit);
    if (recorder.state !== 'inactive') recorder.stop();
    await finished;
    release();
  };

  return {
    async stop() {
      await end();
      if (!chunks.length) return new Float32Array(0);
      const context = new AudioContext({ sampleRate: 16_000 });
      try {
        const audio = await context.decodeAudioData(await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer());
        const samples = audio.getChannelData(0).slice();
        return samples.length >= MIN_SAMPLES ? samples : new Float32Array(0);
      } finally {
        void context.close();
      }
    },
    cancel() {
      void end();
    },
  };
}
