import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Trash2, Info, Sparkles, ChevronDown, ChevronUp, Brain, List } from 'lucide-react-native';
import { ToolAction } from '@/types/chat';
import { borderRadius, spacing, type ThemeColors } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';

// Get icon, label and colours (accent + tinted icon background) for a tool action
function getToolActionDisplay(
  action: ToolAction,
  colors: ThemeColors,
): { icon: React.ReactNode; label: string; color: string; background: string } {
  switch (action.type) {
    case 'memory_save':
      return {
        icon: <Brain size={12} color={colors.secondary} />,
        label: 'Remembered',
        color: colors.secondary,
        background: colors.secondaryMuted,
      };
    case 'memory_delete':
      return {
        icon: <Trash2 size={12} color={colors.accent} />,
        label: 'Forgot',
        color: colors.accent,
        background: colors.accentMuted,
      };
    case 'memory_list':
      return {
        icon: <List size={12} color={colors.textSecondary} />,
        label: 'Listed memories',
        color: colors.textSecondary,
        background: colors.glassStrong,
      };
    case 'info_query':
      if (action.name === 'get_date') {
        return {
          icon: <Info size={12} color={colors.primary} />,
          label: 'Checked date & time',
          color: colors.primary,
          background: colors.primaryMuted,
        };
      }
      if (action.name === 'get_user_info') {
        return {
          icon: <Info size={12} color={colors.primary} />,
          label: 'Checked your locale',
          color: colors.primary,
          background: colors.primaryMuted,
        };
      }
      return {
        icon: <Info size={12} color={colors.primary} />,
        label: 'Checked',
        color: colors.primary,
        background: colors.primaryMuted,
      };
    default:
      return {
        icon: <Sparkles size={12} color={colors.primary} />,
        label: 'Tool used',
        color: colors.primary,
        background: colors.primaryMuted,
      };
  }
}

// Extract the meaningful part from tool result for compact display
function formatToolResult(action: ToolAction): string {
  const result = action.result;

  // Memory tools — extract the quoted content
  const match = result.match(/(?:saved|updated|deleted):\s*"([^"]+)"/i);
  if (match) return match[1];

  // For list memories, show count
  if (action.type === 'memory_list') {
    const countMatch = result.match(/\((\d+)\)/);
    if (countMatch) return `${countMatch[1]} memories`;
  }

  // Date tool — strip the verbose "Current date and time: " prefix, show just the value
  if (action.name === 'get_date') {
    const stripped = result.replace(/^current date and time:\s*/i, '').trim();
    // e.g. "Friday, February 20, 2026, 3:45 PM (Europe/London)"
    return stripped;
  }

  // User info tool — already compact key:value pairs, show as-is
  if (action.name === 'get_user_info') {
    return result;
  }

  return result.slice(0, 60) + (result.length > 60 ? '…' : '');
}

interface ToolActionChipsProps {
  toolActions: ToolAction[];
  expandedToolIndex: number | null;
  onToggleExpand: (index: number | null) => void;
}

export function ToolActionChips({ toolActions, expandedToolIndex, onToggleExpand }: ToolActionChipsProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.toolActionsContainer}>
      {toolActions.map((action: ToolAction, index: number) => {
        const display = getToolActionDisplay(action, colors);
        const isLast = index === toolActions.length - 1;

        // Special rendering for memory_list - glassmorphic AMOLED style
        if (action.type === 'memory_list') {
          const memories = action.result.split('\n').filter(line => line.trim());
          const isEmpty = action.result === 'No memories stored.';
          return (
            <View key={index} style={[styles.memoryListWrapper, isLast && styles.toolActionRowLast]}>
              <View style={styles.memoryListHeader}>
                <View style={styles.memoryHeaderIcon}>
                  <Brain size={12} color={colors.secondary} />
                </View>
                <Text style={styles.memoryHeaderText}>
                  {isEmpty ? 'No memories found' : `${memories.length} ${memories.length === 1 ? 'memory' : 'memories'} retrieved`}
                </Text>
              </View>
              {!isEmpty && (
                <View style={styles.memoryListContainer}>
                  {memories.map((memory, mIndex) => {
                    const content = memory.replace(/^\d+\.\s*/, '');
                    return (
                      <View key={mIndex} style={styles.memoryChip}>
                        <Text style={styles.memoryChipText}>{content}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        }

        // Standard compact display for save/delete/info - tappable to expand
        const resultText = formatToolResult(action);
        const isExpanded = expandedToolIndex === index;
        const fullResult = action.result;

        return (
          <TouchableOpacity
            key={index}
            style={[styles.toolActionRow, isLast && styles.toolActionRowLast]}
            onPress={() => onToggleExpand(isExpanded ? null : index)}
            activeOpacity={0.7}
          >
            <View style={[styles.toolActionIcon, { backgroundColor: display.background }]}>
              {display.icon}
            </View>
            <View style={styles.toolActionContent}>
              <Text style={[styles.toolActionLabel, { color: display.color }]}>
                {display.label}
              </Text>
              <Text
                style={styles.toolActionResult}
                numberOfLines={isExpanded ? undefined : 1}
              >
                {isExpanded ? fullResult : resultText}
              </Text>
            </View>
            {fullResult.length > 50 && (
              <View style={styles.toolExpandIcon}>
                {isExpanded ? (
                  <ChevronUp size={14} color={colors.textTertiary} />
                ) : (
                  <ChevronDown size={14} color={colors.textTertiary} />
                )}
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  // Tool Actions - Liquid Glass Style
  toolActionsContainer: {
    marginTop: spacing.md,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  toolActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
  },
  toolActionRowLast: {
    borderBottomWidth: 0,
  },
  toolActionIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolActionContent: {
    flex: 1,
  },
  toolActionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  toolActionResult: {
    fontSize: 14,
    color: colors.textSecondary,
    background: colors.glassStrong,
    marginTop: 2,
  },
  toolExpandIcon: {
    marginLeft: spacing.sm,
    opacity: 0.6,
  },
  // Memory list styles - glassmorphic AMOLED chips
  memoryListWrapper: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  memoryListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  memoryHeaderIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.secondaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memoryHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.secondary,
    background: colors.secondaryMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  memoryListContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  memoryChip: {
    backgroundColor: colors.glassMedium,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  memoryChipText: {
    fontSize: 13,
    color: colors.textSecondary,
    background: colors.glassStrong,
    lineHeight: 18,
  },
}));
