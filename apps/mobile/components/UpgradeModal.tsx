import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Platform,
  Linking,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import {
  X,
  Brain,
  Mic,
  Image,
  Cpu,
  MessageSquare,
  Database,
  Sparkles,
  Check,
  Volume2,
  Search,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { PREMIUM_FEATURES, usePremium, type PremiumStoreStatus } from '@/contexts/PremiumContext';
import { PremiumGradient } from '@/components/premium/PremiumGradient';
import { PREMIUM_PRICE_FALLBACK } from '@/constants/premium';
import { PRIVACY_POLICY_URL, TERMS_URL } from '@/constants/legal';

// Store-facing copy differs per platform; keep the store name in one place.
const STORE_NAME = Platform.OS === 'ios' ? 'the App Store' : 'Google Play';
const STORE_ACCOUNT = Platform.OS === 'ios' ? 'Apple ID' : 'Google Play account';

// Legal links required on the paywall (App Review 3.1.2). URLs live in
// constants/legal.ts; links hide themselves while a URL is unset.
const LEGAL_URLS = {
  privacy: PRIVACY_POLICY_URL,
  terms: TERMS_URL,
} as const;

const TABLET_WIDTH = 768;
const TABLET_MODAL_WIDTH = 420;
const PHONE_MODAL_MIN_WIDTH = 340;
const PHONE_MODAL_MAX_WIDTH = 400;
// Below this window height (landscape phones, split-screen) the header and
// type scale down so the card fits without immediately scrolling.
const COMPACT_HEIGHT = 560;

interface UpgradeModalProps {
  visible: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  onRestore?: () => void;
  isProcessingPurchase?: boolean;
  featureTriggered?: string;
  productPrice?: string;
  storeStatus?: PremiumStoreStatus;
  storeError?: string | null;
  /** Retry connecting to the store; defaults to PremiumContext.ensureStoreReady. */
  onRetryStore?: () => void;
}

// Map feature names to icons
const FEATURE_ICONS: Record<string, any> = {
  [PREMIUM_FEATURES.VOICE_INPUT]: Mic,
  [PREMIUM_FEATURES.VOICE_OUTPUT]: Volume2,
  [PREMIUM_FEATURES.ENHANCED_RECALL]: Search,
  [PREMIUM_FEATURES.VISION]: Image,
  [PREMIUM_FEATURES.THINKING_MODE]: Brain,
  [PREMIUM_FEATURES.CUSTOM_MODELS]: Cpu,
  [PREMIUM_FEATURES.EXTRA_MODELS]: Cpu,
  [PREMIUM_FEATURES.UNLIMITED_MEMORY]: Database,
  [PREMIUM_FEATURES.UNLIMITED_HISTORY]: MessageSquare,
};

interface PaywallCopy {
  title: string;
  subtitle: string;
  cta: string;
  features: string[];
}

// Kept to four single-line perks so the whole card fits on screen —
// the lead perk names what the user just tapped; the rest sell the bundle.
const CORE_PERKS = [
  'All premium models & tools',
  'Voice input & read aloud',
  'Private — your chats never leave your device',
];

const PAYWALL_COPY: Record<string, PaywallCopy> = {
  [PREMIUM_FEATURES.VOICE_INPUT]: {
    title: 'Unlock voice input',
    subtitle: 'Dictate prompts offline with on-device Whisper.',
    cta: 'Unlock Premium',
    features: ['Offline speech-to-text', 'Read answers aloud', CORE_PERKS[0], CORE_PERKS[2]],
  },
  [PREMIUM_FEATURES.VOICE_OUTPUT]: {
    title: 'Unlock voice replies',
    subtitle: 'Hear any answer read aloud — fully offline.',
    cta: 'Unlock Premium',
    features: ['Offline text-to-speech', 'Offline voice input', CORE_PERKS[0], CORE_PERKS[2]],
  },
  [PREMIUM_FEATURES.ENHANCED_RECALL]: {
    title: 'Unlock enhanced recall',
    subtitle: 'Find exact details from any past conversation.',
    cta: 'Unlock Premium',
    features: ['Semantic memory search', 'Private on-device index', CORE_PERKS[0], CORE_PERKS[1]],
  },
  [PREMIUM_FEATURES.VISION]: {
    title: 'Unlock image analysis',
    subtitle: 'Ask about photos and documents with vision models.',
    cta: 'Unlock Premium',
    features: ['Vision-capable models', 'Photo & document analysis', CORE_PERKS[0], CORE_PERKS[2]],
  },
  [PREMIUM_FEATURES.THINKING_MODE]: {
    title: 'Unlock thinking mode',
    subtitle: 'Deeper reasoning for harder questions.',
    cta: 'Unlock Premium',
    features: ['Step-by-step reasoning', 'Stronger reasoning models', CORE_PERKS[0], CORE_PERKS[2]],
  },
  [PREMIUM_FEATURES.CUSTOM_MODELS]: {
    title: 'Unlock custom models',
    subtitle: 'Import and run your own GGUF models locally.',
    cta: 'Unlock Premium',
    features: ['Import any GGUF model', 'Run it fully offline', CORE_PERKS[0], CORE_PERKS[2]],
  },
  [PREMIUM_FEATURES.EXTRA_MODELS]: {
    title: 'Unlock premium models',
    subtitle: 'Upgrade from the starter to larger, smarter models.',
    cta: 'Unlock Premium',
    features: ['Every model unlocked', 'Vision & reasoning models', CORE_PERKS[1], CORE_PERKS[2]],
  },
  [PREMIUM_FEATURES.UNLIMITED_MEMORY]: {
    title: 'Unlock more memory',
    subtitle: 'Save more preferences and context across chats.',
    cta: 'Unlock Premium',
    features: ['100 memory slots', 'Better personalized replies', CORE_PERKS[0], CORE_PERKS[2]],
  },
  [PREMIUM_FEATURES.UNLIMITED_HISTORY]: {
    title: 'Unlock full history',
    subtitle: 'Keep every conversation on this device.',
    cta: 'Unlock Premium',
    features: ['Unlimited chat history', CORE_PERKS[0], CORE_PERKS[1], CORE_PERKS[2]],
  },
};

const DEFAULT_PAYWALL_COPY: PaywallCopy = {
  title: 'Unlock Premium',
  subtitle: 'Every model and tool. Private, offline, yours.',
  cta: 'Unlock Premium',
  features: [
    'All premium models unlocked',
    'Voice input & read aloud',
    'Image analysis & thinking mode',
    'Private — your chats never leave your device',
  ],
};

function getPaywallCopy(featureTriggered?: string): PaywallCopy {
  return featureTriggered ? PAYWALL_COPY[featureTriggered] || DEFAULT_PAYWALL_COPY : DEFAULT_PAYWALL_COPY;
}

export function UpgradeModal({
  visible,
  onClose,
  onUpgrade,
  onRestore,
  isProcessingPurchase,
  featureTriggered,
  productPrice,
  storeStatus = 'unknown',
  storeError,
  onRetryStore,
}: UpgradeModalProps) {
  const { ensureStoreReady } = usePremium();
  const styles = useStyles();
  const { colors, isDark } = useTheme();
  const HeaderIcon = (featureTriggered && FEATURE_ICONS[featureTriggered]) || Sparkles;
  const copy = getPaywallCopy(featureTriggered);
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isTablet = windowWidth >= TABLET_WIDTH;
  const isCompact = windowHeight < COMPACT_HEIGHT;
  const horizontalPadding = windowWidth <= 360 ? spacing.sm : spacing.lg;
  const verticalPadding = isCompact ? spacing.sm : spacing.lg;
  const bottomSafePadding = Math.max(insets.bottom, Platform.OS === 'android' ? 36 : 0);
  const availableWidth = Math.max(1, windowWidth - horizontalPadding * 2);
  // Track the window instead of a single fixed width: ~92% of the window,
  // clamped so the card never looks stretched on wide phones or cramped on
  // narrow/split-screen windows. Tablets get a fixed card.
  const modalWidth = Math.min(
    isTablet
      ? TABLET_MODAL_WIDTH
      : Math.min(PHONE_MODAL_MAX_WIDTH, Math.max(PHONE_MODAL_MIN_WIDTH, Math.round(windowWidth * 0.92))),
    availableWidth,
  );
  const modalMaxHeight = Math.max(
    1,
    windowHeight - insets.top - bottomSafePadding - verticalPadding * 2
  );
  const contentPadding = isTablet ? spacing.xl : spacing.lg;
  const displayPrice = productPrice || PREMIUM_PRICE_FALLBACK;
  const storeReady = storeStatus === 'ready';
  const isCheckingStore = storeStatus === 'checking' || storeStatus === 'unknown';
  const storeUnavailable = storeStatus === 'unavailable';
  // When the store is unavailable the CTA becomes a Retry button instead of
  // a dead disabled button.
  const purchaseDisabled = Boolean(isProcessingPurchase) || (!storeReady && !storeUnavailable);
  const ctaText = isProcessingPurchase
    ? `Opening ${STORE_NAME}...`
    : isCheckingStore
      ? `Connecting to ${STORE_NAME}...`
      : storeUnavailable
        ? `Retry connecting to ${STORE_NAME}`
        : `${copy.cta} - ${displayPrice}`;
  const storeMessage = storeUnavailable
    ? 'Connect to the internet once to complete your purchase. Your AI keeps working offline afterward.'
    : null;
  // Raw store/billing errors are useful to the user ("billing unavailable",
  // "item not available in your country"); the generic code is not.
  const storeErrorDetail = storeUnavailable && storeError && storeError !== 'premium_product_unavailable'
    ? storeError
    : null;
  const handleRetryStore = onRetryStore ?? (() => { void ensureStoreReady(true, 'paywall_retry'); });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.modalHost,
            {
              paddingTop: insets.top + verticalPadding,
              paddingBottom: bottomSafePadding + verticalPadding,
              paddingHorizontal: horizontalPadding,
            },
          ]}
        >
          <View style={[styles.modalContainer, { width: modalWidth, maxHeight: modalMaxHeight }]}>
            {/* Liquid glass background layers */}
            <BlurView intensity={40} tint={isDark ? 'dark' : 'light'} style={[StyleSheet.absoluteFill, styles.glassRounding]} />
            <View style={[StyleSheet.absoluteFill, styles.glassBase]} />
            <LinearGradient
              colors={[colors.secondaryMuted, 'transparent']}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 0.5 }}
              style={styles.glassShine}
            />

            {/* Close button */}
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <View style={styles.closeButtonInner}>
                <X size={14} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>

            {/* Content is sized to fit portrait phones without scrolling;
                the ScrollView is a safety net for landscape/split-screen.
                Price + CTA stay pinned below so the purchase action is
                always visible. */}
            <ScrollView
              style={styles.contentScroll}
              contentContainerStyle={[
                styles.content,
                {
                  paddingHorizontal: contentPadding,
                  paddingTop: isCompact ? spacing.lg : spacing.xl,
                },
              ]}
              showsVerticalScrollIndicator={false}
              bounces={false}
              overScrollMode="never"
              keyboardShouldPersistTaps="handled"
            >
              {/* Header */}
              <View style={[styles.header, isCompact && styles.headerCompact]}>
                <View style={[styles.iconGlow, isCompact && styles.iconGlowCompact]}>
                  <HeaderIcon size={isCompact ? 22 : 26} color={colors.secondary} />
                </View>
                <Text
                  style={[styles.headerTitle, isCompact && styles.headerTitleCompact]}
                  maxFontSizeMultiplier={1.15}
                >
                  {copy.title}
                </Text>
                <Text style={styles.headerSub} maxFontSizeMultiplier={1.3}>{copy.subtitle}</Text>
              </View>

              {/* Perks */}
              <View style={styles.perkList}>
                {copy.features.map((feature, idx) => (
                  <View key={idx} style={styles.perkRow}>
                    <View style={styles.checkCircle}>
                      <Check size={11} color={colors.success} strokeWidth={3} />
                    </View>
                    <Text style={styles.perkLabel} maxFontSizeMultiplier={1.3}>{feature}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>

            {/* Pinned purchase footer */}
            <View style={[styles.purchaseFooter, { paddingHorizontal: contentPadding }]}>
              {storeMessage && (
                <Text style={styles.storeMessage} maxFontSizeMultiplier={1.3}>
                  {storeMessage}
                </Text>
              )}
              {storeErrorDetail && (
                <Text style={styles.storeErrorDetail} numberOfLines={2} maxFontSizeMultiplier={1.3}>
                  {storeErrorDetail}
                </Text>
              )}

              <TouchableOpacity
                style={[styles.purchaseButton, purchaseDisabled && styles.purchaseButtonDisabled]}
                onPress={storeUnavailable ? handleRetryStore : onUpgrade}
                activeOpacity={0.85}
                disabled={purchaseDisabled}
              >
                <PremiumGradient disabled={purchaseDisabled} style={styles.purchaseGradient}>
                  <Text
                    style={styles.purchaseText}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                    maxFontSizeMultiplier={1.1}
                  >
                    {ctaText}
                  </Text>
                </PremiumGradient>
              </TouchableOpacity>

              <Text style={styles.purchaseCaption} maxFontSizeMultiplier={1.3}>
                {`One-time purchase. No subscription. Lifetime on this ${STORE_ACCOUNT}.`}
              </Text>

              {/* Footer links */}
              <View style={styles.footerRow}>
                {onRestore && (
                  <TouchableOpacity
                    onPress={onRestore}
                    disabled={Boolean(isProcessingPurchase)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.footerLink} maxFontSizeMultiplier={1.4}>Restore</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.footerLink} maxFontSizeMultiplier={1.4}>Not now</Text>
                </TouchableOpacity>
              </View>

              {/* Legal links (App Review 3.1.2) */}
              <View style={styles.legalRow}>
                {LEGAL_URLS.privacy ? (
                  <TouchableOpacity
                    onPress={() => Linking.openURL(LEGAL_URLS.privacy).catch(() => {})}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.legalLink} maxFontSizeMultiplier={1.4}>Privacy Policy</Text>
                  </TouchableOpacity>
                ) : null}
                {LEGAL_URLS.privacy && LEGAL_URLS.terms ? (
                  <Text style={styles.legalDivider} maxFontSizeMultiplier={1.4}>·</Text>
                ) : null}
                {LEGAL_URLS.terms ? (
                  <TouchableOpacity
                    onPress={() => Linking.openURL(LEGAL_URLS.terms).catch(() => {})}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.legalLink} maxFontSizeMultiplier={1.4}>Terms of Use</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors, shadows }) => ({
  overlay: {
    flex: 1,
    backgroundColor: colors.scrim,
  },
  modalHost: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    borderRadius: 28,
    overflow: 'hidden',
    position: 'relative',
    ...shadows.elevated,
  },
  glassRounding: {
    borderRadius: 28,
  },
  glassBase: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1.5,
    borderColor: colors.secondaryGlow,
    borderRadius: 28,
  },
  glassShine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 110,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  contentScroll: {
    position: 'relative',
    zIndex: 10,
    flexGrow: 0,
    flexShrink: 1,
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 20,
  },
  closeButtonInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.glassStrong,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingBottom: spacing.xs,
  },
  purchaseFooter: {
    position: 'relative',
    zIndex: 10,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  headerCompact: {
    marginBottom: spacing.md,
  },
  iconGlow: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.secondaryMuted,
    borderWidth: 1.5,
    borderColor: colors.secondaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  iconGlowCompact: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
    letterSpacing: 0,
  },
  headerTitleCompact: {
    fontSize: 20,
  },
  headerSub: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 6,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: spacing.sm,
  },
  perkList: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 320,
    gap: 2,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    gap: 12,
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.successMuted,
    borderWidth: 1.5,
    borderColor: colors.successBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkLabel: {
    fontSize: 14.5,
    color: colors.textPrimary,
    flex: 1,
    fontWeight: '500',
  },
  storeMessage: {
    fontSize: 12.5,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 17,
    marginBottom: spacing.sm,
  },
  storeErrorDetail: {
    fontSize: 11.5,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
  },
  purchaseButton: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  purchaseButtonDisabled: {
    opacity: 0.72,
  },
  purchaseGradient: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: spacing.lg,
  },
  purchaseText: {
    fontSize: 16.5,
    fontWeight: '800',
    color: colors.onPrimary,
    letterSpacing: 0,
    textAlign: 'center',
  },
  purchaseCaption: {
    fontSize: 11.5,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
  },
  footerLink: {
    fontSize: 14,
    color: colors.secondary,
    fontWeight: '600',
  },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.sm,
  },
  legalLink: {
    fontSize: 11,
    color: colors.textTertiary,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  legalDivider: {
    fontSize: 11,
    color: colors.textTertiary,
  },
}));
