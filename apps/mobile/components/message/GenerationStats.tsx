import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Zap, Clock, Database } from 'lucide-react-native';
import { Message } from '@/types/chat';
import { borderRadius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';

interface GenerationStatsProps {
  stats: NonNullable<Message['stats']>;
  expanded: boolean;
  onToggle: () => void;
}

export function GenerationStats({ stats, expanded, onToggle }: GenerationStatsProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <TouchableOpacity
      style={styles.statsContainer}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      {expanded ? (
        <View style={styles.statsExpanded}>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Zap size={12} color={colors.primary} />
              <Text style={styles.statValue}>{stats.tokensPerSecond}</Text>
              <Text style={styles.statLabel}>tok/s</Text>
            </View>
            <View style={styles.statItem}>
              <Clock size={12} color={colors.secondary} />
              <Text style={styles.statValue}>{stats.totalTime.toFixed(1)}s</Text>
              <Text style={styles.statLabel}>total</Text>
            </View>
            <View style={styles.statItem}>
              <Database size={12} color={colors.warning} />
              <Text style={styles.statValue}>{stats.contextUsed}%</Text>
              <Text style={styles.statLabel}>context</Text>
            </View>
          </View>
          <View style={styles.statsDetails}>
            <Text style={styles.statsDetailText}>
              {stats.promptTokens} prompt + {stats.completionTokens} generated = {stats.totalTokens} tokens
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.statsCollapsed}>
          <Zap size={10} color={colors.textMuted} />
          <Text style={styles.statsCollapsedText}>
            {stats.tokensPerSecond} tok/s · {stats.totalTokens} tokens
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  // Generation stats styles
  statsContainer: {
    marginTop: spacing.sm,
  },
  statsCollapsed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  statsCollapsedText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  statsExpanded: {
    backgroundColor: colors.glass,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  statsDetails: {
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.glassBorder,
  },
  statsDetailText: {
    fontSize: 11,
    color: colors.textTertiary,
    textAlign: 'center',
  },
}));
