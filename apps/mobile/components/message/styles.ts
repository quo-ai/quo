import { spacing } from '@/constants/theme';
import { makeStyles } from '@/hooks/useTheme';

// Styles shared between the message modals (action sheet, edit & resend).
export const useMessageModalStyles = makeStyles(({ colors }) => ({
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
}));
