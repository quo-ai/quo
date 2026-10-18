import React from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import { X, FileText } from 'lucide-react-native';
import { spacing, borderRadius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { ImageAttachment, DocumentAttachment } from '@/types/chat';
import { getFileTypeLabel } from '@/services/fileExtractor';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AttachmentPreviewProps {
  image: ImageAttachment | null;
  document: DocumentAttachment | null;
  isExtractingText: boolean;
  onRemoveImage: () => void;
  onRemoveDocument: () => void;
}

/** Previews of the pending image/document attachment above the input bar. */
export function AttachmentPreview({
  image,
  document,
  isExtractingText,
  onRemoveImage,
  onRemoveDocument,
}: AttachmentPreviewProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <>
      {image && (
        <View style={styles.imagePreviewWrapper}>
          <View style={styles.imagePreviewContainer}>
            <Image source={{ uri: image.uri }} style={styles.imagePreview} />
            <TouchableOpacity
              style={styles.removeImageButton}
              onPress={onRemoveImage}
              activeOpacity={0.8}
            >
              <X size={12} color={colors.onInverseSurface} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {document && (
        <View style={styles.docPreviewWrapper}>
          <View style={styles.docPreviewContainer}>
            <FileText size={18} color={colors.primary} strokeWidth={1.5} />
            <View style={styles.docPreviewText}>
              <Text style={styles.docPreviewName} numberOfLines={1}>{document.name}</Text>
              <Text style={styles.docPreviewMeta}>
                {getFileTypeLabel(document.mimeType, document.name)} · {formatFileSize(document.size)}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.removeDocButton}
              onPress={onRemoveDocument}
              activeOpacity={0.8}
            >
              <X size={12} color={colors.onInverseSurface} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {isExtractingText && (
        <View style={styles.docPreviewWrapper}>
          <View style={styles.docPreviewContainer}>
            <FileText size={18} color={colors.textMuted} strokeWidth={1.5} />
            <Text style={styles.docExtractingText}>Reading file...</Text>
          </View>
        </View>
      )}
    </>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  imagePreviewWrapper: {
    marginBottom: spacing.md,
  },
  imagePreviewContainer: {
    position: 'relative',
    alignSelf: 'flex-start',
  },
  imagePreview: {
    width: 72,
    height: 72,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
  },
  removeImageButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.inverseSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docPreviewWrapper: {
    marginBottom: spacing.md,
  },
  docPreviewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glass,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  docPreviewText: {
    flex: 1,
  },
  docPreviewName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  docPreviewMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  removeDocButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.inverseSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docExtractingText: {
    flex: 1,
    fontSize: 14,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
}));
