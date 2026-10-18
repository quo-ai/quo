import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';
import { Edit3, Send, Copy, Check, RotateCcw, Volume2 } from 'lucide-react-native';
import { borderRadius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { ttsService, type TtsStatus } from '@/services/ttsService';
import { useMessageModalStyles } from './styles';

interface MessageActionSheetProps {
  visible: boolean;
  isUser: boolean;
  copied: boolean;
  canEdit: boolean;
  canRegenerate: boolean;
  onClose: () => void;
  onCopy: () => void;
  onShare: () => void;
  onReadAloud: () => void;
  onEditOpen: () => void;
  onRegenerate: () => void;
}

export function MessageActionSheet({
  visible,
  isUser,
  copied,
  canEdit,
  canRegenerate,
  onClose,
  onCopy,
  onShare,
  onReadAloud,
  onEditOpen,
  onRegenerate,
}: MessageActionSheetProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const messageModalStyles = useMessageModalStyles();
  // Subscribe to TTS only while this sheet is open (and offers Read Aloud),
  // so a TTS state change doesn't re-render every bubble in the list.
  const [ttsStatus, setTtsStatus] = useState<TtsStatus>(() => ttsService.getStatus());
  useEffect(() => {
    if (!visible || isUser) return;
    const unsubscribe = ttsService.addListener(setTtsStatus);
    return () => {
      unsubscribe();
    };
  }, [visible, isUser]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={messageModalStyles.modalOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity activeOpacity={1} style={styles.actionSheet}>
          <View style={styles.actionSheetHandle} />

          <TouchableOpacity style={styles.actionSheetItem} onPress={onCopy}>
            {copied ? (
              <Check size={18} color={colors.success} />
            ) : (
              <Copy size={18} color={colors.textSecondary} />
            )}
            <Text style={styles.actionSheetText}>{copied ? 'Copied!' : 'Copy'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionSheetItem} onPress={onShare}>
            <Send size={18} color={colors.textSecondary} />
            <Text style={styles.actionSheetText}>Share</Text>
          </TouchableOpacity>

          {!isUser && (
            <TouchableOpacity style={styles.actionSheetItem} onPress={onReadAloud}>
              <Volume2 size={18} color={ttsStatus === 'playing' ? colors.primary : colors.textSecondary} />
              <Text style={styles.actionSheetText}>
                {ttsStatus === 'playing' ? 'Stop Reading' : 'Read Aloud'}
              </Text>
            </TouchableOpacity>
          )}

          {canEdit && (
            <TouchableOpacity style={styles.actionSheetItem} onPress={onEditOpen}>
              <Edit3 size={18} color={colors.textSecondary} />
              <Text style={styles.actionSheetText}>Edit & Resend</Text>
            </TouchableOpacity>
          )}

          {canRegenerate && (
            <TouchableOpacity style={styles.actionSheetItem} onPress={onRegenerate}>
              <RotateCcw size={18} color={colors.textSecondary} />
              <Text style={styles.actionSheetText}>Regenerate</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  // Action sheet
  actionSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingBottom: 32,
    paddingTop: spacing.sm,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.glassBorder,
  },
  actionSheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.glassShine,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  actionSheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  actionSheetText: {
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: '400',
  },
}));
