import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { getCloudStatus, refreshAccount, useSyncAccount, useSyncStatus } from '@/services/sync';
import { SignOutEverywhere, DeleteAccount } from './AccountActions';
import { Connected } from './Connected';
import { errorText, type CloudStatus } from './format';
import { Join } from './Join';
import { Notice, SignedInAs } from './parts';
import { SignIn } from './SignIn';
import { useStyles } from './styles';
import { TurnOn } from './TurnOn';

/** What the Quo Sync window shows: signing in, turning sync on or joining it, or how it's going. */

export function SyncSheet() {
  const styles = useStyles();
  const sync = useSyncStatus();
  const { account, signedIn } = useSyncAccount();
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // Asks the server where this account stands (a plan? sync already on?).
  const fetchCloud = useCallback(async (isCurrent: () => boolean = () => true) => {
    try {
      await refreshAccount();
      const status = await getCloudStatus();
      if (!isCurrent()) return;
      setCloud(status);
      setProblem(null);
    } catch (error) {
      if (isCurrent()) setProblem(errorText(error, 'Couldn’t reach Quo Sync. Check your connection and try again.'));
    }
  }, []);

  /** For buttons: the same, with a spinner. */
  const load = useCallback(async () => {
    setChecking(true);
    await fetchCloud();
    setChecking(false);
  }, [fetchCloud]);

  const off = sync.phase === 'off';
  useEffect(() => {
    if (!signedIn) return;
    let current = true;
    void fetchCloud(() => current);
    return () => {
      current = false;
    };
  }, [signedIn, off, fetchCloud]);

  if (sync.phase !== 'off') return <Connected cloud={cloud} onChanged={load} />;

  return (
    <View style={styles.stack}>
      <Text style={styles.lede}>Chats and memories follow you between your devices, end-to-end encrypted. Photos and files stay on the device they were added on, and models are never synced.</Text>
      {!signedIn
        ? <SignIn onDone={load} />
        : problem && !cloud
          ? <Notice message={problem} action="Try again" onAction={load} busy={checking} />
          : !cloud
            ? <ActivityIndicator />
            : !cloud.entitled
              ? <Notice message="Quo Sync is included with a Quo Pro or Quo Sync plan on your Quo account. Once your account has one, check again here." action="Check again" onAction={load} busy={checking} />
              : cloud.enabled
                ? <Join email={account?.email ?? ''} onDone={load} />
                : <TurnOn email={account?.email ?? ''} onDone={load} />}
      {signedIn && sync.phase === 'off' && <SignedInAs email={account?.email} />}
      {signedIn && sync.phase === 'off' && <SignOutEverywhere />}
      {signedIn && sync.phase === 'off' && <DeleteAccount />}
    </View>
  );
}
