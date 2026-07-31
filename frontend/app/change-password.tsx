import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

export default function ChangePassword() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const submit = async () => {
    setMsg(null);
    setOk(false);
    if (next.length < 6) return setMsg('La nuova password deve essere di almeno 6 caratteri');
    if (next !== confirm) return setMsg('Le due nuove password non coincidono');
    if (next === current) return setMsg('La nuova password deve essere diversa da quella attuale');
    setBusy(true);
    try {
      await api('/users/me/password', {
        method: 'POST',
        body: { current_password: current, new_password: next },
      });
      setOk(true);
      setMsg('Password aggiornata con successo');
      setCurrent(''); setNext(''); setConfirm('');
      setTimeout(() => router.back(), 1200);
    } catch (e: any) {
      setMsg(e.message || 'Errore aggiornamento');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="change-pass-back">
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>Cambia password</Text>
          <View style={{ width: 26 }} />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <View style={styles.field}>
              <Ionicons name="lock-closed-outline" size={18} color={theme.colors.muted} />
              <TextInput
                testID="current-password"
                placeholder="Password attuale"
                placeholderTextColor={theme.colors.muted}
                value={current}
                onChangeText={setCurrent}
                secureTextEntry
                autoCapitalize="none"
                style={styles.input}
              />
            </View>
            <View style={styles.field}>
              <Ionicons name="lock-open-outline" size={18} color={theme.colors.muted} />
              <TextInput
                testID="new-password"
                placeholder="Nuova password (min 6)"
                placeholderTextColor={theme.colors.muted}
                value={next}
                onChangeText={setNext}
                secureTextEntry
                autoCapitalize="none"
                style={styles.input}
              />
            </View>
            <View style={styles.field}>
              <Ionicons name="checkmark-circle-outline" size={18} color={theme.colors.muted} />
              <TextInput
                testID="confirm-password"
                placeholder="Conferma nuova password"
                placeholderTextColor={theme.colors.muted}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoCapitalize="none"
                style={styles.input}
              />
            </View>

            {msg && (
              <Text
                testID="change-pass-msg"
                style={[styles.msg, ok ? { color: theme.colors.brand } : { color: theme.colors.error }]}
              >
                {msg}
              </Text>
            )}

            <Pressable
              testID="change-pass-submit"
              onPress={submit}
              disabled={busy}
              style={[styles.cta, busy && { opacity: 0.5 }]}
            >
              {busy ? (
                <ActivityIndicator color={theme.colors.onBrand} />
              ) : (
                <Text style={styles.ctaText}>Aggiorna password</Text>
              )}
            </Pressable>
          </View>

          <Text style={styles.hint}>
            Se hai dimenticato la password attuale, contatta l&apos;amministratore della lega o dell&apos;app per richiedere il reset.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing.lg,
  },
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  scroll: { padding: theme.spacing.lg },
  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.md,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceTertiary,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  input: {
    flex: 1,
    color: theme.colors.onSurface,
    paddingVertical: 14,
    fontSize: 15,
  },
  msg: { fontSize: 13, textAlign: 'center' },
  cta: {
    height: 52,
    backgroundColor: theme.colors.brand,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing.sm,
  },
  ctaText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 16 },
  hint: {
    color: theme.colors.muted,
    fontSize: 12,
    marginTop: theme.spacing.lg,
    textAlign: 'center',
    paddingHorizontal: theme.spacing.lg,
  },
});
