import React from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal } from 'react-native';
import { Edit3, Send, X } from 'lucide-react-native';
import { borderRadius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { useMessageModalStyles } from './styles';

interface EditResendModalProps {
  visible: boolean;
  editedContent: string;
  onChangeContent: (text: string) => void;
  onClose: () => void;
  onResend: () => void;
  onResendOriginal: () => void;
}

export function EditResendModal({
  visible,
  editedContent,
  onChangeContent,
  onClose,
  onResend,
  onResendOriginal,
}: EditResendModalProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const messageModalStyles = useMessageModalStyles();
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
        <TouchableOpacity activeOpacity={1} style={styles.editModal}>
          <View style={styles.editHeader}>
            <Edit3 size={18} color={colors.textSecondary} />
            <Text style={styles.editTitle}>Edit & Resend</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X size={20} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.editInput}
            value={editedContent}
            onChangeText={onChangeContent}
            multiline
            autoFocus
            placeholder="Edit your message..."
            placeholderTextColor={colors.textMuted}
          />

          <View style={styles.editActions}>
            <TouchableOpacity
              style={styles.resendOriginalButton}
              onPress={onResendOriginal}
            >
              <Text style={styles.resendOriginalText}>Resend Original</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.resendButton, !editedContent.trim() && styles.resendButtonDisabled]}
              onPress={onResend}
              disabled={!editedContent.trim()}
            >
              <Send size={16} color={colors.onPrimary} />
              <Text style={styles.resendButtonText}>Send</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  // Edit modal styles
  editModal: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.xxl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.glassHighlight,
  },
  editHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  editTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  closeButton: {
    padding: spacing.xs,
  },
  editInput: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
    minHeight: 100,
    maxHeight: 200,
    textAlignVertical: 'top',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: spacing.md,
    gap: spacing.md,
  },
  resendOriginalButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  resendOriginalText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  resendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryFill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.full,
    gap: spacing.xs,
  },
  resendButtonDisabled: {
    opacity: 0.5,
  },
  resendButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onPrimary,
  },
}));
