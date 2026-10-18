import { useEffect, useRef, Dispatch, SetStateAction } from 'react';
import { AppState } from 'react-native';
import { Conversation } from '@/types/chat';
import { saveConversations, capConversationsForFreeTier, deleteConversationRows } from '@/services/storage';
import { FREE_TIER_LIMITS } from '@/constants/premium';

// Debounced conversation persistence with free-tier capping. Streaming text
// lives outside `conversations`, so this also saves mid-generation (e.g. the
// user's message is persisted right away, not only once the reply finishes).
export function useConversationPersistence({
  conversations,
  setConversations,
  currentConversation,
  setCurrentConversation,
  isLoading,
  isPremium,
}: {
  conversations: Conversation[];
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  currentConversation: Conversation | null;
  setCurrentConversation: Dispatch<SetStateAction<Conversation | null>>;
  isLoading: boolean;
  isPremium: boolean;
}) {
  // Debounced save to prevent excessive writes during rapid updates
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<(() => void) | null>(null);
  const lastSavedCountRef = useRef(0);

  useEffect(() => {
    if (isLoading) return;

    const save = () => {
      saveTimeoutRef.current = null;
      pendingSaveRef.current = null;
      const toSave = isPremium ? conversations : capConversationsForFreeTier(conversations, FREE_TIER_LIMITS.MAX_CHAT_HISTORY);

      // Only update state if we actually need to cap (prevents infinite loop)
      if (!isPremium && toSave.length !== conversations.length && conversations.length !== lastSavedCountRef.current) {
        lastSavedCountRef.current = toSave.length;
        setConversations(toSave);
        if (currentConversation && !toSave.some(c => c.id === currentConversation.id)) {
          setCurrentConversation(toSave[0] ?? null);
        }
      }
      void saveConversations(toSave);
      // Rows are only ever deleted explicitly; drop the ones the cap removed.
      if (toSave.length !== conversations.length) {
        const kept = new Set(toSave.map(c => c.id));
        void deleteConversationRows(conversations.filter(c => !kept.has(c.id)).map(c => c.id));
      }
    };

    // Debounce: wait 500ms before saving
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    pendingSaveRef.current = save;
    saveTimeoutRef.current = setTimeout(save, 500);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [conversations, isLoading, isPremium, currentConversation, setConversations, setCurrentConversation]);

  // Flush a pending debounced save when the app is backgrounded — the OS may
  // kill it before the timer fires.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' || !pendingSaveRef.current) return;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      pendingSaveRef.current();
    });
    return () => subscription.remove();
  }, []);
}
