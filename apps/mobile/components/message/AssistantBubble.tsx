import React, { useCallback, useMemo, useState } from 'react';
import { View, TouchableOpacity, Alert } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { Message } from '@/types/chat';
import { borderRadius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { usePremium, PREMIUM_FEATURES } from '@/contexts/PremiumContext';
import { ttsService } from '@/services/ttsService';
import { useMessageActions } from '@/hooks/useMessageActions';
import { renderContentWithMath } from '@/components/message/markdownRules';
import { parseChainOfThought } from '@/components/message/parseChainOfThought';
import { ToolActionChips } from '@/components/message/ToolActionChips';
import { GenerationStats } from '@/components/message/GenerationStats';
import { ThinkingBlock } from '@/components/message/ThinkingBlock';
import { MessageActionSheet } from '@/components/message/MessageActionSheet';

interface AssistantBubbleProps {
  message: Message;
  onRegenerate?: (assistantMessageId: string) => void;
  isGenerating?: boolean;
  showStats?: boolean;
}

export function AssistantBubble({ message, onRegenerate, isGenerating, showStats }: AssistantBubbleProps) {
  const [showThinking, setShowThinking] = useState(false);
  const [expandedToolIndex, setExpandedToolIndex] = useState<number | null>(null);
  const [statsExpanded, setStatsExpanded] = useState(false);
  const { checkPremiumFeature } = usePremium();
  const { colors } = useTheme();
  const styles = useStyles();

  // Memoize expensive content parsing to avoid re-running regex on every render
  const { thinking, mainContent } = useMemo(() => {
    const parsed = parseChainOfThought(message.content);
    // Strip tool call markup from response (model outputs <tool_call>...</tool_call>)
    const cleanedResponse = parsed.content
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
      .replace(/<\|tool_call\|>[\s\S]*?<\|\/tool_call\|>/gi, '')
      .replace(/<\|python_tag\|>[\s\S]*?$/gi, '')
      .trim();
    return { thinking: parsed.thinking, mainContent: cleanedResponse };
  }, [message.content]);

  // Markdown + math rendering is the expensive part of a bubble; only redo
  // it when the text itself changes.
  const renderedContent = useMemo(
    () => (mainContent ? renderContentWithMath(mainContent) : null),
    [mainContent],
  );

  const getText = useCallback(() => mainContent || message.content, [mainContent, message.content]);
  const actions = useMessageActions(getText);

  // --- Read Aloud (system voice, premium) ---
  const handleReadAloud = async () => {
    actions.closeActionSheet();

    if (ttsService.isBusy()) {
      await ttsService.stop();
      return;
    }
    if (!checkPremiumFeature(PREMIUM_FEATURES.VOICE_OUTPUT)) return;

    const ok = await ttsService.speak(getText());
    if (!ok) {
      Alert.alert('Voice Error', 'Could not read this message aloud.');
    }
  };

  const handleRegenerate = () => {
    if (onRegenerate) {
      actions.closeActionSheet();
      onRegenerate(message.id);
    }
  };

  const toolActions = message.toolActions || [];

  return (
    <>
      <TouchableOpacity
        style={styles.assistantContainer}
        onLongPress={actions.openActionSheet}
        delayLongPress={350}
        activeOpacity={0.95}
      >
        <View style={styles.assistantIcon}>
          <Sparkles size={16} color={colors.primary} strokeWidth={2} />
        </View>
        <View style={styles.assistantBubble}>
          {thinking && (
            <ThinkingBlock
              thinking={thinking}
              isActivelyThinking={false}
              shouldShowThinking={showThinking}
              onToggle={() => setShowThinking(prev => !prev)}
            />
          )}

          {renderedContent && <View style={styles.markdownContainer}>{renderedContent}</View>}

          {/* Tool Actions Display - Liquid Glass Style */}
          {toolActions.length > 0 && (
            <ToolActionChips
              toolActions={toolActions}
              expandedToolIndex={expandedToolIndex}
              onToggleExpand={setExpandedToolIndex}
            />
          )}

          {/* Generation Stats - only if enabled in settings */}
          {showStats && message.stats && (
            <GenerationStats
              stats={message.stats}
              expanded={statsExpanded}
              onToggle={() => setStatsExpanded(prev => !prev)}
            />
          )}
        </View>
      </TouchableOpacity>

      <MessageActionSheet
        visible={actions.showActionSheet}
        isUser={false}
        copied={actions.copied}
        canEdit={false}
        canRegenerate={!!(onRegenerate && !isGenerating)}
        onClose={actions.closeActionSheet}
        onCopy={actions.handleCopy}
        onShare={actions.handleShare}
        onReadAloud={handleReadAloud}
        onEditOpen={noop}
        onRegenerate={handleRegenerate}
      />
    </>
  );
}

function noop() {}

const useStyles = makeStyles(({ colors }) => ({
  assistantContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    marginVertical: spacing.md,
  },
  assistantIcon: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primaryMuted,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    marginTop: 2,
  },
  assistantBubble: {
    flex: 1,
    paddingRight: spacing.lg,
  },
  markdownContainer: {
    flex: 1,
  },
}));
