import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { startSignIn, verifySignIn } from '@/services/sync';
import { errorText } from './format';
import { Button } from './parts';
import { useStyles } from './styles';

export function SignIn({ onDone }: { onDone: () => void }) {
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
