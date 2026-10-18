import React, { useCallback, useState } from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import { FileText } from 'lucide-react-native';
import { Message } from '@/types/chat';
import { borderRadius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { useMessageActions } from '@/hooks/useMessageActions';
import { MessageActionSheet } from '@/components/message/MessageActionSheet';
import { EditResendModal } from '@/components/message/EditResendModal';

interface UserBubbleProps {
  message: Message;
  onResend?: (messageId: string, newContent?: string) => void;
  isGenerating?: boolean;
}

export function UserBubble({ message, onResend, isGenerating }: UserBubbleProps) {
  const [showEditModal, setShowEditModal] = useState(false);
  const [editedContent, setEditedContent] = useState(message.content);
  const getText = useCallback(() => message.content, [message.content]);
  const actions = useMessageActions(getText);
  const { colors } = useTheme();
  const styles = useStyles();

  const handleEditOpen = () => {
    actions.closeActionSheet();
    setEditedContent(message.content);
    setShowEditModal(true);
  };

  const handleResend = () => {
    if (onResend) {
      setShowEditModal(false);
      onResend(message.id, editedContent.trim() || undefined);
    }
  };

  const handleResendOriginal = () => {
    if (onResend) {
      setShowEditModal(false);
      onResend(message.id);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={styles.userContainer}
        onLongPress={actions.openActionSheet}
        delayLongPress={350}
        activeOpacity={0.8}
      >
        <View style={styles.userBubble}>
          {message.image && (
            <Image
              source={{ uri: message.image.uri }}
              style={styles.userImage}
              resizeMode="cover"
            />
          )}
          {message.document && (
            <View style={styles.docAttachmentChip}>
              <FileText size={14} color={colors.primary} strokeWidth={1.5} />
              <Text style={styles.docAttachmentName} numberOfLines={1}>{message.document.name}</Text>
            </View>
          )}
          {message.content ? (
            <Text style={styles.userText}>{message.content}</Text>
          ) : null}
        </View>
      </TouchableOpacity>

      <MessageActionSheet
        visible={actions.showActionSheet}
        isUser
        copied={actions.copied}
        canEdit={!!(onResend && !isGenerating)}
        canRegenerate={false}
        onClose={actions.closeActionSheet}
        onCopy={actions.handleCopy}
        onShare={actions.handleShare}
        onReadAloud={noop}
        onEditOpen={handleEditOpen}
        onRegenerate={noop}
      />

      <EditResendModal
        visible={showEditModal}
        editedContent={editedContent}
        onChangeContent={setEditedContent}
        onClose={() => setShowEditModal(false)}
        onResend={handleResend}
        onResendOriginal={handleResendOriginal}
      />
    </>
  );
}

function noop() {}

const useStyles = makeStyles(({ colors }) => ({
  userContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    marginVertical: spacing.sm,
  },
  userBubble: {
    maxWidth: '85%',
    backgroundColor: colors.userBubble,
    borderRadius: borderRadius.xl,
    borderBottomRightRadius: borderRadius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.userBubbleBorder,
  },
  userImage: {
    width: 200,
    height: 200,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  userText: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 24,
  },
  // Document attachment chip in user messages
  docAttachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryMuted,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    gap: 6,
    marginBottom: spacing.xs,
    alignSelf: 'flex-start',
  },
  docAttachmentName: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.primary,
    flexShrink: 1,
  },
}));
