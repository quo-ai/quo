import { useCallback, useEffect, useRef, useState } from 'react';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';

const COPIED_RESET_MS = 2500;

/**
 * Action-sheet state shared by user and assistant bubbles: open/close,
 * copy (with a "Copied!" flash whose timer is cleared on unmount), share.
 * `getText` returns what Copy/Share should use.
 */
export function useMessageActions(getText: () => string) {
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getTextRef = useRef(getText);
  useEffect(() => {
    getTextRef.current = getText;
  }, [getText]);

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  const openActionSheet = useCallback(() => setShowActionSheet(true), []);
  const closeActionSheet = useCallback(() => setShowActionSheet(false), []);

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(getTextRef.current());
    setCopied(true);
    setShowActionSheet(false);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => {
      copiedTimerRef.current = null;
      setCopied(false);
    }, COPIED_RESET_MS);
  }, []);

  const handleShare = useCallback(async () => {
    setShowActionSheet(false);
    await Share.share({ message: getTextRef.current() });
  }, []);

  return {
    showActionSheet,
    copied,
    openActionSheet,
    closeActionSheet,
    handleCopy,
    handleShare,
  };
}
