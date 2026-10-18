import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { deriveKey, keyToHex, newRecoveryKey } from '../crypto';
import type { Tracked } from '../engine';
import { clearSetup, clearToken, getDeviceId, getToken, loadSetup, saveSetup, saveToken, trackingStore } from '../tracking';

const secure = (SecureStore as unknown as { __secureStore: Map<string, string> }).__secureStore;
const record = (id: string, extra: Partial<Tracked> = {}): Tracked => ({ id, kind: 'chat', seq: 0, rev: 1, dirty: false, deleted: false, ...extra });

beforeEach(async () => {
  await AsyncStorage.clear();
  secure.clear();
});

describe('what the phone knows about each record', () => {
  it('stores and reads records, and forgets them', async () => {
    await trackingStore.put(record('a', { seq: 4 }));
    expect(await trackingStore.get('a')).toEqual(record('a', { seq: 4 }));
    await trackingStore.remove('a');
    expect(await trackingStore.get('a')).toBeUndefined();
  });

  it('lists exactly the records that changed since they were uploaded', async () => {
    await trackingStore.put(record('a', { dirty: true }));
    await trackingStore.put(record('b'));
    await trackingStore.put(record('c', { dirty: true, kind: 'memory' }));
    expect((await trackingStore.dirty()).map(r => r.id).sort()).toEqual(['a', 'c']);
    await trackingStore.put(record('a', { dirty: false, seq: 7 }));
    expect((await trackingStore.dirty()).map(r => r.id)).toEqual(['c']);
    await trackingStore.remove('c');
    expect(await trackingStore.dirty()).toEqual([]);
  });

  it('does not list a record twice however often it changes', async () => {
    for (let i = 0; i < 5; i++) await trackingStore.put(record('a', { dirty: true, rev: i }));
    expect(await trackingStore.dirty()).toHaveLength(1);
  });

  it('keeps up when many records are written at once', async () => {
    await Promise.all(Array.from({ length: 40 }, (_, i) => trackingStore.put(record(`r${i}`, { dirty: i % 2 === 0 }))));
    expect(await trackingStore.dirty()).toHaveLength(20);
  });

  it('remembers how far it has read', async () => {
    expect(await trackingStore.getSeq()).toBe(0);
    await trackingStore.setSeq(42);
    expect(await trackingStore.getSeq()).toBe(42);
  });
});

describe('the key and the sign-in', () => {
  const settings = { email: 'me@example.com', startedAt: 1, lastSyncAt: null };

  it('keeps the key in secure storage, not in ordinary app storage', async () => {
    const key = deriveKey(newRecoveryKey().secret);
    await saveSetup(key, settings);
    expect(secure.get('quo.sync.key')).toBe(keyToHex(key));
    const everything = JSON.stringify(await AsyncStorage.multiGet(await AsyncStorage.getAllKeys()));
    expect(everything).not.toContain(keyToHex(key));
    const loaded = await loadSetup();
    expect(Array.from(loaded!.key)).toEqual(Array.from(key));
    expect(loaded!.settings).toEqual(settings);
  });

  it('treats a restored backup, which has the app’s data but not the key, as not set up', async () => {
    await saveSetup(deriveKey(newRecoveryKey().secret), settings);
    await trackingStore.put(record('a', { dirty: true }));
    secure.clear(); // the Keystore isn't part of a backup
    expect(await loadSetup()).toBeNull();
    expect(await AsyncStorage.getItem('quo_sync:settings')).toBeNull();
    expect(await trackingStore.dirty()).toEqual([]);
  });

  it('treats a damaged key as not set up', async () => {
    await saveSetup(deriveKey(newRecoveryKey().secret), settings);
    secure.set('quo.sync.key', 'not hex');
    expect(await loadSetup()).toBeNull();
  });

  it('is not set up when it never was', async () => {
    expect(await loadSetup()).toBeNull();
  });

  it('forgets everything about syncing but keeps the sign-in and the device id', async () => {
    await saveSetup(deriveKey(newRecoveryKey().secret), settings);
    await trackingStore.put(record('a', { dirty: true }));
    await trackingStore.setSeq(9);
    await saveToken('token-123');
    const device = await getDeviceId();
    await clearSetup();
    expect(await loadSetup()).toBeNull();
    expect(await trackingStore.get('a')).toBeUndefined();
    expect(await trackingStore.getSeq()).toBe(0);
    expect(await getToken()).toBe('token-123');
    expect(await getDeviceId()).toBe(device);
  });

  it('stores and clears the sign-in token securely', async () => {
    expect(await getToken()).toBeNull();
    await saveToken('abc.def');
    expect(secure.get('quo.sync.token')).toBe('abc.def');
    expect(JSON.stringify(await AsyncStorage.multiGet(await AsyncStorage.getAllKeys()))).not.toContain('abc.def');
    await clearToken();
    expect(await getToken()).toBeNull();
  });

  it('gives each install one stable random id', async () => {
    const first = await getDeviceId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(await getDeviceId()).toBe(first);
  });
});
