import React, { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { CloudOff, Lock, ShieldCheck } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';
import { deleteCloudCopy, disableSync, syncNow, useSyncAccount, useSyncStatus } from '@/services/sync';
import { DeleteAccount, SignOutEverywhere } from './AccountActions';
import { formatBytes, timeAgo, type CloudStatus } from './format';
import { Button } from './parts';
import { SignIn } from './SignIn';
import { useStyles } from './styles';

export function Connected({ cloud, onChanged }: { cloud: CloudStatus | null; onChanged: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const sync = useSyncStatus();
  const { signedIn } = useSyncAccount();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const label = sync.phase === 'syncing' ? 'Syncing…'
    : sync.phase === 'error' ? (sync.error?.code === 'offline' ? 'Offline' : 'Needs attention')
      : sync.lastSyncAt ? `Up to date · ${timeAgo(sync.lastSyncAt)}` : 'Starting…';

  async function deleteAll() {
    setBusy(true);
    try {
      await deleteCloudCopy();
      onChanged();
    } catch {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <View style={styles.stack}>
      <View style={styles.box}>
        <View style={styles.boxRow}>
          {sync.phase === 'syncing' ? <ActivityIndicator size="small" /> : sync.phase === 'error' ? <CloudOff size={18} color={colors.error} /> : <ShieldCheck size={18} color={colors.primary} />}
          <View style={styles.statusText}>
            <Text style={styles.strong}>{label}</Text>
            <Text style={styles.fine}>{sync.email}</Text>
          </View>
        </View>
        {sync.error && sync.error.code !== 'offline' && <Text style={styles.error}>{sync.error.message}</Text>}
        {sync.error?.code === 'offline' && <Text style={styles.fine}>{sync.error.message}</Text>}
        {sync.tooLarge > 0 && <Text style={styles.fine}>{sync.tooLarge} {sync.tooLarge === 1 ? 'chat is' : 'chats are'} too big to sync and stay on this phone.</Text>}
        {sync.skipped > 0 && <Text style={styles.fine}>{sync.skipped} synced {sync.skipped === 1 ? 'item' : 'items'} couldn’t be read, so {sync.skipped === 1 ? 'it was' : 'they were'} skipped.</Text>}
        <Button label="Sync now" onPress={() => void syncNow({ manual: true })} busy={sync.phase === 'syncing'} soft />
      </View>

      {sync.error?.code === 'sign_in_required' && !signedIn && <SignIn onDone={onChanged} />}

      {cloud && (
        <View style={styles.box}>
          <Text style={styles.strong}>Cloud storage</Text>
          <View style={styles.meter}><View style={[styles.meterFill, { width: `${Math.max(1, Math.min(100, (cloud.usedBytes / cloud.limitBytes) * 100))}%` }]} /></View>
          <Text style={styles.fine}>{formatBytes(cloud.usedBytes)} of {formatBytes(cloud.limitBytes)} · {cloud.records} {cloud.records === 1 ? 'item' : 'items'}</Text>
        </View>
      )}

      <View style={styles.box}>
        <Text style={styles.body}>Stop syncing on this phone. Your chats and memories stay here and in the cloud, and you can join again with your recovery key.</Text>
        <Button label="Turn off on this phone" onPress={() => void disableSync().then(onChanged)} soft />
      </View>

      <View style={styles.box}>
        <Text style={styles.body}>Remove the encrypted copy from Quo’s servers for good, for all your devices. Chats and memories on your devices aren’t deleted.</Text>
        {confirm
          ? (
            <>
              <Button label="Yes, delete the cloud copy" onPress={() => void deleteAll()} busy={busy} danger />
              <Button label="Cancel" onPress={() => setConfirm(false)} soft disabled={busy} />
            </>
          )
          : <Button label="Delete the cloud copy…" onPress={() => setConfirm(true)} soft />}
      </View>

      {signedIn && <SignOutEverywhere />}
      {signedIn && <DeleteAccount />}

      <View style={styles.privacyRow}>
        <Lock size={14} color={colors.textTertiary} />
        <Text style={styles.fine}>Encrypted on this phone with a key only you hold.</Text>
      </View>
    </View>
  );
}
