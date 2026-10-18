import React, { useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Check } from 'lucide-react-native';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { createSync } from '@/services/sync';
import { newRecoveryKey } from '@/services/sync/crypto';
import { errorText } from './format';
import { Button } from './parts';
import { useStyles } from './styles';

export function TurnOn({ email, onDone }: { email: string; onDone: () => void }) {
  const styles = useStyles();
  const [creating, setCreating] = useState(false);
  if (!creating) {
    return (
      <View style={styles.box}>
        <Text style={styles.body}>You’ll get a <Text style={styles.strong}>recovery key</Text>: the only thing that can unlock your synced chats on a new device. Quo can’t reset it for you.</Text>
        <Button label="Turn on Quo Sync" onPress={() => setCreating(true)} />
      </View>
    );
  }
  return <Create email={email} onBack={() => setCreating(false)} onDone={onDone} />;
}

function Create({ email, onBack, onDone }: { email: string; onBack: () => void; onDone: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [recovery] = useState(newRecoveryKey);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    await Clipboard.setStringAsync(recovery.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await createSync(recovery.secret, email);
      onDone();
    } catch (err) {
      setError(errorText(err, 'Couldn’t turn on Quo Sync. Try again.'));
      setBusy(false);
    }
  }

  return (
    <View style={styles.box}>
      <Text style={styles.body}><Text style={styles.strong}>Save your recovery key.</Text> You’ll need it to add another device. It’s shown only now, and if it’s lost, so are your synced chats (the chats on your devices stay).</Text>
      <Text selectable style={styles.keyBox} accessibilityLabel="Recovery key">{recovery.text}</Text>
      <Button label={copied ? 'Copied' : 'Copy the key'} onPress={() => void copy()} soft />
      <TouchableOpacity style={styles.checkRow} onPress={() => setSaved(value => !value)} accessibilityRole="checkbox" accessibilityState={{ checked: saved }}>
        <View style={[styles.checkBox, saved && styles.checkBoxOn]}>{saved && <Check size={14} color={colors.onPrimary} />}</View>
        <Text style={[styles.body, styles.checkText]}>I’ve saved my recovery key somewhere safe, and I understand Quo can’t recover it.</Text>
      </TouchableOpacity>
      {error && <Text style={styles.error}>{error}</Text>}
      <Button label={busy ? 'Turning on…' : 'Turn on Quo Sync'} onPress={() => void start()} disabled={!saved} busy={busy} />
      <TouchableOpacity onPress={onBack} style={styles.linkRow} disabled={busy}><Text style={styles.link}>Back</Text></TouchableOpacity>
    </View>
  );
}
