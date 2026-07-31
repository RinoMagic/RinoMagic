import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator,
  ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session, User } from '@/src/api';
import { theme } from '@/src/theme';

type RoomPreview = {
  id: string; name: string; matchday: number; color: string;
  invite_code: string; max_events: number; status: string;
};

export default function InvitePage() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const [room, setRoom] = useState<RoomPreview | null>(null);
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (!code) throw new Error('Codice invito mancante nel link');
        const inv = String(code).toUpperCase();
        const r = await api<RoomPreview>(`/rooms/by-code/${inv}`, { auth: false });
        setRoom(r);
        const s = await session.load();
        setMe(s.user);
      } catch (e: any) {
        setMsg(e.message);
      } finally { setLoading(false); }
    })();
  }, [code]);

  const joinAsCurrentUser = async () => {
    if (!room) return;
    setBusy(true); setMsg(null);
    try {
      await api('/rooms/join', { method: 'POST', body: { invite_code: room.invite_code } });
      router.replace(`/room/${room.id}`);
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (!room) return;
    setBusy(true); setMsg(null);
    try {
      const authRes = await api<{ token: string; user: User }>(
        mode === 'login' ? '/auth/player/login' : '/auth/player/register',
        { method: 'POST', body: { username: username.trim(), password }, auth: false },
      );
      await session.save(authRes.token, authRes.user);
      // Immediately join the invited room
      await api('/rooms/join', { method: 'POST', body: { invite_code: room.invite_code } });
      router.replace(`/room/${room.id}`);
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>;
  }
  if (!room) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle" size={40} color={theme.colors.error} />
        <Text style={styles.err}>{msg || 'Codice invito non valido'}</Text>
        <Pressable style={styles.cta} onPress={() => router.replace('/')}>
          <Text style={styles.ctaText}>Torna alla home</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.wrap} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={[styles.hero, { backgroundColor: room.color + '22', borderColor: room.color }]}>
            <View style={styles.badge}>
              <Ionicons name="mail-open" size={22} color={theme.colors.brand} />
            </View>
            <Text style={styles.title}>Sei stato invitato!</Text>
            <Text style={styles.roomName}>{room.name}</Text>
            <Text style={styles.sub}>Giornata {room.matchday} · Max {room.max_events} pronostici</Text>
            <View style={styles.codeBox}>
              <Text style={styles.codeLabel}>CODICE INVITO</Text>
              <Text style={[styles.code, { color: room.color }]}>{room.invite_code}</Text>
            </View>
          </View>

          {me ? <View style={styles.card}>
            <Text style={styles.cardTitle}>Ciao {me.username || me.email}!</Text>
            <Text style={styles.help}>Conferma l&apos;ingresso nella stanza.</Text>
            {msg && <Text style={styles.err}>{msg}</Text>}
            <Pressable style={[styles.cta, busy && { opacity: 0.5 }]} onPress={joinAsCurrentUser} disabled={busy}>
              {busy ? <ActivityIndicator color={theme.colors.onBrand} /> : <Text style={styles.ctaText}>Entra nella stanza</Text>}
            </Pressable>
          </View> : <View style={styles.card}>
            <View style={styles.segments}>
              <Pressable onPress={() => { setMode('register'); setMsg(null); }} style={[styles.segment, mode === 'register' && styles.segmentActive]}>
                <Text style={[styles.segmentText, mode === 'register' && styles.segmentTextActive]}>Registrati</Text>
              </Pressable>
              <Pressable onPress={() => { setMode('login'); setMsg(null); }} style={[styles.segment, mode === 'login' && styles.segmentActive]}>
                <Text style={[styles.segmentText, mode === 'login' && styles.segmentTextActive]}>Ho già un account</Text>
              </Pressable>
            </View>
            <TextInput placeholder="Nickname (2-20 caratteri)" placeholderTextColor={theme.colors.muted}
              value={username} onChangeText={setUsername} autoCapitalize="none" style={styles.input} testID="invite-username" />
            <TextInput placeholder="Password" placeholderTextColor={theme.colors.muted}
              value={password} onChangeText={setPassword} secureTextEntry style={styles.input} testID="invite-password" />
            {msg && <Text style={styles.err}>{msg}</Text>}
            <Pressable style={[styles.cta, busy && { opacity: 0.5 }]} onPress={submit} disabled={busy} testID="invite-submit">
              {busy ? <ActivityIndicator color={theme.colors.onBrand} /> : <Text style={styles.ctaText}>{mode === 'register' ? 'Registrati ed entra' : 'Accedi ed entra'}</Text>}
            </Pressable>
          </View>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface, gap: theme.spacing.md, padding: theme.spacing.lg },
  scroll: { padding: theme.spacing.lg, gap: theme.spacing.lg },
  hero: { alignItems: 'center', padding: theme.spacing.xl, borderRadius: theme.radius.lg, borderWidth: 1, gap: 6 },
  badge: { width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.brand + '22', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  title: { color: theme.colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  roomName: { color: theme.colors.onSurface, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  sub: { color: theme.colors.muted, fontSize: 12 },
  codeBox: { marginTop: theme.spacing.md, alignItems: 'center' },
  codeLabel: { color: theme.colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  code: { fontSize: 32, fontWeight: '800', letterSpacing: 6, marginTop: 4 },
  card: { padding: theme.spacing.lg, backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, gap: theme.spacing.md },
  cardTitle: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 16 },
  help: { color: theme.colors.muted, fontSize: 13 },
  segments: { flexDirection: 'row', backgroundColor: theme.colors.surfaceTertiary, padding: 4, borderRadius: theme.radius.md },
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: theme.radius.sm },
  segmentActive: { backgroundColor: theme.colors.brand },
  segmentText: { color: theme.colors.onSurfaceSecondary, fontWeight: '700', fontSize: 12 },
  segmentTextActive: { color: theme.colors.onBrand, fontWeight: '800' },
  input: { color: theme.colors.onSurface, backgroundColor: theme.colors.surfaceTertiary, padding: theme.spacing.md, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, fontSize: 15 },
  err: { color: theme.colors.error, fontSize: 13, textAlign: 'center' },
  cta: { height: 52, backgroundColor: theme.colors.brand, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 16 },
});
