import * as Notifications from 'expo-notifications';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEYS = {
  PERMISSION_ASKED: '@notif_permission_asked',
  LAST_GENERATION_NOTIF: '@notif_last_gen_ts',
  LAST_ACTIVE_TS: '@notif_last_active_ts',
  REENGAGEMENT_SCHEDULED: '@notif_reengagement_scheduled',
};

// How long between generation complete notifications (ms) — max once per 5 minutes
const GEN_NOTIF_COOLDOWN_MS = 5 * 60 * 1000;

// Re-engage after this many ms of inactivity
const REENGAGEMENT_DELAY_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

// recordActivity fires on every sent message. Re-scheduling the 3-day nudge
// more often than this buys nothing (it shifts the fire time by < 0.1%), so
// skip the cancel+schedule round-trip inside this window.
const REENGAGEMENT_RESCHEDULE_MIN_INTERVAL_MS = 5 * 60 * 1000;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * NotificationService handles all local notifications.
 *
 * Design principles:
 * - Permission is never requested cold on launch — only after the user has
 *   sent their first message and experienced value.
 * - A soft pre-prompt (Alert) explains the benefit before the OS dialog.
 * - Generation notifications are rate-limited so power users aren't spammed.
 * - One re-engagement nudge fires after 3 days of inactivity, never again.
 */
// Fixed notification ID for the ongoing generation indicator
const ONGOING_GENERATION_NOTIF_ID = 'ongoing_generation';

class NotificationService {
  private static instance: NotificationService;
  private hasPermission = false;
  private permissionChecked = false;
  private ongoingGenerationShown = false;
  // In-memory cache of the scheduled re-engagement id (undefined = not yet
  // loaded from storage, null = none scheduled) and when it was last
  // (re)scheduled, so recordActivity doesn't hit storage/native every message.
  private reengagementId: string | null | undefined = undefined;
  private lastReengagementScheduleTs = 0;

  private constructor() {}

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Called on app launch — only checks existing permission status,
   * never triggers the OS dialog.
   */
  async initialize(): Promise<void> {
    if (Platform.OS === 'web') return;

    try {
      const { status } = await Notifications.getPermissionsAsync();
      this.hasPermission = status === 'granted';
      this.permissionChecked = true;

      if (Platform.OS === 'android') {
        await this._ensureChannels();
      }
    } catch (error) {
      console.error('[Notifications] initialize error:', error);
    }
  }

  /**
   * Called after the user has sent their first message.
   * Shows a soft pre-prompt first, then the OS dialog if they agree.
   */
  async requestPermissionAfterFirstMessage(): Promise<void> {
    if (Platform.OS === 'web') return;

    try {
      // Don't ask twice
      const alreadyAsked = await AsyncStorage.getItem(STORAGE_KEYS.PERMISSION_ASKED);
      if (alreadyAsked) return;

      // If already granted (e.g. reinstall), just mark and move on
      if (this.hasPermission) {
        await AsyncStorage.setItem(STORAGE_KEYS.PERMISSION_ASKED, 'true');
        return;
      }

      await AsyncStorage.setItem(STORAGE_KEYS.PERMISSION_ASKED, 'true');

      // Soft pre-prompt — explain the benefit before the OS dialog
      Alert.alert(
        'Stay in the loop',
        "Get notified when your AI finishes a long response so you don't have to keep the app open.",
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Enable',
            onPress: async () => {
              const { status } = await Notifications.requestPermissionsAsync({
                ios: { allowAlert: true, allowSound: true, allowBadge: false },
              });
              this.hasPermission = status === 'granted';
              if (this.hasPermission && Platform.OS === 'android') {
                await this._ensureChannels();
              }
            },
          },
        ]
      );
    } catch (error) {
      console.error('[Notifications] requestPermission error:', error);
    }
  }

  /**
   * Shows a persistent "Generating…" notification when the app goes to
   * background while the model is still producing a response.
   * This keeps Android from aggressively killing the process.
   *
   * Android-only: iOS suspends the app regardless of any notification, so a
   * sticky "generating" banner can't keep work alive there — it would just be
   * a pointless banner. On iOS this is a no-op.
   */
  async showOngoingGenerationNotification(): Promise<void> {
    if (Platform.OS !== 'android') return;
    if (!this.hasPermission || this.ongoingGenerationShown) return;

    try {
      this.ongoingGenerationShown = true;
      await Notifications.scheduleNotificationAsync({
        identifier: ONGOING_GENERATION_NOTIF_ID,
        content: {
          title: 'Generating response…',
          body: 'Your AI is working. You can return to the app when ready.',
          sound: false,
          sticky: true,
          data: { type: 'generation_ongoing' },
        },
        // Android channel is selected via the trigger (content has no channelId).
        trigger: { channelId: 'generation' },
      });
    } catch (error) {
      console.error('[Notifications] showOngoingGeneration error:', error);
      this.ongoingGenerationShown = false;
    }
  }

  /**
   * Dismisses the ongoing generation notification.
   * Called when generation finishes or the user returns to the app.
   */
  async dismissOngoingGenerationNotification(): Promise<void> {
    // Android-only bookkeeping — the ongoing notification is never shown on iOS.
    if (Platform.OS !== 'android') return;
    if (!this.ongoingGenerationShown) return;

    try {
      this.ongoingGenerationShown = false;
      await Notifications.dismissNotificationAsync(ONGOING_GENERATION_NOTIF_ID);
    } catch {
      // Non-critical — notification may already be gone
    }
  }

  /**
   * Sends a "response ready" notification when the app is backgrounded.
   * Rate-limited to once every 5 minutes so users aren't spammed.
   * Automatically dismisses any ongoing generation notification first.
   */
  async sendGenerationCompleteNotification(preview?: string): Promise<void> {
    // Always dismiss the ongoing indicator first
    await this.dismissOngoingGenerationNotification();

    if (!this.hasPermission) return;

    try {
      // Rate limiting
      const lastTs = await AsyncStorage.getItem(STORAGE_KEYS.LAST_GENERATION_NOTIF);
      if (lastTs) {
        const elapsed = Date.now() - parseInt(lastTs, 10);
        if (elapsed < GEN_NOTIF_COOLDOWN_MS) return;
      }
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_GENERATION_NOTIF, Date.now().toString());

      const body = this._buildGenerationBody(preview);

      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Your response is ready',
          body,
          sound: true,
          data: { type: 'generation_complete' },
        },
        // Immediate delivery on the 'responses' channel (Android); on iOS a
        // channel-only trigger is treated as immediate (null).
        trigger: { channelId: 'responses' },
      });
    } catch (error) {
      console.error('[Notifications] sendGenerationComplete error:', error);
    }
  }

  /**
   * Records that the user was active. Call this on any meaningful action
   * (e.g. sending a message). Used to schedule re-engagement.
   */
  async recordActivity(): Promise<void> {
    try {
      const now = Date.now();
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_ACTIVE_TS, now.toString());

      // Debounce: a nudge was (re)scheduled moments ago — leave it be.
      if (
        this.reengagementId &&
        now - this.lastReengagementScheduleTs < REENGAGEMENT_RESCHEDULE_MIN_INTERVAL_MS
      ) {
        return;
      }

      // Cancel any pending re-engagement since the user is back
      await this._cancelReengagementNotification();
      // Schedule a new one for 3 days from now
      await this._scheduleReengagementNotification();
    } catch (error) {
      console.error('[Notifications] recordActivity error:', error);
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private _buildGenerationBody(preview?: string): string {
    if (!preview || preview.trim().length === 0) {
      return 'Tap to read your response.';
    }

    // Trim to a clean sentence boundary where possible
    const trimmed = preview.trim().slice(0, 120);
    const lastPeriod = trimmed.lastIndexOf('.');
    const lastBang = trimmed.lastIndexOf('!');
    const lastQuestion = trimmed.lastIndexOf('?');
    const cutoff = Math.max(lastPeriod, lastBang, lastQuestion);

    if (cutoff > 40) {
      return trimmed.slice(0, cutoff + 1);
    }

    // Fall back to word boundary
    const lastSpace = trimmed.lastIndexOf(' ');
    return lastSpace > 40 ? trimmed.slice(0, lastSpace) + '…' : trimmed + '…';
  }

  private async _getReengagementId(): Promise<string | null> {
    if (this.reengagementId === undefined) {
      this.reengagementId = await AsyncStorage.getItem(STORAGE_KEYS.REENGAGEMENT_SCHEDULED);
    }
    return this.reengagementId;
  }

  private async _cancelReengagementNotification(): Promise<void> {
    try {
      const id = await this._getReengagementId();
      if (id) {
        await Notifications.cancelScheduledNotificationAsync(id);
        await AsyncStorage.removeItem(STORAGE_KEYS.REENGAGEMENT_SCHEDULED);
        this.reengagementId = null;
      }
    } catch {
      // Non-critical
    }
  }

  private async _scheduleReengagementNotification(): Promise<void> {
    if (!this.hasPermission) return;

    try {
      // Only schedule if one isn't already pending
      const existing = await this._getReengagementId();
      if (existing) return;

      const messages = [
        { title: 'Your AI is waiting', body: 'Pick up where you left off — it runs entirely offline.' },
        { title: 'Something on your mind?', body: 'Your private AI is ready whenever you are.' },
        { title: 'Still here, no cloud needed', body: 'Your AI is on your device, ready to help.' },
      ];
      const pick = messages[Math.floor(Math.random() * messages.length)];

      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: pick.title,
          body: pick.body,
          sound: false,
          data: { type: 'reengagement' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: Math.floor(REENGAGEMENT_DELAY_MS / 1000),
          repeats: false,
          channelId: 'reengagement',
        },
      });

      await AsyncStorage.setItem(STORAGE_KEYS.REENGAGEMENT_SCHEDULED, id);
      this.reengagementId = id;
      this.lastReengagementScheduleTs = Date.now();
    } catch (error) {
      console.error('[Notifications] scheduleReengagement error:', error);
    }
  }

  private async _ensureChannels(): Promise<void> {
    await Notifications.setNotificationChannelAsync('responses', {
      name: 'AI Responses',
      description: 'Notifies you when a response finishes while the app is in the background.',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 150],
      lightColor: '#00D9FF',
      // No `sound` key: a string here means a bundled custom sound file
      // (validated since SDK 57); omitting it selects the system default.
    });

    await Notifications.setNotificationChannelAsync('generation', {
      name: 'Generation In Progress',
      description: 'Shows while the AI is generating a response in the background.',
      importance: Notifications.AndroidImportance.LOW,
      vibrationPattern: undefined,
      sound: undefined,
      enableVibrate: false,
    });

    await Notifications.setNotificationChannelAsync('reengagement', {
      name: 'Tips & Reminders',
      description: 'Occasional nudges to come back to the app.',
      importance: Notifications.AndroidImportance.LOW,
      vibrationPattern: undefined,
      sound: undefined,
      enableVibrate: false,
    });
  }
}

export const notificationService = NotificationService.getInstance();
