import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { borderRadius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { sanitizeStreamingMarkdown, splitStreamingBlocks, stripPartialThinkTag } from '@/utils/streamingMarkdown';
import { renderContentWithMath } from '@/components/message/markdownRules';
import { parseChainOfThought } from '@/components/message/parseChainOfThought';

interface StreamingBubbleProps {
  content: string;
}

// Typewriter pacing: how often the displayed text advances, and how quickly
// it catches up to the incoming stream (larger backlog → bigger steps, so we
// never lag more than ~a dozen ticks behind the model).
const TYPEWRITER_TICK_MS = 55;
const CATCHUP_DIVISOR = 12;
const MIN_STEP_CHARS = 3;
const CURSOR = '▍';

/**
 * Smoothly reveal `target` a few characters per tick instead of in whole
 * network-throttle chunks. The interval only runs while there is a backlog
 * (it stops once caught up and restarts when the target grows). If the
 * target is rewritten (not an extension of what is displayed), snap to it.
 */
function useTypewriter(target: string): string {
  const [displayed, setDisplayed] = useState('');
  const displayedRef = useRef('');

  useEffect(() => {
    if (displayedRef.current === target) return;
    const timer = setInterval(() => {
      const prev = displayedRef.current;
      let next: string;
      if (!target.startsWith(prev)) {
        next = target; // rewritten — snap
      } else {
        const backlog = target.length - prev.length;
        const step = Math.max(MIN_STEP_CHARS, Math.ceil(backlog / CATCHUP_DIVISOR));
        next = target.slice(0, prev.length + step);
      }
      displayedRef.current = next;
      setDisplayed(next);
      if (next === target) clearInterval(timer);
    }, TYPEWRITER_TICK_MS);
    return () => clearInterval(timer);
  }, [target]);

  // Never show text the target no longer has while waiting for the snap.
  return target.startsWith(displayed) ? displayed : target;
}

/** A completed markdown block — its text never changes, so it parses once. */
const MarkdownBlock = memo(function MarkdownBlock({ text }: { text: string }) {
  return renderContentWithMath(text);
});

export function StreamingBubble({ content }: StreamingBubbleProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const smoothContent = useTypewriter(content);
  // Same parser as the final MessageBubble (handles <think>, [THINK] and a
  // lone closing tag), so the thinking section doesn't jump on completion.
  const { thinking, mainContent } = useMemo(() => {
    const parsed = parseChainOfThought(stripPartialThinkTag(smoothContent));
    return { thinking: parsed.thinking, mainContent: parsed.content.trim() };
  }, [smoothContent]);

  // Completed blocks render once (memoized); only the trailing block is
  // re-balanced and re-parsed on each tick. Balancing unclosed markdown lets
  // partial **bold**, `code`, fences, and $$math$$ render styled mid-stream.
  const { blocks, tail } = useMemo(() => splitStreamingBlocks(mainContent), [mainContent]);
  const renderedTail = useMemo(
    () => (thinking && !mainContent ? null : renderContentWithMath(sanitizeStreamingMarkdown(tail, CURSOR))),
    [tail, thinking, mainContent],
  );

  return (
    <View style={styles.container}>
      <View style={styles.icon}>
        <Sparkles size={16} color={colors.primary} strokeWidth={2} />
      </View>
      <View style={styles.bubble}>
        {thinking ? (
          <View style={styles.thinkingContainer}>
            <Text style={styles.thinkingLabel}>Thinking…</Text>
            {renderContentWithMath(thinking, { muted: true })}
          </View>
        ) : null}

        {blocks.map((block, index) => (
          <MarkdownBlock key={index} text={block} />
        ))}
        {renderedTail}
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    marginVertical: spacing.md,
  },
  icon: {
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
  bubble: {
    flex: 1,
    paddingRight: spacing.lg,
  },
  thinkingContainer: {
    marginBottom: spacing.md,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: spacing.md,
  },
  thinkingLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
}));
