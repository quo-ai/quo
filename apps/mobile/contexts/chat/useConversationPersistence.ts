import { useCallback, useEffect, useRef, Dispatch, SetStateAction } from 'react';
import { AppState } from 'react-native';
import { Conversation } from '@/types/chat';
import { saveConversations, capConversationsForFreeTier, deleteConversationRows, whenWritten } from '@/services/storage';
import { FREE_TIER_LIMITS } from '@/constants/premium';

// Debounced conversation persistence with free-tier capping. Streaming text
// lives outside `conversations`, so this also saves mid-generation (e.g. the
// user's message is persisted right away, not only once the reply finishes).
//
// A save always writes the chats as they are *now* (`getLatest`), not as they
// were when it was scheduled, so flushing early (Quo Sync does, before it
// merges) can never write something stale.
export function useConversationPersistence({
  conversations,
  getLatest,
  setConversations,
  currentConversation,
  setCurrentConversation,
  isLoading,
  isPremium,
}: {
  conversations: Conversation[];
  /** The chats as they are right now, even if React hasn't rendered the latest change yet. */
  getLatest: () => Conversation[];
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  currentConversation: Conversation | null;
  setCurrentConversation: Dispatch<SetStateAction<Conversation | null>>;
  isLoading: boolean;
  isPremium: boolean;
}) {
  // Debounced save to prevent excessive writes during rapid updates
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitingRef = useRef(false);
  const lastSavedCountRef = useRef(0);

  // Reassigned every render, so it always sees the current plan and open chat.
  const saveRef = useRef<() => void>(() => {});
  saveRef.current = () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
    waitingRef.current = false;
    const latest = getLatest();
    const toSave = isPremium ? latest : capConversationsForFreeTier(latest, FREE_TIER_LIMITS.MAX_CHAT_HISTORY);

    // Only update state if we actually need to cap (prevents infinite loop)
    if (!isPremium && toSave.length !== latest.length && latest.length !== lastSavedCountRef.current) {
      lastSavedCountRef.current = toSave.length;
      setConversations(toSave);
      if (currentConversation && !toSave.some(c => c.id === currentConversation.id)) {
        setCurrentConversation(toSave[0] ?? null);
      }
    }
    void saveConversations(toSave);
    // Rows are only ever deleted explicitly; drop the ones the cap removed. Quietly:
    // they still exist on the user's other devices, so Quo Sync isn't told they were deleted.
    if (toSave.length !== latest.length) {
      const kept = new Set(toSave.map(c => c.id));
      void deleteConversationRows(latest.filter(c => !kept.has(c.id)).map(c => c.id), { quiet: true });
    }
  };

  useEffect(() => {
    if (isLoading) return;
    // Debounce: wait 500ms before saving
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    waitingRef.current = true;
    saveTimeoutRef.current = setTimeout(() => saveRef.current(), 500);

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
      if (state === 'active' || !waitingRef.current) return;
      saveRef.current();
    });
    return () => subscription.remove();
  }, []);

  /** Writes any edit still waiting for the debounce, and resolves when everything is on disk. */
  const flush = useCallback(async () => {
    if (waitingRef.current) saveRef.current();
    await whenWritten();
  }, []);

  return { flush };
}
