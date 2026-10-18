import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, ToastAndroid } from 'react-native';

// iOS has no ToastAndroid equivalent — minimal self-dismissing inline toast
// (fades in above the input, then fades out). Android uses the system toast.
export function useInlineToast() {
  const [toast, setToast] = useState<string | null>(null);
  const toastAnim = useState(() => new Animated.Value(0))[0];
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const showToast = useCallback((text: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(text, ToastAndroid.SHORT);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(text);
    toastAnim.setValue(0);
    Animated.timing(toastAnim, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
    timerRef.current = setTimeout(() => {
      Animated.timing(toastAnim, {
        toValue: 0,
        duration: 300,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }).start(() => setToast(null));
    }, 2200);
  }, [toastAnim]);

  return { toast, toastAnim, showToast };
}
