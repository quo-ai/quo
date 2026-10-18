import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal } from 'react-native';
import { customModelService, CustomModelConfig } from '@/services/customModelService';
import { spacing, borderRadius, typography } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { settingsStyles } from './styles';

interface AddCustomModelModalProps {
  visible: boolean;
  onClose: () => void;
  onModelAdded: (model: CustomModelConfig) => void;
}

export function AddCustomModelModal({ visible, onClose, onModelAdded }: AddCustomModelModalProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [customModelName, setCustomModelName] = useState('');
  const [customModelUrl, setCustomModelUrl] = useState('');
  const [customModelError, setCustomModelError] = useState('');

  const handleAddCustomModel = async () => {
    setCustomModelError('');

    if (!customModelName.trim()) {
      setCustomModelError('Please enter a model name');
      return;
    }

    if (!customModelUrl.trim()) {
      setCustomModelError('Please enter a model URL');
      return;
    }

    const validation = customModelService.validateUrl(customModelUrl);
    if (!validation.valid) {
      setCustomModelError(validation.error || 'Invalid URL');
      return;
    }

    const result = await customModelService.addModel({
      name: customModelName.trim(),
      url: customModelUrl.trim(),
    });

    if (result.success && result.model) {
      setCustomModelName('');
      setCustomModelUrl('');
      setCustomModelError('');
      onModelAdded(result.model);
    } else {
      setCustomModelError(result.error || 'Failed to add model');
    }
  };

  const handleCancel = () => {
    setCustomModelName('');
    setCustomModelUrl('');
    setCustomModelError('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Add Custom Model</Text>

          <Text style={styles.customModelHint}>
            Enter a direct link to a GGUF model file. For best performance on mobile, use 4-bit quantized models (Q4_K_M or similar) under 4GB.
          </Text>

          <Text style={styles.inputLabel}>Model Name</Text>
          <TextInput
            style={styles.customModelInput}
            value={customModelName}
            onChangeText={setCustomModelName}
            placeholder="e.g., Llama 3.2 3B"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="words"
          />

          <Text style={styles.inputLabel}>GGUF URL</Text>
          <TextInput
            style={[styles.customModelInput, styles.urlInput]}
            value={customModelUrl}
            onChangeText={setCustomModelUrl}
            placeholder="https://huggingface.co/.../model.gguf"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          {customModelError ? (
            <Text style={styles.customModelError}>{customModelError}</Text>
          ) : null}

          <View style={styles.modalButtons}>
            <TouchableOpacity style={styles.modalCancelButton} onPress={handleCancel}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalSaveButton} onPress={handleAddCustomModel}>
              <Text style={styles.modalSaveText}>Add Model</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((theme) => {
  const { colors } = theme;
  return {
    ...settingsStyles(theme),
    customModelHint: {
      fontSize: typography.sizes.sm,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: spacing.lg,
      backgroundColor: colors.warningMuted,
      padding: spacing.md,
      borderRadius: borderRadius.lg,
    },
    inputLabel: {
      fontSize: typography.sizes.sm,
      fontWeight: typography.weights.medium,
      color: colors.textSecondary,
      marginBottom: spacing.xs,
      marginTop: spacing.sm,
    },
    customModelInput: {
      backgroundColor: colors.glassMedium,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: colors.glassBorder,
      padding: spacing.md,
      fontSize: typography.sizes.md,
      color: colors.textPrimary,
    },
    urlInput: {
      fontFamily: 'monospace',
      fontSize: typography.sizes.sm,
    },
    customModelError: {
      fontSize: typography.sizes.sm,
      color: colors.error,
      marginTop: spacing.sm,
    },
  };
});
