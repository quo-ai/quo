import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Copy, Check } from 'lucide-react-native';
import { spacing, borderRadius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';

interface CodeBlockProps {
  children: string;
  language?: string;
}

export function CodeBlock({ children, language }: CodeBlockProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(children);
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => {
      copiedTimerRef.current = null;
      setCopied(false);
    }, 2000);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.language}>{language || 'code'}</Text>
        <TouchableOpacity onPress={handleCopy} style={styles.copyButton}>
          {copied ? (
            <>
              <Check size={12} color={colors.success} />
              <Text style={styles.copiedText}>Copied!</Text>
            </>
          ) : (
            <>
              <Copy size={12} color={colors.textTertiary} />
              <Text style={styles.copyText}>Copy</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text style={styles.code}>{children}</Text>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    backgroundColor: colors.codeBackground,
    borderRadius: borderRadius.lg,
    marginVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.codeBorder,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.codeHeader,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.codeBorder,
  },
  language: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'lowercase',
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  copyText: {
    color: colors.textTertiary,
    fontSize: 11,
  },
  copiedText: {
    color: colors.success,
    fontSize: 11,
  },
  code: {
    color: colors.codeText,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
    padding: spacing.md,
  },
}));
