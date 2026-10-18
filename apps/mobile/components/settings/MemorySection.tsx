import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
} from 'react-native';
import { Trash2, ChevronRight, ChevronDown, BookOpen, X, Pencil } from 'lucide-react-native';
import { memoryService, Memory } from '@/services/memory';
import { spacing, borderRadius, typography } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { settingsStyles } from './styles';

interface MemorySectionProps {
  isPremium: boolean;
}

export function MemorySection({ isPremium }: MemorySectionProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoriesExpanded, setMemoriesExpanded] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [editText, setEditText] = useState('');
  const [showClearMemoriesConfirm, setShowClearMemoriesConfirm] = useState(false);

  // Subscribe to memory changes for real-time updates
  useEffect(() => {
    // Subscribe to changes - this will handle all updates including initial load
    const unsubscribe = memoryService.subscribe((updatedMemories) => {
      // Sort by most recent first
      const sorted = [...updatedMemories].sort((a, b) => b.createdAt - a.createdAt);
      setMemories(sorted);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleDeleteMemory = async (id: string) => {
    await memoryService.deleteMemory(id);
  };

  const handleEditMemory = (memory: Memory) => {
    setEditingMemory(memory);
    setEditText(memory.content);
  };

  const handleSaveEdit = async () => {
    if (editingMemory && editText.trim()) {
      try {
        // Edit in place — delete+add would drop the memory when the user is
        // over the (free-tier) slot limit, and would reset its createdAt.
        await memoryService.updateMemory(editingMemory.id, editText);
        setEditingMemory(null);
        setEditText('');
      } catch (error) {
        console.error('[MemorySection] Failed to update memory:', error);
      }
    }
  };

  const handleCancelEdit = () => {
    setEditingMemory(null);
    setEditText('');
  };

  const handleClearAllMemories = async () => {
    if (showClearMemoriesConfirm) {
      await memoryService.clearAllMemories();
      setMemories([]);
      setShowClearMemoriesConfirm(false);
    } else {
      setShowClearMemoriesConfirm(true);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>AI Memory</Text>
      <Text style={styles.sectionDescription}>
        The AI remembers important information you share ({memories.length}/{memoryService.getMaxMemories(isPremium)} slots used)
      </Text>

      {/* Expandable memory dropdown */}
      <TouchableOpacity
        style={styles.card}
        onPress={() => setMemoriesExpanded(!memoriesExpanded)}
        activeOpacity={0.7}
      >
        <View style={styles.settingRow}>
          <View style={styles.settingIcon}>
            <BookOpen size={20} color={memories.length > 0 ? colors.primary : colors.textTertiary} />
          </View>
          <View style={styles.settingContent}>
            <Text style={styles.settingLabel}>
              {memories.length === 0 ? 'No memories yet' : `${memories.length} memories stored`}
            </Text>
            <Text style={styles.settingDescription}>
              {memories.length === 0
                ? 'Share your name or preferences and the AI will remember them'
                : 'Tap to view and manage memories'}
            </Text>
          </View>
          {memories.length > 0 && (
            <View style={styles.chevronIcon}>
              {memoriesExpanded ? (
                <ChevronDown size={20} color={colors.textTertiary} />
              ) : (
                <ChevronRight size={20} color={colors.textTertiary} />
              )}
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* Expanded memory list */}
      {memoriesExpanded && memories.length > 0 && (
        <View style={styles.memoryListCard}>
          <ScrollView style={styles.memoryScrollView} nestedScrollEnabled>
            {memories.map((memory, index) => (
              <View key={memory.id} style={[styles.memoryRow, index > 0 && styles.memoryRowBorder]}>
                <View style={styles.memoryContent}>
                  <Text style={styles.memoryText}>{memory.content}</Text>
                  <Text style={styles.memoryDate}>
                    {new Date(memory.createdAt).toLocaleDateString()} • {new Date(memory.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
                <View style={styles.memoryActions}>
                  <TouchableOpacity
                    style={styles.memoryActionButton}
                    onPress={() => handleEditMemory(memory)}
                  >
                    <Pencil size={14} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.memoryActionButton}
                    onPress={() => handleDeleteMemory(memory.id)}
                  >
                    <X size={14} color={colors.error} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>

          {/* Clear all button inside dropdown */}
          <TouchableOpacity
            style={styles.clearMemoriesButton}
            onPress={handleClearAllMemories}
          >
            <Trash2 size={14} color={colors.error} />
            <Text style={styles.clearMemoriesText}>
              {showClearMemoriesConfirm ? 'Tap again to confirm' : 'Clear All'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Edit Memory Modal */}
      <Modal
        visible={editingMemory !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={handleCancelEdit}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Memory</Text>
            <TextInput
              style={styles.modalInput}
              value={editText}
              onChangeText={setEditText}
              multiline
              placeholder="Enter memory content..."
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={handleCancelEdit}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveButton} onPress={handleSaveEdit}>
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((theme) => {
  const { colors } = theme;
  return {
    ...settingsStyles(theme),
    memoryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.lg,
    },
    memoryRowBorder: {
      borderTopWidth: 1,
      borderTopColor: colors.glassBorder,
    },
    memoryContent: {
      flex: 1,
    },
    memoryText: {
      fontSize: typography.sizes.sm,
      color: colors.textPrimary,
      lineHeight: 20,
    },
    memoryDate: {
      fontSize: typography.sizes.xs,
      color: colors.textTertiary,
      marginTop: spacing.xs,
    },
    chevronIcon: {
      marginLeft: spacing.sm,
    },
    memoryListCard: {
      backgroundColor: colors.glassMedium,
      borderRadius: borderRadius.xl,
      borderWidth: 1,
      borderColor: colors.glassBorder,
      marginTop: spacing.sm,
      overflow: 'hidden',
    },
    memoryScrollView: {
      maxHeight: 300,
    },
    memoryActions: {
      flexDirection: 'row',
      gap: spacing.xs,
    },
    memoryActionButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clearMemoriesButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.glassBorder,
      backgroundColor: colors.errorMuted,
    },
    clearMemoriesText: {
      fontSize: typography.sizes.sm,
      fontWeight: typography.weights.medium,
      color: colors.error,
    },
    modalInput: {
      backgroundColor: colors.glassMedium,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: colors.glassBorder,
      padding: spacing.md,
      fontSize: typography.sizes.md,
      color: colors.textPrimary,
      minHeight: 80,
      textAlignVertical: 'top',
    },
  };
});
