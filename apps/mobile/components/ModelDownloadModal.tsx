import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Download, WifiOff, HardDrive, AlertCircle, X, Shield, Zap, Brain } from 'lucide-react-native';
import { spacing, borderRadius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';

const MAX_MODAL_WIDTH = 420;

interface ModelDownloadModalProps {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  modelSize: string;
  error?: string | null;
  onRetry?: () => void;
}

export function ModelDownloadModal({
  visible,
  onConfirm,
  onCancel,
  modelSize,
  error,
  onRetry,
}: ModelDownloadModalProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const horizontalPadding = windowWidth <= 360 ? spacing.md : spacing.xl;
  const verticalPadding = spacing.xl;
  // Floor the bottom inset so content never touches the screen edge on
  // devices with no home indicator (e.g. iPhone SE reports insets.bottom=0).
  const bottomSafePadding = Math.max(insets.bottom, Platform.OS === 'android' ? 36 : spacing.md);
  const modalWidth = Math.min(MAX_MODAL_WIDTH, Math.max(1, windowWidth - horizontalPadding * 2));
  const modalMaxHeight = Math.max(
    1,
    windowHeight - insets.top - bottomSafePadding - verticalPadding * 2
  );

  const overlayStyle = [
    styles.overlay,
    {
      paddingTop: insets.top + verticalPadding,
      paddingBottom: bottomSafePadding + verticalPadding,
      paddingHorizontal: horizontalPadding,
    },
  ];

  const modalStyle = [styles.modal, { width: modalWidth, maxHeight: modalMaxHeight }];

  if (error) {
    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={onCancel}
      >
        <View style={overlayStyle}>
          <View style={modalStyle}>
            <ScrollView
              contentContainerStyle={styles.modalContent}
              showsVerticalScrollIndicator={false}
              overScrollMode="never"
            >
              <View style={styles.errorIconWrapper}>
                <AlertCircle size={40} color={colors.error} />
              </View>

              <Text style={styles.title}>Download Failed</Text>
              <Text style={styles.errorMessage}>{error}</Text>

              <View style={styles.errorHints}>
                <Text style={styles.hintText}>- Check your internet connection</Text>
                <Text style={styles.hintText}>- Ensure you have enough storage space</Text>
                <Text style={styles.hintText}>- Try again in a few moments</Text>
              </View>

              <View style={styles.buttonRow}>
                <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
                  <Text style={styles.retryButtonText}>Try Again</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={overlayStyle}>
        <View style={modalStyle}>
          <TouchableOpacity style={styles.closeButton} onPress={onCancel}>
            <X size={20} color={colors.textTertiary} />
          </TouchableOpacity>

          <ScrollView
            contentContainerStyle={styles.modalContent}
            showsVerticalScrollIndicator={false}
            overScrollMode="never"
          >
            <View style={styles.iconWrapper}>
              <Download size={36} color={colors.primary} />
            </View>

            <Text style={styles.title}>Get Started in Seconds</Text>
            <Text style={styles.subtitle}>
              Download the AI once - then it runs entirely on your device, forever.
            </Text>

            <View style={styles.featureList}>
              <View style={styles.featureRow}>
                <View style={[styles.featureIcon, { backgroundColor: colors.primaryMuted }]}>
                  <WifiOff size={16} color={colors.primary} />
                </View>
                <View style={styles.featureText}>
                  <Text style={styles.featureTitle}>Works 100% offline</Text>
                  <Text style={styles.featureDesc}>No internet needed after this download</Text>
                </View>
              </View>

              <View style={styles.featureRow}>
                <View style={[styles.featureIcon, { backgroundColor: colors.successMuted }]}>
                  <Shield size={16} color={colors.success} />
                </View>
                <View style={styles.featureText}>
                  <Text style={styles.featureTitle}>Completely private</Text>
                  <Text style={styles.featureDesc}>Your conversations never leave your phone</Text>
                </View>
              </View>

              <View style={styles.featureRow}>
                <View style={[styles.featureIcon, { backgroundColor: colors.warningMuted }]}>
                  <Brain size={16} color={colors.warning} />
                </View>
                <View style={styles.featureText}>
                  <Text style={styles.featureTitle}>Reasoning & memory</Text>
                  <Text style={styles.featureDesc}>Thinks through problems, remembers your preferences</Text>
                </View>
              </View>

              <View style={styles.featureRow}>
                <View style={[styles.featureIcon, { backgroundColor: colors.secondaryMuted }]}>
                  <Zap size={16} color={colors.secondary} />
                </View>
                <View style={styles.featureText}>
                  <Text style={styles.featureTitle}>Fast on any device</Text>
                  <Text style={styles.featureDesc}>GPU-accelerated - no cloud, no lag</Text>
                </View>
              </View>
            </View>

            <View style={styles.sizeRow}>
              <HardDrive size={14} color={colors.textTertiary} />
              <Text style={styles.sizeText}>
                Download size: <Text style={styles.sizeValue}>{modelSize}</Text>
              </Text>
            </View>

            <Text style={styles.recommendation}>
              Recommended: use Wi-Fi for the download
            </Text>

            <TouchableOpacity style={styles.downloadButton} onPress={onConfirm}>
              <Download size={18} color={colors.onPrimary} />
              <Text style={styles.downloadButtonText}>Download & Get Started</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.laterButton} onPress={onCancel}>
              <Text style={styles.laterButtonText}>Not Now</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  overlay: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.xxl,
    borderWidth: 1,
    borderColor: colors.glassHighlight,
    overflow: 'hidden',
  },
  modalContent: {
    padding: spacing.xl,
  },
  closeButton: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    padding: spacing.sm,
    zIndex: 1,
  },
  iconWrapper: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primaryMuted,
    borderWidth: 1,
    borderColor: colors.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  errorIconWrapper: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.errorMuted,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.xl,
  },
  errorMessage: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  errorHints: {
    backgroundColor: colors.glass,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.xl,
  },
  hintText: {
    fontSize: 13,
    color: colors.textTertiary,
    marginVertical: 2,
  },
  featureList: {
    width: '100%',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  featureDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  sizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  sizeText: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  sizeValue: {
    fontWeight: '600',
    color: colors.textSecondary,
  },
  recommendation: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryFill,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  downloadButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.onPrimary,
  },
  laterButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  laterButtonText: {
    fontSize: 14,
    color: colors.textTertiary,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  cancelButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glassMedium,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  retryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryFill,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
  },
  retryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.onPrimary,
  },
}));
