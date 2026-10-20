/**
 * The WebAssembly features wllama's main build needs: JSPI (it reads model files in pieces as it goes) and 64-bit
 * memory. Without them it runs its compatibility build (engine/compat.ts), which holds at most 4 GB and can't load a
 * file of 2 GiB or more, or, in Firefox, the main build without piecewise reads (the same file limit).
 */
export const hasJspi = (): boolean => typeof WebAssembly !== 'undefined' && 'Suspending' in WebAssembly;

export function hasMemory64(): boolean {
  try {
    new WebAssembly.Memory({ address: 'i64', initial: 1n } as unknown as WebAssembly.MemoryDescriptor);
    return true;
  } catch {
    return false;
  }
}

/** wllama's main build runs here, so files of 2 GiB or more load. */
export const runsMainBuild = (): boolean => hasJspi() && hasMemory64();
