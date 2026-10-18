import { randomBytes, randomUUID as nodeRandomUUID } from 'node:crypto';

/** Stands in for the phone's `expo-crypto` when the phone's sync code runs under Node. */
export const getRandomBytes = (count: number): Uint8Array => new Uint8Array(randomBytes(count));
export const randomUUID = (): string => nodeRandomUUID();
