import { spacing, borderRadius, typography } from '@/constants/theme';
import { makeStyles } from '@/hooks/useTheme';
import { settingsStyles } from '../styles';

export const useStyles = makeStyles((theme) => {
  const { colors } = theme;
  return {
    ...settingsStyles(theme),
    sheet: { maxHeight: '88%' },
    sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
    noMargin: { marginBottom: 0 },
    stack: { gap: spacing.md },
    lede: { fontSize: typography.sizes.sm, color: colors.textSecondary, lineHeight: 20 },
    box: { backgroundColor: colors.glassMedium, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.glassBorder, padding: spacing.lg, gap: spacing.md },
    boxRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    boxIcon: { marginTop: 2 },
    statusText: { flex: 1 },
    body: { fontSize: typography.sizes.sm, color: colors.textSecondary, lineHeight: 20, flexShrink: 1 },
    strong: { fontWeight: typography.weights.semibold, color: colors.textPrimary },
    fine: { fontSize: typography.sizes.xs, color: colors.textTertiary, lineHeight: 18, flexShrink: 1 },
    error: { fontSize: typography.sizes.sm, color: colors.error, lineHeight: 20 },
    dangerText: { color: colors.error },
    link: { fontSize: typography.sizes.xs, color: colors.primary, fontWeight: typography.weights.semibold },
    linkRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
    privacyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, justifyContent: 'center', marginTop: spacing.xs },
    input: {
      backgroundColor: colors.surface, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.glassBorder,
      padding: spacing.md, fontSize: typography.sizes.md, color: colors.textPrimary,
    },
    codeInput: { textAlign: 'center', fontSize: 26, letterSpacing: 8, fontVariant: ['tabular-nums'] },
    keyInput: { fontSize: typography.sizes.sm, letterSpacing: 0.5 },
    keyBox: {
      backgroundColor: colors.surface, borderRadius: borderRadius.lg, padding: spacing.md, fontSize: typography.sizes.md,
      fontWeight: typography.weights.semibold, color: colors.textPrimary, letterSpacing: 1, lineHeight: 26, textAlign: 'center',
    },
    button: { backgroundColor: colors.primaryFill, borderRadius: borderRadius.lg, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
    buttonSoft: { backgroundColor: colors.glassStrong },
    buttonDanger: { backgroundColor: colors.error },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { fontSize: typography.sizes.md, fontWeight: typography.weights.semibold, color: colors.onPrimary },
    buttonTextSoft: { color: colors.textPrimary },
    buttonTextDanger: { color: colors.onPrimary },
    checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    checkBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.textTertiary, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    checkBoxOn: { backgroundColor: colors.primaryFill, borderColor: colors.primaryFill },
    checkText: { flex: 1 },
    meter: { height: 6, borderRadius: 3, backgroundColor: colors.glassStrong, overflow: 'hidden' },
    meterFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  };
});
