import { useCallback, useEffect, useRef, useState } from 'react';
import { canRecord, startRecording, type Recording } from '../voice/recorder';
import { speech } from '../voice/speech';
import { toast } from './Toasts';

export type VoiceState = 'idle' | 'recording' | 'transcribing';

/**
 * Press once to start, again to stop: the recording is turned into text on this
 * device and handed to `onText`. The first use downloads the speech model
 * (while the user is still talking, so there's little or no wait).
 */
export function useVoiceInput(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle');
  const [seconds, setSeconds] = useState(0);
  /** 0 to 1 while the speech model downloads, else null. */
  const [download, setDownload] = useState<number | null>(null);
  const recording = useRef<Recording | null>(null);
  const textHandler = useRef(onText);
  textHandler.current = onText;

  useEffect(() => speech.onProgress(fraction => setDownload(fraction < 1 ? fraction : null)), []);

  useEffect(() => {
    if (state !== 'recording') return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [state]);

  const cancel = useCallback(() => {
    recording.current?.cancel();
    recording.current = null;
    setState('idle');
  }, []);

  const toggle = useCallback(async () => {
    if (state === 'transcribing') return;
    if (state === 'recording') {
      const active = recording.current;
      recording.current = null;
      if (!active) return;
      setState('transcribing');
      try {
        const samples = await active.stop();
        if (!samples.length) return void toast('Didn’t catch anything. Try again, a little closer to the microphone.');
        const text = await speech.transcribe(samples);
        if (text) textHandler.current(text);
        else toast('Didn’t catch that. Try again.');
      } catch (error) {
        console.error(error);
        toast('Voice input needs a one-time download of the speech model. Connect to the internet and try again.');
      } finally {
        setState('idle');
        setDownload(null);
      }
      return;
    }
    try {
      recording.current = await startRecording();
      setState('recording');
      void speech.prepare().catch(() => {}); // download in the background while they talk
    } catch (error) {
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      toast(denied ? 'Microphone access is blocked. Allow it in your system or browser settings.' : 'Couldn’t start the microphone.');
    }
  }, [state]);

  useEffect(() => cancel, [cancel]);

  return { supported: canRecord(), state, seconds, download, toggle, cancel };
}
