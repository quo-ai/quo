import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { deleteAccount, signOutEverywhere } from '@/services/sync';
import { errorText } from './format';
import { Button } from './parts';
import { useStyles } from './styles';

/** Ends the sign-in on every other device, for a lost phone. This phone stays signed in. */
export function SignOutEverywhere() {
  const styles = useStyles();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await signOutEverywhere();
      setDone(true);
      setConfirm(false);
    } catch (err) {
      setError(errorText(err, 'Couldn’t do that. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Text style={styles.fine}>Signed out of your other devices. This phone stays signed in.</Text>;
  if (!confirm) {
    return (
      <TouchableOpacity style={styles.linkRow} onPress={() => setConfirm(true)} accessibilityRole="button">
        <Text style={styles.fine}>Sign out of all my other devices…</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={styles.box}>
      <Text style={styles.body}>Lost a phone, or left yourself signed in somewhere? This ends those sign-ins, so they can no longer reach your Quo account or sync. You stay signed in here. Chats already on those devices stay there.</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <Button label="Sign out my other devices" onPress={() => void run()} busy={busy} />
      <Button label="Cancel" onPress={() => setConfirm(false)} soft disabled={busy} />
    </View>
  );
}

/** Deleting the account, in two steps. The server says so if a plan is still running. */
export function DeleteAccount() {
  const styles = useStyles();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
    } catch (err) {
      setError(errorText(err, 'Couldn’t delete your account. Try again.'));
      setBusy(false); // the box stays open, because that's where the reason is shown
    }
  }

  if (!confirm) {
    return (
      <TouchableOpacity style={styles.linkRow} onPress={() => setConfirm(true)} accessibilityRole="button">
        <Text style={styles.fine}>Delete my Quo account…</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={styles.box}>
      <Text style={styles.body}>This deletes your account for good: your synced chats and memories in the cloud, your credits and your plan records. Chats and memories on this phone stay. If you have a plan, cancel it first.</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <Button label="Yes, delete my account" onPress={() => void remove()} busy={busy} danger />
      <Button label="Cancel" onPress={() => setConfirm(false)} soft disabled={busy} />
    </View>
  );
}
