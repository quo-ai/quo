/**
 * Read aloud, with the voices built into the operating system or browser:
 * nothing is sent anywhere.
 */

export const canSpeak = (): boolean => typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';

/** Voices may load a moment after startup; the button hides itself when there are none. */
export function hasVoices(): boolean {
  return canSpeak() && speechSynthesis.getVoices().length > 0;
}

export function onVoicesChanged(listener: () => void): () => void {
  if (!canSpeak()) return () => {};
  speechSynthesis.addEventListener('voiceschanged', listener);
  return () => speechSynthesis.removeEventListener('voiceschanged', listener);
}

/** Markdown read out loud sounds awful ("asterisk asterisk"), so strip it. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~|]/g, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}

let current: SpeechSynthesisUtterance | null = null;

export function stopSpeaking(): void {
  if (!canSpeak()) return;
  current = null;
  speechSynthesis.cancel();
}

/** Speaks the text; `onEnd` runs when it finishes or is stopped. */
export function speak(markdown: string, onEnd: () => void): void {
  if (!canSpeak()) return onEnd();
  stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(plainText(markdown));
  utterance.lang = document.documentElement.lang || navigator.language;
  const done = () => {
    if (current === utterance) current = null;
    onEnd();
  };
  utterance.onend = done;
  utterance.onerror = done;
  current = utterance;
  speechSynthesis.speak(utterance);
}
