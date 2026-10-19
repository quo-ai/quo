import { useEffect, useState } from 'react';

/** "12s", "1m 05s": how long something has been going, for a step that takes a while. */
export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return whole < 60 ? `${whole}s` : `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`;
}

/** How many whole seconds `running` has been true, or null until it has been a few (a quick step shows no clock). */
export function useElapsed(running: boolean, showAfter = 4): number | null {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return running && seconds >= showAfter ? seconds : null;
}
