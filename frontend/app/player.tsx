import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  ActivityIndicator, RefreshControl, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session, User } from '@/src/api';
import { theme } from '@/src/theme';

type Room = {
  id: string; name: string; matchday: number; max_events: number;
  color: string; invite_code: string; status: string; members_count: number;
};

export default function PlayerHome() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await session.load();
      setMe(s.user);
      const r = await api<Room[]>('/rooms');
      setRooms(r);
    } catch (e: any) {
      if (e.message?.includes('Non autenticato')) router.replace('/');
    } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const logout = async () => { await session.clear(); router.replace('/'); };

  const join = async () => {
    setBusy(true); setMsg(null);
    try {
      const room = await api<Room>('/rooms/join', {
        method: 'POST', body: { invite_code: code.trim().toUpperCase() },
      });
      setJoinOpen(false); setCode('');
      router.push(`/room/${room.id}`);
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>;

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <View>
            <Text style={styles.hi}>Ciao, {me?.username}</Text>
            <Text style={styles.mail}>Giocatore</Text>
          </View>
          <Pressable onPress={logout} hitSlop={12}><Ionicons name="log-out-outline" size={22} color={theme.colors.onSurface} /></Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.colors.brand} />}
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.sm, paddingBottom: 100 }}
      >
        <Pressable style={styles.joinBtn} onPress={() => setJoinOpen(true)} testID="join-btn">
          <Ionicons name="enter" size={20} color={theme.colors.onBrand} />
          <Text style={styles.joinText}>Entra in una stanza con codice</Text>
        </Pressable>

        <Text style={styles.section}>Le tue stanze</Text>
        {rooms.length === 0
          ? <Text style={styles.empty}>Nessuna stanza. Chiedi il codice all&apos;admin e clicca &quot;Entra&quot;.</Text>
          : rooms.map((r) => (
            <Pressable key={r.id} style={[styles.row, { borderColor: r.color + '80' }]} onPress={() => router.push(`/room/${r.id}`)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{r.name}</Text>
                <Text style={styles.rowMeta}>Giornata {r.matchday} · {r.members_count} partecipanti</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
            </Pressable>
          ))}
      </ScrollView>

      <Modal transparent visible={joinOpen} animationType="slide" onRequestClose={() => setJoinOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Entra in una stanza</Text>
              <Pressable onPress={() => setJoinOpen(false)}><Ionicons name="close" size={24} color={theme.colors.onSurface} /></Pressable>
            </View>
            <TextInput placeholder="Codice invito (es. AB12CD)" placeholderTextColor={theme.colors.muted}
              value={code} onChangeText={setCode} autoCapitalize="characters" style={styles.input} testID="join-code" />
            {msg && <Text style={styles.err}>{msg}</Text>}
            <Pressable style={[styles.cta, busy && { opacity: 0.5 }]} onPress={join} disabled={busy}>
              {busy ? <ActivityIndicator color={theme.colors.onBrand} /> : <Text style={styles.ctaText}>Entra</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: theme.spacing.lg },
  hi: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  mail: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  joinBtn: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, padding: theme.spacing.md, borderRadius: theme.radius.md, backgroundColor: theme.colors.brand, justifyContent: 'center' },
  joinText: { color: theme.colors.onBrand, fontWeight: '800' },
  section: { color: theme.colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginTop: theme.spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.md, backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border },
  rowName: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 14 },
  rowMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  empty: { color: theme.colors.muted, textAlign: 'center', paddingVertical: theme.spacing.xl },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius.lg, borderTopRightRadius: theme.radius.lg, padding: theme.spacing.lg, gap: theme.spacing.md },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  input: { color: theme.colors.onSurface, backgroundColor: theme.colors.surfaceSecondary, padding: theme.spacing.md, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, fontSize: 18, fontWeight: '800', textAlign: 'center', letterSpacing: 4 },
  err: { color: theme.colors.error, textAlign: 'center' },
  cta: { height: 52, backgroundColor: theme.colors.brand, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 16 },
});
