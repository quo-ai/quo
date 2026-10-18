import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, LayoutChangeEvent, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Extra px above reported keyboard height so the input bar sits clearly above the keyboard
// (Android often reports a slightly smaller height, especially with edge-to-edge)
const KEYBOARD_EXTRA_OFFSET = Platform.OS === 'android' ? 48 : 16;

/**
 * Animated offsets for a floating input bar pinned to the bottom: it sits
 * above the nav bar inset when the keyboard is hidden and above the
 * keyboard when it is shown.
 */
export function useKeyboardInset() {
  const insets = useSafeAreaInsets();
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const keyboardVisibleRef = useRef(false);
  const bottomInsetRef = useRef(insets.bottom);

  // Animated nodes are created once (lazy state, not read-during-render refs).
  const [anim] = useState(() => {
    const keyboardHeight = new Animated.Value(0);
    const navBarOffset = new Animated.Value(insets.bottom);
    const inputBarHeight = new Animated.Value(72);
    const inputBarBottom = Animated.add(keyboardHeight, navBarOffset);
    return {
      keyboardHeight,
      navBarOffset,
      inputBarHeight,
      inputBarBottom,
      contentPaddingBottom: Animated.add(inputBarHeight, inputBarBottom),
    };
  });
  const { keyboardHeight, navBarOffset, inputBarHeight, inputBarBottom, contentPaddingBottom } = anim;

  // The bottom inset can change after mount (rotation, nav-bar mode switch,
  // edge-to-edge insets arriving late); follow it while the keyboard is hidden.
  useEffect(() => {
    bottomInsetRef.current = insets.bottom;
    if (!keyboardVisibleRef.current) navBarOffset.setValue(insets.bottom);
  }, [insets.bottom, navBarOffset]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => {
      keyboardVisibleRef.current = true;
      setIsKeyboardVisible(true);
      const dur = Platform.OS === 'ios' ? e.duration : 150;
      const heightWithOffset = e.endCoordinates.height + KEYBOARD_EXTRA_OFFSET;
      Animated.parallel([
        Animated.timing(keyboardHeight, {
          toValue: heightWithOffset,
          duration: dur,
          useNativeDriver: false,
        }),
        Animated.timing(navBarOffset, {
          toValue: 0,
          duration: dur,
          useNativeDriver: false,
        }),
      ]).start();
    });

    const hide = Keyboard.addListener(hideEvent, (e) => {
      keyboardVisibleRef.current = false;
      setIsKeyboardVisible(false);
      const dur = Platform.OS === 'ios' ? (e?.duration ?? 250) : 150;
      Animated.parallel([
        Animated.timing(keyboardHeight, {
          toValue: 0,
          duration: dur,
          useNativeDriver: false,
        }),
        Animated.timing(navBarOffset, {
          toValue: bottomInsetRef.current,
          duration: dur,
          useNativeDriver: false,
        }),
      ]).start();
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, [keyboardHeight, navBarOffset]);

  const onInputBarLayout = useCallback((e: LayoutChangeEvent) => {
    inputBarHeight.setValue(e.nativeEvent.layout.height);
  }, [inputBarHeight]);

  return {
    isKeyboardVisible,
    /** Distance of the input bar from the screen bottom. */
    inputBarBottom,
    /**
     * Distance of the input bar's top edge from the screen bottom — use as
     * `bottom` for anything floating just above the bar. Also the bottom
     * padding content needs to clear the bar.
     */
    contentPaddingBottom,
    onInputBarLayout,
  };
}
