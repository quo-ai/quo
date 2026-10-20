import { useEffect, useState } from 'react';
import type { MathPlugins } from './load';

/** The maths plugins once a reply needs them: null (shown as text) until they've loaded, or when it has no maths. */

let ready: MathPlugins | null = null;
let pending: Promise<MathPlugins> | null = null;

export function loadMath(): Promise<MathPlugins> {
  pending ??= import('./load').then(module => (ready = module.MATH));
  pending.catch(() => {
    pending = null; // offline before it was ever cached: try again with the next reply
  });
  return pending;
}

export function useMath(wanted: boolean): MathPlugins | null {
  const [plugins, setPlugins] = useState<MathPlugins | null>(ready);
  useEffect(() => {
    if (wanted && !plugins) void loadMath().then(setPlugins, () => {});
  }, [wanted, plugins]);
  return wanted ? (plugins ?? ready) : null;
}
