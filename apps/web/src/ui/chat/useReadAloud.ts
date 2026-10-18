import { useEffect, useState } from 'react';
import type { Message } from '../../chat/types';
import { hasVoices, onVoicesChanged, speak, stopSpeaking } from '../../voice/readAloud';

/** Reading a reply aloud with the device's voices: which reply is being read, and starting or stopping it. */
export function useReadAloud(resetKey: unknown) {
  const [voicesReady, setVoicesReady] = useState(hasVoices);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  useEffect(() => onVoicesChanged(() => setVoicesReady(hasVoices())), []);
  useEffect(() => () => stopSpeaking(), []);
  useEffect(() => {
    stopSpeaking();
    setSpeakingId(null);
  }, [resetKey]);

  function toggle(message: Message) {
    if (speakingId === message.id) {
      stopSpeaking();
      return setSpeakingId(null);
    }
    setSpeakingId(message.id);
    speak(message.content, () => setSpeakingId(id => (id === message.id ? null : id)));
  }

  return { voicesReady, speakingId, toggle };
}
