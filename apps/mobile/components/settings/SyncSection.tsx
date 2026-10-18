import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { AlertCircle, Check, ChevronRight, Cloud, CloudOff, Lock, LogOut, RefreshCw, ShieldCheck, X } from 'lucide-react-native';
import { spacing, borderRadius, typography } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { ApiError } from '@/services/sync/api';
import { newRecoveryKey } from '@/services/sync/crypto';
import {
  createSync, deleteAccount, deleteCloudCopy, disableSync, getCloudStatus, joinSync, JoinError, refreshAccount, signOut, signOutEverywhere, startSignIn, syncNow,
  useSyncAccount, useSyncStatus, verifySignIn,
} from '@/services/sync';
import { settingsStyles } from './styles';

type CloudStatus = Awaited<ReturnType<typeof getCloudStatus>>;

/** "just now", "5 minutes ago", "yesterday"… for a past time. */
export function timeAgo(then: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

const formatBytes = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(0, Math.round(bytes / 1e3))} KB`);
const errorText = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);

/** Quo Sync: keep chats and memories on your other devices, end-to-end encrypted. */
export function SyncSection() {
  const { colors } = useTheme();
  const styles = useStyles();
  const sync = useSyncStatus();
  const [open, setOpen] = useState(false);

  const label = sync.phase === 'off' ? 'Off'
    : sync.phase === 'syncing' ? 'Syncing…'
      : sync.phase === 'error' ? (sync.error?.code === 'offline' ? 'Offline' : 'Needs attention')
        : sync.lastSyncAt ? `Up to date · ${timeAgo(sync.lastSyncAt)}` : 'Starting…';
  const Icon = sync.phase === 'error' ? CloudOff : sync.phase === 'off' ? Cloud : RefreshCw;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Sync</Text>
      <Text style={styles.sectionDescription}>Keep your chats and memories on your other devices. Only you hold the key, so Quo can’t read them.</Text>

      <TouchableOpacity style={styles.card} onPress={() => setOpen(true)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Quo Sync">
        <View style={styles.settingRow}>
          <View style={styles.settingIcon}>
            <Icon size={20} color={sync.phase === 'error' ? colors.error : sync.phase === 'off' ? colors.textTertiary : colors.primary} />
          </View>
          <View style={styles.settingContent}>
            <Text style={styles.settingLabel}>Quo Sync</Text>
            <Text style={styles.settingDescription}>{label}</Text>
          </View>
          <ChevronRight size={20} color={colors.textTertiary} />
        </View>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalContent, styles.sheet]}>
            <View style={styles.sheetHead}>
              <Text style={[styles.modalTitle, styles.noMargin]}>Quo Sync</Text>
              <TouchableOpacity onPress={() => setOpen(false)} accessibilityLabel="Close" hitSlop={12}>
                <X size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <SyncSheet />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function SyncSheet() {
  const styles = useStyles();
  const sync = useSyncStatus();
  const { account, signedIn } = useSyncAccount();
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // Asks the server where this account stands (a plan? sync already on?).
  const fetchCloud = useCallback(async (isCurrent: () => boolean = () => true) => {
    try {
      await refreshAccount();
      const status = await getCloudStatus();
      if (!isCurrent()) return;
      setCloud(status);
      setProblem(null);
    } catch (error) {
      if (isCurrent()) setProblem(errorText(error, 'Couldn’t reach Quo Sync. Check your connection and try again.'));
    }
  }, []);

  /** For buttons: the same, with a spinner. */
  const load = useCallback(async () => {
    setChecking(true);
    await fetchCloud();
    setChecking(false);
  }, [fetchCloud]);

  const off = sync.phase === 'off';
  useEffect(() => {
    if (!signedIn) return;
    let current = true;
    void fetchCloud(() => current);
    return () => {
      current = false;
    };
  }, [signedIn, off, fetchCloud]);

  if (sync.phase !== 'off') return <Connected cloud={cloud} onChanged={load} />;

  return (
    <View style={styles.stack}>
      <Text style={styles.lede}>Chats and memories follow you between your devices, end-to-end encrypted. Photos and files stay on the device they were added on, and models are never synced.</Text>
      {!signedIn
        ? <SignIn onDone={load} />
        : problem && !cloud
          ? <Notice message={problem} action="Try again" onAction={load} busy={checking} />
          : !cloud
            ? <ActivityIndicator />
            : !cloud.entitled
              ? <Notice message="Quo Sync is included with a Quo Pro or Quo Sync plan on your Quo account. Once your account has one, check again here." action="Check again" onAction={load} busy={checking} />
              : cloud.enabled
                ? <Join email={account?.email ?? ''} onDone={load} />
                : <TurnOn email={account?.email ?? ''} onDone={load} />}
      {signedIn && sync.phase === 'off' && <SignedInAs email={account?.email} />}
      {signedIn && sync.phase === 'off' && <SignOutEverywhere />}
      {signedIn && sync.phase === 'off' && <DeleteAccount />}
    </View>
  );
}

/** Ends the sign-in on every other device, for a lost phone. This phone stays signed in. */
function SignOutEverywhere() {
  const styles = useStyles();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await signOutEverywhere();
      setDone(true);
      setConfirm(false);
    } catch (err) {
      setError(errorText(err, 'Couldn’t do that. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Text style={styles.fine}>Signed out of your other devices. This phone stays signed in.</Text>;
  if (!confirm) {
    return (
      <TouchableOpacity style={styles.linkRow} onPress={() => setConfirm(true)} accessibilityRole="button">
        <Text style={styles.fine}>Sign out of all my other devices…</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={styles.box}>
      <Text style={styles.body}>Lost a phone, or left yourself signed in somewhere? This ends those sign-ins, so they can no longer reach your Quo account or sync. You stay signed in here. Chats already on those devices stay there.</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <Button label="Sign out my other devices" onPress={() => void run()} busy={busy} />
      <Button label="Cancel" onPress={() => setConfirm(false)} soft disabled={busy} />
    </View>
  );
}

/** Deleting the account, in two steps. The server says so if a plan is still running. */
function DeleteAccount() {
  const styles = useStyles();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
    } catch (err) {
      setError(errorText(err, 'Couldn’t delete your account. Try again.'));
      setBusy(false); // the box stays open, because that's where the reason is shown
    }
  }

  if (!confirm) {
    return (
      <TouchableOpacity style={styles.linkRow} onPress={() => setConfirm(true)} accessibilityRole="button">
        <Text style={styles.fine}>Delete my Quo account…</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={styles.box}>
      <Text style={styles.body}>This deletes your account for good: your synced chats and memories in the cloud, your credits and your plan records. Chats and memories on this phone stay. If you have a plan, cancel it first.</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <Button label="Yes, delete my account" onPress={() => void remove()} busy={busy} danger />
      <Button label="Cancel" onPress={() => setConfirm(false)} soft disabled={busy} />
    </View>
  );
}

function SignedInAs({ email }: { email?: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <TouchableOpacity style={styles.linkRow} onPress={() => void signOut()} accessibilityRole="button">
      <LogOut size={14} color={colors.textTertiary} />
      <Text style={styles.fine}>Signed in as {email ?? 'your account'} · Sign out</Text>
    </TouchableOpacity>
  );
}

function Notice({ message, action, onAction, busy }: { message: string; action: string; onAction: () => void; busy?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.box}>
      <View style={styles.boxRow}>
        <AlertCircle size={16} color={colors.textSecondary} style={styles.boxIcon} />
        <Text style={styles.body}>{message}</Text>
      </View>
      <Button label={action} onPress={onAction} busy={busy} soft />
    </View>
  );
}

function Button({ label, onPress, busy, soft, danger, disabled }: { label: string; onPress: () => void; busy?: boolean; soft?: boolean; danger?: boolean; disabled?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[styles.button, soft && styles.buttonSoft, danger && styles.buttonDanger, (disabled || busy) && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      activeOpacity={0.8}
    >
      {busy ? <ActivityIndicator size="small" color={soft ? colors.textPrimary : colors.onPrimary} /> : <Text style={[styles.buttonText, soft && styles.buttonTextSoft, danger && styles.buttonTextDanger]}>{label}</Text>}
    </TouchableOpacity>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const result = await startSignIn(email.trim());
      setDevCode(result.devCode ?? null);
      setStep('code');
    } catch (err) {
      setError(errorText(err, 'Couldn’t send the code. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    if (value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await verifySignIn(email.trim(), value);
      onDone();
    } catch (err) {
      setError(errorText(err, 'Couldn’t sign in. Try again.'));
      setCode('');
      setBusy(false);
    }
  }

  return (
    <View style={styles.box}>
      {step === 'email' ? (
        <>
          <Text style={styles.body}>Quo Sync needs a Quo account, so it knows which chats are yours. Sign in with just your email, no password.</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.textTertiary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            accessibilityLabel="Email"
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Button label="Email me a code" onPress={() => void sendCode()} busy={busy} disabled={!email.includes('@')} />
        </>
      ) : (
        <>
          <Text style={styles.body}>Enter the 6-digit code we sent to {email.trim()}.</Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={code}
            onChangeText={value => {
              const digits = value.replace(/\D/g, '').slice(0, 6);
              setCode(digits);
              if (digits.length === 6) void verify(digits);
            }}
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            autoFocus
            placeholder="000000"
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Sign-in code"
          />
          {devCode && <Text style={styles.fine}>Sandbox: no email is sent. Your code is {devCode}.</Text>}
          {error && <Text style={styles.error}>{error}</Text>}
          <Button label="Sign in" onPress={() => void verify(code)} busy={busy} disabled={code.length !== 6} />
          <TouchableOpacity onPress={() => { setStep('email'); setCode(''); setError(null); }} style={styles.linkRow}>
            <Text style={styles.link}>Use a different email</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

function TurnOn({ email, onDone }: { email: string; onDone: () => void }) {
  const styles = useStyles();
  const [creating, setCreating] = useState(false);
  if (!creating) {
    return (
      <View style={styles.box}>
        <Text style={styles.body}>You’ll get a <Text style={styles.strong}>recovery key</Text>: the only thing that can unlock your synced chats on a new device. Quo can’t reset it for you.</Text>
        <Button label="Turn on Quo Sync" onPress={() => setCreating(true)} />
      </View>
    );
  }
  return <Create email={email} onBack={() => setCreating(false)} onDone={onDone} />;
}

function Create({ email, onBack, onDone }: { email: string; onBack: () => void; onDone: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [recovery] = useState(newRecoveryKey);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    await Clipboard.setStringAsync(recovery.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await createSync(recovery.secret, email);
      onDone();
    } catch (err) {
      setError(errorText(err, 'Couldn’t turn on Quo Sync. Try again.'));
      setBusy(false);
    }
  }

  return (
    <View style={styles.box}>
      <Text style={styles.body}><Text style={styles.strong}>Save your recovery key.</Text> You’ll need it to add another device. It’s shown only now, and if it’s lost, so are your synced chats (the chats on your devices stay).</Text>
      <Text selectable style={styles.keyBox} accessibilityLabel="Recovery key">{recovery.text}</Text>
      <Button label={copied ? 'Copied' : 'Copy the key'} onPress={() => void copy()} soft />
      <TouchableOpacity style={styles.checkRow} onPress={() => setSaved(value => !value)} accessibilityRole="checkbox" accessibilityState={{ checked: saved }}>
        <View style={[styles.checkBox, saved && styles.checkBoxOn]}>{saved && <Check size={14} color={colors.onPrimary} />}</View>
        <Text style={[styles.body, styles.checkText]}>I’ve saved my recovery key somewhere safe, and I understand Quo can’t recover it.</Text>
      </TouchableOpacity>
      {error && <Text style={styles.error}>{error}</Text>}
      <Button label={busy ? 'Turning on…' : 'Turn on Quo Sync'} onPress={() => void start()} disabled={!saved} busy={busy} />
      <TouchableOpacity onPress={onBack} style={styles.linkRow} disabled={busy}><Text style={styles.link}>Back</Text></TouchableOpacity>
    </View>
  );
}

function Join({ email, onDone }: { email: string; onDone: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await joinSync(text, email);
      onDone();
    } catch (err) {
      setError(
        err instanceof JoinError
          ? err.code === 'bad_format' ? 'That recovery key doesn’t look right. Check it for typos: it’s 8 groups of 4 letters and numbers, then 2 more.'
            : err.code === 'wrong_key' ? 'That recovery key doesn’t match this account’s Quo Sync.'
              : 'Quo Sync isn’t turned on for this account yet.'
          : errorText(err, 'Couldn’t join Quo Sync. Try again.'),
      );
      setBusy(false);
    }
  }

  async function startOver() {
    setBusy(true);
    try {
      await deleteCloudCopy();
      onDone();
    } catch (err) {
      setError(errorText(err, 'Couldn’t delete it. Try again.'));
    } finally {
      setBusy(false);
      setConfirmReset(false);
    }
  }

  return (
    <View style={styles.box}>
      <Text style={styles.body}>Quo Sync is already on for <Text style={styles.strong}>{email}</Text>. Enter your recovery key to bring those chats here.</Text>
      <TextInput
        style={[styles.input, styles.keyInput]}
        value={text}
        onChangeText={setText}
        placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX"
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        accessibilityLabel="Recovery key"
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button label={busy ? 'Checking…' : 'Join Quo Sync'} onPress={() => void join()} busy={busy} disabled={!text.trim()} />
      <View style={styles.linkRow}>
        <Text style={styles.fine}>Lost your key? Nobody can recover it, but you can </Text>
        <TouchableOpacity onPress={() => (confirmReset ? void startOver() : setConfirmReset(true))} disabled={busy}>
          <Text style={[styles.link, confirmReset && styles.dangerText]}>{confirmReset ? 'tap again to delete the cloud copy for good' : 'delete the cloud copy and start again'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Connected({ cloud, onChanged }: { cloud: CloudStatus | null; onChanged: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const sync = useSyncStatus();
  const { signedIn } = useSyncAccount();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const label = sync.phase === 'syncing' ? 'Syncing…'
    : sync.phase === 'error' ? (sync.error?.code === 'offline' ? 'Offline' : 'Needs attention')
      : sync.lastSyncAt ? `Up to date · ${timeAgo(sync.lastSyncAt)}` : 'Starting…';

  async function deleteAll() {
    setBusy(true);
    try {
      await deleteCloudCopy();
      onChanged();
    } catch {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <View style={styles.stack}>
      <View style={styles.box}>
        <View style={styles.boxRow}>
          {sync.phase === 'syncing' ? <ActivityIndicator size="small" /> : sync.phase === 'error' ? <CloudOff size={18} color={colors.error} /> : <ShieldCheck size={18} color={colors.primary} />}
          <View style={styles.statusText}>
            <Text style={styles.strong}>{label}</Text>
            <Text style={styles.fine}>{sync.email}</Text>
          </View>
        </View>
        {sync.error && sync.error.code !== 'offline' && <Text style={styles.error}>{sync.error.message}</Text>}
        {sync.error?.code === 'offline' && <Text style={styles.fine}>{sync.error.message}</Text>}
        {sync.tooLarge > 0 && <Text style={styles.fine}>{sync.tooLarge} {sync.tooLarge === 1 ? 'chat is' : 'chats are'} too big to sync and stay on this phone.</Text>}
        {sync.skipped > 0 && <Text style={styles.fine}>{sync.skipped} synced {sync.skipped === 1 ? 'item' : 'items'} couldn’t be read, so {sync.skipped === 1 ? 'it was' : 'they were'} skipped.</Text>}
        <Button label="Sync now" onPress={() => void syncNow({ manual: true })} busy={sync.phase === 'syncing'} soft />
      </View>

      {sync.error?.code === 'sign_in_required' && !signedIn && <SignIn onDone={onChanged} />}

      {cloud && (
        <View style={styles.box}>
          <Text style={styles.strong}>Cloud storage</Text>
          <View style={styles.meter}><View style={[styles.meterFill, { width: `${Math.max(1, Math.min(100, (cloud.usedBytes / cloud.limitBytes) * 100))}%` }]} /></View>
          <Text style={styles.fine}>{formatBytes(cloud.usedBytes)} of {formatBytes(cloud.limitBytes)} · {cloud.records} {cloud.records === 1 ? 'item' : 'items'}</Text>
        </View>
      )}

      <View style={styles.box}>
        <Text style={styles.body}>Stop syncing on this phone. Your chats and memories stay here and in the cloud, and you can join again with your recovery key.</Text>
        <Button label="Turn off on this phone" onPress={() => void disableSync().then(onChanged)} soft />
      </View>

      <View style={styles.box}>
        <Text style={styles.body}>Remove the encrypted copy from Quo’s servers for good, for all your devices. Chats and memories on your devices aren’t deleted.</Text>
        {confirm
          ? (
            <>
              <Button label="Yes, delete the cloud copy" onPress={() => void deleteAll()} busy={busy} danger />
              <Button label="Cancel" onPress={() => setConfirm(false)} soft disabled={busy} />
            </>
          )
          : <Button label="Delete the cloud copy…" onPress={() => setConfirm(true)} soft />}
      </View>

      {signedIn && <SignOutEverywhere />}
      {signedIn && <DeleteAccount />}

      <View style={styles.privacyRow}>
        <Lock size={14} color={colors.textTertiary} />
        <Text style={styles.fine}>Encrypted on this phone with a key only you hold.</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((theme) => {
  const { colors } = theme;
  return {
    ...settingsStyles(theme),
    sheet: { maxHeight: '88%' },
    sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
    noMargin: { marginBottom: 0 },
    stack: { gap: spacing.md },
    lede: { fontSize: typography.sizes.sm, color: colors.textSecondary, lineHeight: 20 },
    box: { backgroundColor: colors.glassMedium, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.glassBorder, padding: spacing.lg, gap: spacing.md },
    boxRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    boxIcon: { marginTop: 2 },
    statusText: { flex: 1 },
    body: { fontSize: typography.sizes.sm, color: colors.textSecondary, lineHeight: 20, flexShrink: 1 },
    strong: { fontWeight: typography.weights.semibold, color: colors.textPrimary },
    fine: { fontSize: typography.sizes.xs, color: colors.textTertiary, lineHeight: 18, flexShrink: 1 },
    error: { fontSize: typography.sizes.sm, color: colors.error, lineHeight: 20 },
    dangerText: { color: colors.error },
    link: { fontSize: typography.sizes.xs, color: colors.primary, fontWeight: typography.weights.semibold },
    linkRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
    privacyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, justifyContent: 'center', marginTop: spacing.xs },
    input: {
      backgroundColor: colors.surface, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.glassBorder,
      padding: spacing.md, fontSize: typography.sizes.md, color: colors.textPrimary,
    },
    codeInput: { textAlign: 'center', fontSize: 26, letterSpacing: 8, fontVariant: ['tabular-nums'] },
    keyInput: { fontSize: typography.sizes.sm, letterSpacing: 0.5 },
    keyBox: {
      backgroundColor: colors.surface, borderRadius: borderRadius.lg, padding: spacing.md, fontSize: typography.sizes.md,
      fontWeight: typography.weights.semibold, color: colors.textPrimary, letterSpacing: 1, lineHeight: 26, textAlign: 'center',
    },
    button: { backgroundColor: colors.primaryFill, borderRadius: borderRadius.lg, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
    buttonSoft: { backgroundColor: colors.glassStrong },
    buttonDanger: { backgroundColor: colors.error },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { fontSize: typography.sizes.md, fontWeight: typography.weights.semibold, color: colors.onPrimary },
    buttonTextSoft: { color: colors.textPrimary },
    buttonTextDanger: { color: colors.onPrimary },
    checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    checkBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.textTertiary, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    checkBoxOn: { backgroundColor: colors.primaryFill, borderColor: colors.primaryFill },
    checkText: { flex: 1 },
    meter: { height: 6, borderRadius: 3, backgroundColor: colors.glassStrong, overflow: 'hidden' },
    meterFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  };
});
