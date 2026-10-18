import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { AlertCircle, LogOut } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';
import { signOut } from '@/services/sync';
import { useStyles } from './styles';

export function SignedInAs({ email }: { email?: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <TouchableOpacity style={styles.linkRow} onPress={() => void signOut()} accessibilityRole="button">
      <LogOut size={14} color={colors.textTertiary} />
      <Text style={styles.fine}>Signed in as {email ?? 'your account'} · Sign out</Text>
    </TouchableOpacity>
  );
}

export function Notice({ message, action, onAction, busy }: { message: string; action: string; onAction: () => void; busy?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.box}>
      <View style={styles.boxRow}>
        <AlertCircle size={16} color={colors.textSecondary} style={styles.boxIcon} />
        <Text style={styles.body}>{message}</Text>
      </View>
      <Button label={action} onPress={onAction} busy={busy} soft />
    </View>
  );
}

export function Button({ label, onPress, busy, soft, danger, disabled }: { label: string; onPress: () => void; busy?: boolean; soft?: boolean; danger?: boolean; disabled?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[styles.button, soft && styles.buttonSoft, danger && styles.buttonDanger, (disabled || busy) && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      activeOpacity={0.8}
    >
      {busy ? <ActivityIndicator size="small" color={soft ? colors.textPrimary : colors.onPrimary} /> : <Text style={[styles.buttonText, soft && styles.buttonTextSoft, danger && styles.buttonTextDanger]}>{label}</Text>}
    </TouchableOpacity>
  );
}
