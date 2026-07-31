import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session } from '@/src/api';
import { theme } from '@/src/theme';

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<'landing' | 'join'>('landing');
  const [inviteCode, setInviteCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const s = await session.load();
      if (s.token && s.roomId) {
        try {
          await api(`/rooms/${s.roomId}`);
          router.replace(`/room/${s.roomId}`);
          return;
        } catch {
          await session.clear();
        }
      }
      setChecking(false);
    })();
  }, [router]);

  const submitJoin = async () => {
    setErr(null);
    const code = inviteCode.trim().toUpperCase();
    const nick = nickname.trim();
    if (code.length < 4) return setErr('Codice invito non valido');
    if (nick.length < 2) return setErr('Nickname minimo 2 caratteri');
    setBusy(true);
    try {
      const res = await api<{ token: string; room: any }>(
        '/rooms/join',
        { method: 'POST', body: { invite_code: code, nickname: nick }, auth: false }
      );
      await session.save(res.token, res.room.id, nick);
      router.replace(`/room/${res.room.id}`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.brand} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.brand}>
              <View style={styles.logo}>
                <Ionicons name="beer" size={30} color={theme.colors.onBrand} />
              </View>
              <Text style={styles.brandTitle}>SchedinaBar</Text>
              <Text style={styles.brandSub}>
                Chi ha la quota piu bassa, paga da bere.
              </Text>
            </View>

            {mode === 'landing' && (
              <View style={styles.card}>
                <Text style={styles.h1}>Inizia</Text>
                <Text style={styles.p}>Crea una stanza o entra con codice invito</Text>

                <Pressable
                  testID="cta-create-room"
                  onPress={() => router.push('/create-room')}
                  style={[styles.cta, styles.ctaPrimary]}
                >
                  <Ionicons name="add-circle" size={20} color={theme.colors.onBrand} />
                  <Text style={styles.ctaTextPrimary}>Crea una stanza</Text>
                </Pressable>

                <Pressable
                  testID="cta-join-room"
                  onPress={() => setMode('join')}
                  style={[styles.cta, styles.ctaSecondary]}
                >
                  <Ionicons name="enter" size={20} color={theme.colors.brand} />
                  <Text style={styles.ctaTextSecondary}>Entra con codice</Text>
                </Pressable>
              </View>
            )}

            {mode === 'join' && (
              <View style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.h1}>Entra in stanza</Text>
                  <Pressable onPress={() => setMode('landing')} hitSlop={10}>
                    <Ionicons name="close" size={22} color={theme.colors.muted} />
                  </Pressable>
                </View>
                <View style={styles.field}>
                  <Ionicons name="key" size={18} color={theme.colors.muted} />
                  <TextInput
                    testID="invite-code-input"
                    placeholder="Codice invito"
                    placeholderTextColor={theme.colors.muted}
                    value={inviteCode}
                    onChangeText={(t) => setInviteCode(t.toUpperCase())}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    style={styles.input}
                  />
                </View>
                <View style={styles.field}>
                  <Ionicons name="person" size={18} color={theme.colors.muted} />
                  <TextInput
                    testID="nickname-input"
                    placeholder="Il tuo nickname"
                    placeholderTextColor={theme.colors.muted}
                    value={nickname}
                    onChangeText={setNickname}
                    autoCapitalize="words"
                    autoCorrect={false}
                    style={styles.input}
                  />
                </View>
                {err && <Text testID="join-error" style={styles.err}>{err}</Text>}
                <Pressable
                  testID="join-submit"
                  onPress={submitJoin}
                  disabled={busy}
                  style={[styles.cta, styles.ctaPrimary, busy && { opacity: 0.6 }]}
                >
                  {busy ? (
                    <ActivityIndicator color={theme.colors.onBrand} />
                  ) : (
                    <Text style={styles.ctaTextPrimary}>Entra</Text>
                  )}
                </Pressable>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  scroll: { padding: theme.spacing.lg, flexGrow: 1, justifyContent: 'center' },
  brand: { alignItems: 'center', marginBottom: theme.spacing.xxl, gap: theme.spacing.sm },
  logo: {
    width: 72,
    height: 72,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.brand,
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  brandTitle: { color: theme.colors.onSurface, fontSize: 32, fontWeight: '800' },
  brandSub: { color: theme.colors.muted, fontSize: 14, textAlign: 'center' },
  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.md,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  h1: { color: theme.colors.onSurface, fontSize: 22, fontWeight: '800' },
  p: { color: theme.colors.muted, marginBottom: theme.spacing.sm },
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
  input: { flex: 1, color: theme.colors.onSurface, paddingVertical: 14, fontSize: 15 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    height: 52,
    borderRadius: theme.radius.md,
  },
  ctaPrimary: { backgroundColor: theme.colors.brand },
  ctaSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.colors.brand,
  },
  ctaTextPrimary: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 16 },
  ctaTextSecondary: { color: theme.colors.brand, fontWeight: '800', fontSize: 16 },
  err: { color: theme.colors.error, fontSize: 13 },
});
