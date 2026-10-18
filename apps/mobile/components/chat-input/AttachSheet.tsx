import React from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, Images, FileText, Lock } from 'lucide-react-native';
import { spacing, borderRadius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';

interface AttachSheetProps {
  visible: boolean;
  visionEnabled: boolean;
  onClose: () => void;
  onTakePhoto: () => void;
  onPickFromLibrary: () => void;
  onPickDocument: () => void;
}

/** Bottom sheet for choosing an attachment source (camera, library, file). */
export function AttachSheet({
  visible,
  visionEnabled,
  onClose,
  onTakePhoto,
  onPickFromLibrary,
  onPickDocument,
}: AttachSheetProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

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
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity activeOpacity={1} style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.xl) + spacing.md }]}>
          <View style={styles.handle} />

          <Text style={styles.title}>Attach</Text>
          <Text style={styles.subtitle}>
            Add a photo or document for the AI to analyse
          </Text>

          <View style={styles.options}>
            <TouchableOpacity
              style={[styles.option, !visionEnabled && styles.optionLocked]}
              onPress={onTakePhoto}
              activeOpacity={0.7}
            >
              <View style={[styles.optionIcon, { backgroundColor: colors.primaryMuted }]}>
                <Camera size={26} color={visionEnabled ? colors.primary : colors.textTertiary} strokeWidth={1.5} />
              </View>
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, !visionEnabled && styles.optionLabelLocked]}>Camera</Text>
                <Text style={[styles.optionDesc, !visionEnabled && styles.optionDescLocked]}>
                  {visionEnabled ? 'Take a new photo' : 'Requires image analysis'}
                </Text>
              </View>
              {!visionEnabled && <Lock size={16} color={colors.secondary} />}
            </TouchableOpacity>

            <View style={styles.optionDivider} />

            <TouchableOpacity
              style={[styles.option, !visionEnabled && styles.optionLocked]}
              onPress={onPickFromLibrary}
              activeOpacity={0.7}
            >
              <View style={[styles.optionIcon, { backgroundColor: colors.secondaryMuted }]}>
                <Images size={26} color={visionEnabled ? colors.secondary : colors.textTertiary} strokeWidth={1.5} />
              </View>
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, !visionEnabled && styles.optionLabelLocked]}>Photo Library</Text>
                <Text style={[styles.optionDesc, !visionEnabled && styles.optionDescLocked]}>
                  {visionEnabled ? 'Choose from your gallery' : 'Requires image analysis'}
                </Text>
              </View>
              {!visionEnabled && <Lock size={16} color={colors.secondary} />}
            </TouchableOpacity>

            <View style={styles.optionDivider} />

            <TouchableOpacity
              style={styles.option}
              onPress={onPickDocument}
              activeOpacity={0.7}
            >
              <View style={[styles.optionIcon, { backgroundColor: colors.warningMuted }]}>
                <FileText size={26} color={colors.warning} strokeWidth={1.5} />
              </View>
              <View style={styles.optionText}>
                <Text style={styles.optionLabel}>Attach File</Text>
                <Text style={styles.optionDesc}>PDF, text, code, CSV, and more</Text>
              </View>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  overlay: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: borderRadius.xxl,
    borderTopRightRadius: borderRadius.xxl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    // paddingBottom applied inline with safe-area inset
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.dividerStrong,
    alignSelf: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  options: {
    backgroundColor: colors.glassMedium,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  optionLocked: {
    opacity: 0.78,
  },
  optionDivider: {
    height: 1,
    backgroundColor: colors.glassBorder,
    marginHorizontal: spacing.lg,
  },
  optionIcon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  optionLabelLocked: {
    color: colors.textSecondary,
  },
  optionDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  optionDescLocked: {
    color: colors.textMuted,
  },
  cancelButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    backgroundColor: colors.glassMedium,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textSecondary,
  },
}));
