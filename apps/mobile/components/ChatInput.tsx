import React, { useState, useRef } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { ArrowUp, Paperclip } from 'lucide-react-native';
import { spacing, borderRadius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { ImageAttachment, DocumentAttachment } from '@/types/chat';
import { ShimmerText } from './ShimmerText';
import { usePremium } from '@/contexts/PremiumContext';
import { VoiceModelModal } from './VoiceModelModal';
import { useInlineToast } from '@/hooks/useInlineToast';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { useAttachments } from '@/hooks/useAttachments';
import { InlineToast } from './chat-input/InlineToast';
import { VoiceRecordingView, VoiceMicIcon } from './chat-input/VoiceRecordingView';
import { AttachmentPreview } from './chat-input/AttachmentPreview';
import { AttachSheet } from './chat-input/AttachSheet';

interface ChatInputProps {
  onSend: (message: string, image?: ImageAttachment, document?: DocumentAttachment) => void;
  onStop?: () => void;
  isGenerating?: boolean;
  disabled?: boolean;
  visionEnabled?: boolean;
  isModelLoading?: boolean;
}

// Small delay so the attach sheet finishes closing before a system picker opens
const PICKER_OPEN_DELAY_MS = Platform.OS === 'ios' ? 300 : 100;

function ChatInputComponent({ onSend, onStop, isGenerating, disabled, visionEnabled = true }: ChatInputProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { isPremium, checkPremiumFeature } = usePremium();
  const [message, setMessage] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showAttachSheet, setShowAttachSheet] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const { toast, toastAnim, showToast } = useInlineToast();
  const attachments = useAttachments({ visionEnabled });
  const voice = useVoiceInput({ message, setMessage, isPremium, checkPremiumFeature, showToast });
  const { selectedImage, selectedDocument, isExtractingText } = attachments;
  const isListening = voice.isVoiceActive;

  const handleSend = () => {
    // Sending is blocked while voice input is active: the final transcript
    // is appended to the pre-recording text and would re-insert a sent message.
    if ((message.trim() || selectedImage || selectedDocument) && !disabled && !isListening) {
      onSend(message.trim(), selectedImage || undefined, selectedDocument || undefined);
      setMessage('');
      attachments.clearAttachments();
    }
  };

  const openPickerAfterClose = (open: () => void) => {
    setShowAttachSheet(false);
    setTimeout(open, PICKER_OPEN_DELAY_MS);
  };

  const canSend = (message.trim() || selectedImage || selectedDocument) && !disabled && !isExtractingText && !isListening;
  const micDisabled = disabled || isGenerating || voice.isStarting || voice.isFinalizing;

  return (
    <View style={styles.container}>
      <InlineToast text={toast} anim={toastAnim} />

      <AttachmentPreview
        image={selectedImage}
        document={selectedDocument}
        isExtractingText={isExtractingText}
        onRemoveImage={attachments.removeImage}
        onRemoveDocument={attachments.removeDocument}
      />

      <View style={[
        styles.inputWrapper,
        isFocused && styles.inputWrapperFocused,
        isListening && styles.inputWrapperListening,
      ]}>
        <TouchableOpacity
          style={styles.attachButton}
          onPress={() => setShowAttachSheet(true)}
          disabled={disabled || isGenerating || isListening}
          activeOpacity={0.7}
        >
          <Paperclip
            size={20}
            color={disabled || isListening ? colors.textMuted : colors.textTertiary}
            strokeWidth={1.5}
          />
        </TouchableOpacity>

        <View style={styles.inputContainer}>
          {!message && !isFocused && !disabled && !isListening && !selectedImage && !selectedDocument && (
            <View style={styles.shimmerPlaceholder} pointerEvents="none">
              <ShimmerText
                text="Ask anything..."
                style={styles.placeholderText}
                baseColor={colors.textMuted}
                shimmerColor={colors.textSecondary}
                duration={3333}
              />
            </View>
          )}

          {/* Show realtime transcription or regular input */}
          {isListening ? (
            <VoiceRecordingView text={voice.realtimeText} isFinalizing={voice.isFinalizing} />
          ) : (
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={message}
              onChangeText={setMessage}
              placeholder={disabled ? "Model loading..." : ""}
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={4000}
              editable={!disabled}
              onSubmitEditing={handleSend}
              blurOnSubmit={false}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
            />
          )}
        </View>

        <TouchableOpacity
          style={[styles.voiceButton, voice.isRecording && styles.voiceButtonActive]}
          onPress={voice.toggleVoice}
          disabled={micDisabled}
          activeOpacity={0.7}
        >
          <VoiceMicIcon
            isListening={voice.isRecording && !voice.isFinalizing}
            dimmed={!!disabled || voice.isStarting || voice.isFinalizing}
          />
        </TouchableOpacity>

        {isGenerating ? (
          <TouchableOpacity
            style={styles.stopButton}
            onPress={() => onStop?.()}
            activeOpacity={0.8}
          >
            <View style={styles.stopIcon} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.sendButton, canSend && styles.sendButtonActive]}
            onPress={handleSend}
            disabled={!canSend}
            activeOpacity={0.8}
          >
            <ArrowUp
              size={20}
              color={canSend ? colors.onPrimary : colors.textMuted}
              strokeWidth={2}
            />
          </TouchableOpacity>
        )}
      </View>

      <VoiceModelModal
        visible={voice.showVoiceModelModal}
        onClose={voice.closeVoiceModelModal}
        onModelReady={() => {
          void voice.startRecording();
        }}
      />

      <AttachSheet
        visible={showAttachSheet}
        visionEnabled={visionEnabled}
        onClose={() => setShowAttachSheet(false)}
        onTakePhoto={() => openPickerAfterClose(attachments.takePhoto)}
        onPickFromLibrary={() => openPickerAfterClose(attachments.pickImage)}
        onPickDocument={() => openPickerAfterClose(attachments.pickDocument)}
      />
    </View>
  );
}

export const ChatInput = React.memo(ChatInputComponent);

const useStyles = makeStyles(({ colors }) => ({
  container: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glass,
    borderRadius: borderRadius.xxl,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    minHeight: 52,
    maxHeight: 350,
  },
  inputWrapperFocused: {
    borderColor: colors.glassShine,
    backgroundColor: colors.glassMedium,
  },
  inputWrapperListening: {
    borderColor: colors.primaryGlow,
    backgroundColor: colors.primaryMuted,
    borderWidth: 1,
  },
  attachButton: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputContainer: {
    flex: 1,
    position: 'relative',
    minHeight: 36,
  },
  shimmerPlaceholder: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 16,
  },
  input: {
    width: '100%',
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 300,
    minHeight: 36,
    paddingVertical: 0,
    paddingHorizontal: spacing.sm,
    textAlignVertical: 'center',
  },
  voiceButton: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceButtonActive: {
    backgroundColor: colors.errorMuted,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    backgroundColor: colors.glassMedium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonActive: {
    backgroundColor: colors.primaryFill,
  },
  stopButton: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    backgroundColor: colors.glassStrong,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopIcon: {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: colors.textPrimary,
  },
}));
