import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, Text, View } from 'react-native';
import { Mic, MicOff } from 'lucide-react-native';
import { spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';

interface VoiceRecordingViewProps {
  text: string;
  isFinalizing: boolean;
}

/**
 * Inline recording view shown in place of the TextInput: animated waveform
 * bars plus the live transcription. Mounted only while voice is active, so
 * the loops start on mount and stop on unmount.
 */
export function VoiceRecordingView({ text, isFinalizing }: VoiceRecordingViewProps) {
  const styles = useStyles();
  const scrollRef = useRef<ScrollView>(null);
  const waveAnim1 = useState(() => new Animated.Value(0))[0];
  const waveAnim2 = useState(() => new Animated.Value(0))[0];
  const waveAnim3 = useState(() => new Animated.Value(0))[0];
  const textFadeAnim = useState(() => new Animated.Value(0))[0];

  useEffect(() => {
    // Wave animations for audio visualizer bars
    const wave1 = Animated.loop(
      Animated.sequence([
        Animated.timing(waveAnim1, { toValue: 1, duration: 300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(waveAnim1, { toValue: 0.3, duration: 300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    const wave2 = Animated.loop(
      Animated.sequence([
        Animated.delay(100),
        Animated.timing(waveAnim2, { toValue: 1, duration: 350, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(waveAnim2, { toValue: 0.4, duration: 350, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    const wave3 = Animated.loop(
      Animated.sequence([
        Animated.delay(200),
        Animated.timing(waveAnim3, { toValue: 1, duration: 280, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(waveAnim3, { toValue: 0.5, duration: 280, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );

    // Text fade in animation
    Animated.timing(textFadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    wave1.start();
    wave2.start();
    wave3.start();

    return () => {
      wave1.stop();
      wave2.stop();
      wave3.stop();
    };
  }, [textFadeAnim, waveAnim1, waveAnim2, waveAnim3]);

  const placeholder = isFinalizing ? 'Finishing transcription...' : 'Listening...';

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.voiceInputScroll}
      contentContainerStyle={styles.voiceInputContent}
      showsVerticalScrollIndicator={false}
      onContentSizeChange={() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }}
    >
      <View style={styles.voiceInputRow}>
        {/* Waveform indicator */}
        <Animated.View style={[styles.inlineWaveform, { opacity: textFadeAnim }]}>
          <Animated.View style={[styles.waveBar, { transform: [{ scaleY: waveAnim1 }], opacity: 0.6 }]} />
          <Animated.View style={[styles.waveBar, styles.waveBarMid, { transform: [{ scaleY: waveAnim2 }] }]} />
          <Animated.View style={[styles.waveBar, styles.waveBarTall, { transform: [{ scaleY: waveAnim3 }] }]} />
          <Animated.View style={[styles.waveBar, styles.waveBarMid, { transform: [{ scaleY: waveAnim1 }] }]} />
          <Animated.View style={[styles.waveBar, { transform: [{ scaleY: waveAnim2 }], opacity: 0.6 }]} />
        </Animated.View>
        {/* Transcription text */}
        <Text style={[styles.voiceInputText, !text && isFinalizing && styles.voiceInputTextMuted]}>
          {text || placeholder}
        </Text>
      </View>
    </ScrollView>
  );
}

interface VoiceMicIconProps {
  isListening: boolean;
  dimmed: boolean;
}

/** Mic button icon; pulses while listening. */
export function VoiceMicIcon({ isListening, dimmed }: VoiceMicIconProps) {
  const { colors } = useTheme();
  const pulseAnim = useState(() => new Animated.Value(1))[0];

  useEffect(() => {
    if (!isListening) {
      pulseAnim.setValue(1);
      return;
    }
    // Pulse animation for mic button
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [isListening, pulseAnim]);

  return (
    <Animated.View style={{ transform: [{ scale: isListening ? pulseAnim : 1 }] }}>
      {isListening ? (
        <MicOff size={18} color={dimmed ? colors.textMuted : colors.error} strokeWidth={2} />
      ) : (
        <Mic size={18} color={dimmed ? colors.textMuted : colors.textTertiary} strokeWidth={1.5} />
      )}
    </Animated.View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  voiceInputScroll: {
    width: '100%',
    maxHeight: 300,
  },
  voiceInputContent: {
    flexGrow: 1,
  },
  voiceInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 36,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
  },
  inlineWaveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginRight: spacing.sm,
    marginTop: 4,
  },
  waveBar: {
    width: 3,
    height: 12,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  waveBarMid: {
    height: 18,
  },
  waveBarTall: {
    height: 24,
  },
  voiceInputText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  voiceInputTextMuted: {
    color: colors.textMuted,
  },
}));
