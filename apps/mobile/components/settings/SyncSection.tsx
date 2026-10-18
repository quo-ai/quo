import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { ChevronRight, Cloud, CloudOff, RefreshCw, X } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';
import { useSyncStatus } from '@/services/sync';
import { timeAgo } from './sync/format';
import { useStyles } from './sync/styles';
import { SyncSheet } from './sync/SyncSheet';

export { timeAgo };

/** Quo Sync: keep chats and memories on your other devices, end-to-end encrypted. */
export function SyncSection() {
  const { colors } = useTheme();
  const styles = useStyles();
  const sync = useSyncStatus();
  const [open, setOpen] = useState(false);

  const label = sync.phase === 'off' ? 'Off'
    : sync.phase === 'syncing' ? 'Syncing…'
      : sync.phase === 'error' ? (sync.error?.code === 'offline' ? 'Offline' : 'Needs attention')
        : sync.lastSyncAt ? `Up to date · ${timeAgo(sync.lastSyncAt)}` : 'Starting…';
  const Icon = sync.phase === 'error' ? CloudOff : sync.phase === 'off' ? Cloud : RefreshCw;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Sync</Text>
      <Text style={styles.sectionDescription}>Keep your chats and memories on your other devices. Only you hold the key, so Quo can’t read them.</Text>

      <TouchableOpacity style={styles.card} onPress={() => setOpen(true)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Quo Sync">
        <View style={styles.settingRow}>
          <View style={styles.settingIcon}>
            <Icon size={20} color={sync.phase === 'error' ? colors.error : sync.phase === 'off' ? colors.textTertiary : colors.primary} />
          </View>
          <View style={styles.settingContent}>
            <Text style={styles.settingLabel}>Quo Sync</Text>
            <Text style={styles.settingDescription}>{label}</Text>
          </View>
          <ChevronRight size={20} color={colors.textTertiary} />
        </View>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalContent, styles.sheet]}>
            <View style={styles.sheetHead}>
              <Text style={[styles.modalTitle, styles.noMargin]}>Quo Sync</Text>
              <TouchableOpacity onPress={() => setOpen(false)} accessibilityLabel="Close" hitSlop={12}>
                <X size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <SyncSheet />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
