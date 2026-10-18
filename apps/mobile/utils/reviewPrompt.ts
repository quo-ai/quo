import AsyncStorage from '@react-native-async-storage/async-storage';

const REVIEW_PROMPT_KEY = '@review_prompt_shown';
const MESSAGE_COUNT_KEY = '@message_count';
const MESSAGE_THRESHOLD = 5; // Show after 5 completed assistant answers

/**
 * Check if the review prompt has already been shown
 */
export async function hasShownReviewPrompt(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(REVIEW_PROMPT_KEY);
    return value === 'true';
  } catch (error) {
    console.error('Error checking review prompt status:', error);
    return false;
  }
}

/**
 * Mark the review prompt as shown (permanently)
 */
export async function markReviewPromptShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(REVIEW_PROMPT_KEY, 'true');
  } catch (error) {
    console.error('Error marking review prompt as shown:', error);
  }
}

/**
 * Get the current completed answer count
 */
export async function getMessageCount(): Promise<number> {
  try {
    const value = await AsyncStorage.getItem(MESSAGE_COUNT_KEY);
    return value ? parseInt(value, 10) : 0;
  } catch (error) {
    console.error('Error getting message count:', error);
    return 0;
  }
}

/**
 * Increment the completed answer count
 */
export async function incrementMessageCount(): Promise<number> {
  try {
    const currentCount = await getMessageCount();
    const newCount = currentCount + 1;
    await AsyncStorage.setItem(MESSAGE_COUNT_KEY, newCount.toString());
    return newCount;
  } catch (error) {
    console.error('Error incrementing message count:', error);
    return 0;
  }
}

/**
 * Check if we should show the review prompt
 * Returns true if:
 * - User has received at least MESSAGE_THRESHOLD completed answers
 * - Review prompt has never been shown before
 */
export async function shouldShowReviewPrompt(): Promise<boolean> {
  try {
    const hasShown = await hasShownReviewPrompt();
    if (hasShown) {
      return false;
    }

    const messageCount = await getMessageCount();
    return messageCount >= MESSAGE_THRESHOLD;
  } catch (error) {
    console.error('Error checking if should show review prompt:', error);
    return false;
  }
}

