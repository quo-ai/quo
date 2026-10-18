import React from 'react';
import { Text } from 'react-native';
import { makeStyles } from '@/hooks/useTheme';
import { spacing } from '@/constants/theme';
import { getModelExpectationHint } from '@/utils/modelExpectation';

/** Speed/quality caveat under a model's description (see utils/modelExpectation). */
export function ModelExpectationHint({ sizeBytes }: { sizeBytes: number }) {
  const styles = useStyles();
  const hint = getModelExpectationHint(sizeBytes);
  if (!hint) return null;
  return <Text style={styles.hint}>{hint}</Text>;
}

const useStyles = makeStyles(({ colors }) => ({
  hint: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textTertiary,
    marginBottom: spacing.xs,
  },
}));
