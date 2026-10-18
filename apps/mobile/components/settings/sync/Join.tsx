import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { deleteCloudCopy, joinSync, JoinError } from '@/services/sync';
import { errorText } from './format';
import { Button } from './parts';
import { useStyles } from './styles';

export function Join({ email, onDone }: { email: string; onDone: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await joinSync(text, email);
      onDone();
    } catch (err) {
      setError(
        err instanceof JoinError
          ? err.code === 'bad_format' ? 'That recovery key doesn’t look right. Check it for typos: it’s 8 groups of 4 letters and numbers, then 2 more.'
            : err.code === 'wrong_key' ? 'That recovery key doesn’t match this account’s Quo Sync.'
              : 'Quo Sync isn’t turned on for this account yet.'
          : errorText(err, 'Couldn’t join Quo Sync. Try again.'),
      );
      setBusy(false);
    }
  }

  async function startOver() {
    setBusy(true);
    try {
      await deleteCloudCopy();
      onDone();
    } catch (err) {
      setError(errorText(err, 'Couldn’t delete it. Try again.'));
    } finally {
      setBusy(false);
      setConfirmReset(false);
    }
  }

  return (
    <View style={styles.box}>
      <Text style={styles.body}>Quo Sync is already on for <Text style={styles.strong}>{email}</Text>. Enter your recovery key to bring those chats here.</Text>
      <TextInput
        style={[styles.input, styles.keyInput]}
        value={text}
        onChangeText={setText}
        placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX"
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        accessibilityLabel="Recovery key"
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button label={busy ? 'Checking…' : 'Join Quo Sync'} onPress={() => void join()} busy={busy} disabled={!text.trim()} />
      <View style={styles.linkRow}>
        <Text style={styles.fine}>Lost your key? Nobody can recover it, but you can </Text>
        <TouchableOpacity onPress={() => (confirmReset ? void startOver() : setConfirmReset(true))} disabled={busy}>
          <Text style={[styles.link, confirmReset && styles.dangerText]}>{confirmReset ? 'tap again to delete the cloud copy for good' : 'delete the cloud copy and start again'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
