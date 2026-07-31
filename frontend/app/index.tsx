import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator,
  ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session, User } from '@/src/api';
import { theme } from '@/src/theme';

type Tab = 'player_login' | 'player_register' | 'admin_login' | 'forgot';

export default function Landing() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>('player_login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const s = await session.load();
      if (s.token && s.user) {
        goHome(s.user);
      } else {
        setChecking(false);
      }
    })();
  }, []);

  const goHome = (user: User) => {
    if (user.role === 'admin') router.replace('/admin');
    else router.replace('/player');
  };

  const submit = async () => {
    setBusy(true); setMsg(null); setOkMsg(null);
    try {
      if (tab === 'player_login') {
        const res = await api<{ token: string; user: User }>(
          '/auth/player/login',
          { method: 'POST', body: { username: username.trim(), password }, auth: false },
        );
        await session.save(res.token, res.user);
        goHome(res.user);
      } else if (tab === 'player_register') {
        const res = await api<{ token: string; user: User }>(
          '/auth/player/register',
          { method: 'POST', body: { username: username.trim(), password }, auth: false },
        );
        await session.save(res.token, res.user);
        goHome(res.user);
      } else if (tab === 'admin_login') {
        const res = await api<{ token: string; user: User }>(
          '/auth/admin/login',
          { method: 'POST', body: { email: email.trim(), password }, auth: false },
        );
        await session.save(res.token, res.user);
        goHome(res.user);
      } else if (tab === 'forgot') {
        const res = await api<{ message: string }>(
          '/auth/admin/forgot-password',
          { method: 'POST', body: { email: email.trim() }, auth: false },
        );
        setOkMsg(res.message);
      }
    } catch (e: any) {
      setMsg(e.message);
    } finally { setBusy(false); }
  };

  if (checking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.brand} />
      </View>
    );
  }

  const isAdmin = tab === 'admin_login' || tab === 'forgot';

  return (
    <SafeAreaView style={styles.wrap} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <View style={styles.logo}><Ionicons name="beer" size={38} color={theme.colors.brand} /></View>
            <Text style={styles.title}>SchedinaBar</Text>
            <Text style={styles.subtitle}>Chi ha la quota più bassa, paga da bere.</Text>
          </View>

          <View style={styles.segments}>
            <Pressable
              onPress={() => { setTab('player_login'); setMsg(null); setOkMsg(null); }}
              style={[styles.segment, !isAdmin && styles.segmentActive]}
              testID="tab-player"
            >
              <Text style={[styles.segmentText, !isAdmin && styles.segmentTextActive]}>Giocatore</Text>
            </Pressable>
            <Pressable
              onPress={() => { setTab('admin_login'); setMsg(null); setOkMsg(null); }}
              style={[styles.segment, isAdmin && styles.segmentActive]}
              testID="tab-admin"
            >
              <Text style={[styles.segmentText, isAdmin && styles.segmentTextActive]}>Admin</Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            {tab === 'player_login' && <>
              <Text style={styles.cardTitle}>Accedi come Giocatore</Text>
              <TextInput testID="player-username" placeholder="Nickname" placeholderTextColor={theme.colors.muted}
                value={username} onChangeText={setUsername} autoCapitalize="none" style={styles.input} />
              <TextInput testID="player-password" placeholder="Password" placeholderTextColor={theme.colors.muted}
                value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />
              <Pressable onPress={() => { setTab('player_register'); setMsg(null); }}>
                <Text style={styles.linkSmall}>Non hai un account? Registrati</Text>
              </Pressable>
            </>}
            {tab === 'player_register' && <>
              <Text style={styles.cardTitle}>Registrati come Giocatore</Text>
              <TextInput testID="register-username" placeholder="Nickname (2-20 caratteri)" placeholderTextColor={theme.colors.muted}
                value={username} onChangeText={setUsername} autoCapitalize="none" style={styles.input} />
              <TextInput testID="register-password" placeholder="Password (min 6)" placeholderTextColor={theme.colors.muted}
                value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />
              <Pressable onPress={() => { setTab('player_login'); setMsg(null); }}>
                <Text style={styles.linkSmall}>Hai già un account? Accedi</Text>
              </Pressable>
            </>}
            {tab === 'admin_login' && <>
              <Text style={styles.cardTitle}>Accesso Admin</Text>
              <TextInput testID="admin-email" placeholder="Email" placeholderTextColor={theme.colors.muted}
                value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} />
              <TextInput testID="admin-password" placeholder="Password" placeholderTextColor={theme.colors.muted}
                value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />
              <Pressable onPress={() => { setTab('forgot'); setMsg(null); }}>
                <Text style={styles.linkSmall}>Password dimenticata?</Text>
              </Pressable>
            </>}
            {tab === 'forgot' && <>
              <Text style={styles.cardTitle}>Recupero password</Text>
              <Text style={styles.help}>Inserisci l&apos;email dell&apos;account admin. Riceverai un link per reimpostare la password.</Text>
              <TextInput testID="forgot-email" placeholder="Email" placeholderTextColor={theme.colors.muted}
                value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} />
              <Pressable onPress={() => { setTab('admin_login'); setMsg(null); setOkMsg(null); }}>
                <Text style={styles.linkSmall}>← Torna al login admin</Text>
              </Pressable>
            </>}

            {msg && <Text style={styles.err}>{msg}</Text>}
            {okMsg && <Text style={styles.ok}>{okMsg}</Text>}

            <Pressable
              onPress={submit}
              disabled={busy}
              style={[styles.cta, busy && { opacity: 0.5 }]}
              testID="auth-submit"
            >
              {busy
                ? <ActivityIndicator color={theme.colors.onBrand} />
                : <Text style={styles.ctaText}>
                    {tab === 'player_login' ? 'Accedi'
                      : tab === 'player_register' ? 'Registrati'
                      : tab === 'admin_login' ? 'Accedi'
                      : 'Invia link di reset'}
                  </Text>}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  scroll: { padding: theme.spacing.lg, gap: theme.spacing.lg },
  hero: { alignItems: 'center', marginTop: theme.spacing.xl, gap: 4 },
  logo: {
    width: 72, height: 72, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.brand + '22', marginBottom: 8,
  },
  title: { color: theme.colors.onSurface, fontSize: 28, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, fontSize: 13 },
  segments: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surfaceSecondary,
    padding: 4, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  segment: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: theme.radius.sm },
  segmentActive: { backgroundColor: theme.colors.brand },
  segmentText: { color: theme.colors.onSurfaceSecondary, fontWeight: '700', fontSize: 13 },
  segmentTextActive: { color: theme.colors.onBrand, fontWeight: '800' },
  card: {
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    borderWidth: 1, borderColor: theme.colors.border,
    gap: theme.spacing.md,
  },
  cardTitle: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 16 },
  input: {
    color: theme.colors.onSurface,
    backgroundColor: theme.colors.surfaceTertiary,
    padding: theme.spacing.md, borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border,
    fontSize: 15,
  },
  help: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
  linkSmall: { color: theme.colors.brand, fontWeight: '700', fontSize: 13, textAlign: 'center' },
  err: { color: theme.colors.error, fontSize: 13, textAlign: 'center' },
  ok: { color: theme.colors.accent, fontSize: 13, textAlign: 'center' },
  cta: {
    height: 52, backgroundColor: theme.colors.brand, borderRadius: theme.radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 16 },
});
