import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Alert,
  ListRenderItem,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// expo-router 57 vendors react-navigation — use its drawer types so this
// content component matches the navigator that actually renders it.
import { type DrawerContentComponentProps } from 'expo-router/drawer';
import { useRouter } from 'expo-router';
import { Settings, Plus, MessageSquarePlus } from 'lucide-react-native';
import { useChat } from '@/contexts/ChatContext';
import { usePremium } from '@/contexts/PremiumContext';
import { Conversation } from '@/types/chat';
import { spacing, borderRadius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { QuoLogo } from '@/components/brand/QuoLogo';
import { UpgradeBanner } from '@/components/UpgradeBanner';

const PAGE_SIZE = 15;

interface ConversationRowProps {
  id: string;
  title: string;
  isActive: boolean;
  onPress: (id: string) => void;
  onLongPress: (id: string, title: string) => void;
}

// Rows take primitives (not the Conversation object, which is replaced on
// every message) so memo skips all rows whose title/active state is unchanged.
const ConversationRow = memo(function ConversationRow({ id, title, isActive, onPress, onLongPress }: ConversationRowProps) {
  const styles = useStyles();
  return (
    <TouchableOpacity
      style={[styles.recentItem, isActive && styles.recentItemActive]}
      onPress={() => onPress(id)}
      onLongPress={() => onLongPress(id, title)}
      activeOpacity={0.7}
    >
      <Text style={[styles.recentText, isActive && styles.recentTextActive]} numberOfLines={1}>
        {title}
      </Text>
    </TouchableOpacity>
  );
});

const keyExtractor = (item: Conversation) => item.id;

export function CustomDrawer(props: DrawerContentComponentProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { setCurrentConversation, conversations, currentConversation, deleteConversation, createNewChat } = useChat();
  const { isPremium, hasActivated, openUpgradeModal } = usePremium();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { navigation } = props;
  const currentId = currentConversation?.id;

  // Rows hand back an id; look up the latest conversation object at press
  // time so we never switch to a stale snapshot.
  const conversationsRef = useRef(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const visibleConversations = useMemo(
    () => conversations.slice(0, visibleCount),
    [conversations, visibleCount],
  );

  const navigateTo = (path: string) => {
    navigation.closeDrawer();
    router.push(path as any);
  };

  const handleNewChat = () => {
    createNewChat();
    navigation.closeDrawer();
    router.push('/');
  };

  const handleRowPress = useCallback((id: string) => {
    const conversation = conversationsRef.current.find(c => c.id === id);
    if (!conversation) return;
    setCurrentConversation(conversation);
    navigation.closeDrawer();
    router.push('/');
  }, [setCurrentConversation, navigation, router]);

  const handleRowLongPress = useCallback((id: string, title: string) => {
    Alert.alert(
      'Delete conversation?',
      `"${title}" will be permanently deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteConversation(id) },
      ],
    );
  }, [deleteConversation]);

  const renderItem = useCallback<ListRenderItem<Conversation>>(({ item }) => (
    <ConversationRow
      id={item.id}
      title={item.title}
      isActive={item.id === currentId}
      onPress={handleRowPress}
      onLongPress={handleRowLongPress}
    />
  ), [currentId, handleRowPress, handleRowLongPress]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.logoRow}>
          <View style={styles.logoImage}>
            <QuoLogo size={28} backgroundColor={colors.background} ringWidth={36} />
          </View>
          <Text style={styles.appName}>Quo</Text>
        </View>
        <TouchableOpacity
          style={styles.newChatButton}
          onPress={handleNewChat}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <MessageSquarePlus size={22} color={colors.textSecondary} strokeWidth={1.5} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={visibleConversations}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        extraData={currentId}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onEndReached={() => {
          if (visibleCount < conversations.length) {
            setVisibleCount(prev => Math.min(prev + PAGE_SIZE, conversations.length));
          }
        }}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          conversations.length > 0 ? (
            <View style={styles.recentHeader}>
              <Text style={styles.sectionLabel}>Recent</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No conversations yet</Text>
            <TouchableOpacity
              style={styles.emptyNewChatButton}
              onPress={handleNewChat}
              activeOpacity={0.7}
            >
              <Plus size={16} color={colors.primary} strokeWidth={2} />
              <Text style={styles.emptyNewChatText}>Start a new chat</Text>
            </TouchableOpacity>
          </View>
        }
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        {!isPremium && hasActivated && (
          <>
            <UpgradeBanner variant="compact" onPress={() => openUpgradeModal()} />
            <View style={styles.footerDivider} />
          </>
        )}
        
        <TouchableOpacity 
          style={styles.settingsButton} 
          onPress={() => navigateTo('/settings')}
          activeOpacity={0.7}
        >
          <Settings size={18} color={colors.textSecondary} strokeWidth={1.5} />
          <Text style={styles.settingsText}>Settings</Text>
        </TouchableOpacity>
        
        <View style={styles.footerDivider} />
        
        <View style={styles.footerBadge}>
          <View style={styles.footerDot} />
          <Text style={styles.footerText}>Private & Offline</Text>
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  newChatButton: {
    padding: spacing.sm,
  },
  logoImage: {
    width: 28,
    height: 28,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appName: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: -0.3,
    marginTop: 2,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  recentHeader: {
    paddingTop: spacing.sm,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: spacing.md,
    marginBottom: spacing.sm,
  },
  recentItem: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginVertical: 1,
  },
  recentItemActive: {
    backgroundColor: colors.glassMedium,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  recentText: {
    fontSize: 14,
    color: colors.textTertiary,
  },
  recentTextActive: {
    color: colors.textPrimary,
    fontWeight: '500',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.lg,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  emptyNewChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primaryMuted,
    borderWidth: 1,
    borderColor: colors.primaryGlow,
  },
  emptyNewChatText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  settingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
  },
  settingsText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  footerDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: spacing.md,
  },
  footerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  footerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  footerText: {
    fontSize: 12,
    color: colors.textTertiary,
  },
}));
