import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  ActivityIndicator, RefreshControl, Modal, Platform, Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session, User } from '@/src/api';
import { theme } from '@/src/theme';
import { confirmDialog } from '@/src/utils/confirm';

type Room = {
  id: string; name: string; matchday: number; max_events: number;
  color: string; invite_code: string; status: string; members_count: number;
  invites_available: number; invites_total: number;
};

async function copyText(text: string): Promise<void> {
  try {
    await Clipboard.setStringAsync(text);
  } catch {
    if (typeof navigator !== 'undefined' && (navigator as any).clipboard) {
      try { await (navigator as any).clipboard.writeText(text); } catch {}
    }
  }
}

export default function AdminHome() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'rooms' | 'users'>('rooms');
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState(''); const [matchday, setMatchday] = useState('');
  const [maxEvents, setMaxEvents] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, r, u] = await Promise.all([
        session.load(),
        api<Room[]>('/rooms?game=thebesttiket'),
        api<User[]>('/auth/users'),
      ]);
      setMe(s.user); setRooms(r); setUsers(u);
    } catch (e: any) {
      if (e.message?.includes('Non autenticato')) router.replace('/');
    } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const logout = async () => { await session.clear(); router.replace('/'); };

  const createRoom = async () => {
    setBusy(true); setMsg(null);
    try {
      const md = parseInt(matchday, 10); const me = parseInt(maxEvents, 10);
      if (!name.trim() || !md || !me) throw new Error('Compila tutti i campi');
      if (me < 1 || me > 5) throw new Error('Il numero di eventi deve essere tra 1 e 5');
      const room = await api<Room>('/rooms', {
        method: 'POST',
        body: { name: name.trim(), matchday: md, max_events: me, game: 'thebesttiket' },
      });
      setCreateOpen(false); setName(''); setMatchday(''); setMaxEvents('');
      router.push(`/room/${room.id}`);
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  const deleteRoom = async (id: string, name: string) => {
    if (!await confirmDialog('Elimina stanza',
      `Sicuro di eliminare "${name}"? Tutte le schedine e i risultati saranno cancellati.`)) return;
    try {
      await api(`/rooms/${id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) { setMsg(e.message); }
  };

  const shareInvite = async (r: Room) => {
    // Navigate to the invite management screen where the admin can generate
    // a one-shot invite code per player.
    router.push(`/room/${r.id}/invites`);
  };

  const toggleBlock = async (u: User) => {
    const action = u.blocked ? 'unblock' : 'block';
    const label = u.blocked ? 'Sbloccare' : 'Bloccare';
    const name = u.username || u.email || '';
    const message = u.blocked
      ? `Riabilitare "${name}" all'accesso all'app?`
      : `"${name}" non potrà più accedere all'app finché non verrà sbloccato. Confermi?`;
    if (!await confirmDialog(`${label} giocatore`, message, { destructive: !u.blocked })) return;
    try {
      await api(`/auth/users/${u.id}/${action}`, { method: 'POST' });
      await load();
    } catch (e: any) { setMsg(e.message); }
  };

  const deletePlayer = async (u: User) => {
    if (!await confirmDialog('Elimina giocatore',
      `Elimina definitivamente "${u.username || u.email}"?`)) return;
    try {
      await api(`/auth/users/${u.id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) { setMsg(e.message); }
  };

  const resetPlayerPw = async (u: User) => {
    const tempPw = Math.random().toString(36).slice(2, 10) + 'A1';
    if (!await confirmDialog(
      'Reset password',
      `Assegno una password temporanea a "${u.username}".\n\nNuova password: ${tempPw}\n\nAssicurati di comunicargliela.`
    )) return;
    try {
      await api('/auth/users/reset-password', {
        method: 'POST', body: { user_id: u.id, new_password: tempPw },
      });
      await copyText(`Nickname: ${u.username}\nPassword: ${tempPw}`);
      if (Platform.OS === 'web') {
        window.alert(`Password aggiornata!\nHo copiato username+password negli appunti:\n\nNickname: ${u.username}\nPassword: ${tempPw}`);
      } else {
        Alert.alert('Password aggiornata',
          `Nickname: ${u.username}\nPassword: ${tempPw}\n\nCopiato negli appunti.`);
      }
    } catch (e: any) { setMsg(e.message); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>;

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.replace('/hub')} hitSlop={12} testID="admin-back-hub" style={{ marginRight: 4 }}>
            <Ionicons name="grid" size={22} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.hi}>TheBestTiket · Admin</Text>
            <Text style={styles.mail}>{me?.email}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'center' }}>
            <Pressable
              onPress={() => router.push('/pdf-admin')}
              hitSlop={12}
              testID="admin-pdf-imports"
            >
              <Ionicons name="document-text-outline" size={22} color={theme.colors.onSurface} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/settings')}
              hitSlop={12}
              testID="admin-settings"
            >
              <Ionicons name="settings-outline" size={22} color={theme.colors.onSurface} />
            </Pressable>
            <Pressable onPress={logout} hitSlop={12}>
              <Ionicons name="log-out-outline" size={22} color={theme.colors.onSurface} />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <View style={styles.segments}>
        <Pressable onPress={() => setTab('rooms')} style={[styles.segment, tab === 'rooms' && styles.segmentActive]}>
          <Text style={[styles.segmentText, tab === 'rooms' && styles.segmentTextActive]}>Stanze ({rooms.length})</Text>
        </Pressable>
        <Pressable onPress={() => setTab('users')} style={[styles.segment, tab === 'users' && styles.segmentActive]}>
          <Text style={[styles.segmentText, tab === 'users' && styles.segmentTextActive]}>Utenti ({users.length})</Text>
        </Pressable>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.colors.brand} />}
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.sm, paddingBottom: 100 }}
      >
        {tab === 'rooms' && <>
          <Pressable style={styles.createBtn} onPress={() => setCreateOpen(true)} testID="create-room-btn">
            <Ionicons name="add-circle" size={20} color={theme.colors.brand} />
            <Text style={styles.createText}>Crea nuova stanza</Text>
          </Pressable>
          {rooms.length === 0
            ? <Text style={styles.empty}>Nessuna stanza. Creane una per iniziare.</Text>
            : rooms.map((r) => (
              <View key={r.id} style={[styles.row, { borderColor: r.color + '80' }]}>
                <Pressable style={{ flex: 1 }} onPress={() => router.push(`/room/${r.id}`)}>
                  <Text style={styles.rowName}>{r.name}</Text>
                  <Text style={styles.rowMeta}>
                    Giornata {r.matchday} · Eventi {r.max_events} · {r.members_count} partecipanti · {r.invites_available}/{r.invites_total} inviti
                  </Text>
                </Pressable>
                <Pressable onPress={() => shareInvite(r)} hitSlop={8} testID={`share-${r.id}`}>
                  <Ionicons name="people" size={18} color={theme.colors.brand} />
                </Pressable>
                <Pressable onPress={() => deleteRoom(r.id, r.name)} hitSlop={8} testID={`delete-${r.id}`}>
                  <Ionicons name="trash" size={18} color={theme.colors.error} />
                </Pressable>
              </View>
            ))}
        </>}
        {tab === 'users' && users.map((u) => (
          <View key={u.id} style={[styles.row, u.blocked && { borderColor: theme.colors.error }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{u.username || u.email} {u.role === 'admin' && '(admin)'}</Text>
              {u.blocked && <Text style={[styles.rowMeta, { color: theme.colors.error }]}>BLOCCATO</Text>}
            </View>
            {u.role === 'player' && u.id !== me?.id && <>
              <Pressable onPress={() => resetPlayerPw(u)} hitSlop={8}><Ionicons name="key" size={18} color={theme.colors.brand} /></Pressable>
              <Pressable onPress={() => toggleBlock(u)} hitSlop={8}><Ionicons name={u.blocked ? 'lock-open' : 'ban'} size={18} color={theme.colors.warning} /></Pressable>
              <Pressable onPress={() => deletePlayer(u)} hitSlop={8}><Ionicons name="trash" size={18} color={theme.colors.error} /></Pressable>
            </>}
          </View>
        ))}
      </ScrollView>

      <Modal transparent visible={createOpen} animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Nuova stanza</Text>
              <Pressable onPress={() => setCreateOpen(false)}><Ionicons name="close" size={24} color={theme.colors.onSurface} /></Pressable>
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Nome stanza</Text>
              <TextInput placeholder="es. Serata del sabato" placeholderTextColor={theme.colors.muted}
                value={name} onChangeText={setName} style={styles.input} />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Giornata</Text>
              <TextInput placeholder="1-38" placeholderTextColor={theme.colors.muted}
                value={matchday} onChangeText={setMatchday} keyboardType="number-pad" style={styles.input} />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Eventi</Text>
              <TextInput placeholder="1-5" placeholderTextColor={theme.colors.muted}
                value={maxEvents} onChangeText={setMaxEvents} keyboardType="number-pad" style={styles.input} />
            </View>
            {msg && <Text style={styles.err}>{msg}</Text>}
            <Pressable style={[styles.cta, busy && { opacity: 0.5 }]} onPress={createRoom} disabled={busy}>
              {busy ? <ActivityIndicator color={theme.colors.onBrand} /> : <Text style={styles.ctaText}>Crea stanza</Text>}
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
  segments: { flexDirection: 'row', marginHorizontal: theme.spacing.lg, backgroundColor: theme.colors.surfaceSecondary, padding: 4, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border },
  segment: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: theme.radius.sm },
  segmentActive: { backgroundColor: theme.colors.brand },
  segmentText: { color: theme.colors.onSurfaceSecondary, fontWeight: '700', fontSize: 13 },
  segmentTextActive: { color: theme.colors.onBrand, fontWeight: '800' },
  createBtn: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, padding: theme.spacing.md, borderRadius: theme.radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.brand, justifyContent: 'center' },
  createText: { color: theme.colors.brand, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.md, backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border },
  rowName: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 14 },
  rowMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  empty: { color: theme.colors.muted, textAlign: 'center', paddingVertical: theme.spacing.xl },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius.lg, borderTopRightRadius: theme.radius.lg, padding: theme.spacing.lg, gap: theme.spacing.md },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  field: { gap: 6 },
  fieldLabel: {
    color: theme.colors.brand,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginLeft: 2,
  },
  input: { color: theme.colors.onSurface, backgroundColor: theme.colors.surfaceSecondary, padding: theme.spacing.md, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border },
  err: { color: theme.colors.error, textAlign: 'center' },
  cta: { height: 52, backgroundColor: theme.colors.brand, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 16 },
});
