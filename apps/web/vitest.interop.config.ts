import { defineConfig } from 'vitest/config';

// Quo Sync between the web app and the phone app, against the real server code.
// It runs the phone's own sync code (apps/mobile/services/sync), so it needs
// apps/mobile's dependencies installed too: `npm run test:interop`.
export default defineConfig({
  resolve: { alias: { 'expo-crypto': new URL('./interop/expo-crypto-stub.ts', import.meta.url).pathname } },
  test: { include: ['interop/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 60_000 },
});
