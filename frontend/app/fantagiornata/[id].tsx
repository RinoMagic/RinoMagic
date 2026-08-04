/**
 * FantaGiornata — league detail.
 *   - Admin: manage invites, trigger settlement for a matchday
 *   - Everyone: quick lineup access, leaderboard, latest results
 */
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { MatchdayCountdown } from '@/src/components/MatchdayCountdown';
import { confirmDialog } from '@/src/utils/confirm';

const COLOR = '#A855F7';

type LeagueDetail = {
  id: string; name: string; status: string; invite_code: string;
  current_matchday: number | null; members_count: number;
  invites_available: number; invites_total: number; is_admin: boolean;
  members: { user_id: string; nickname: string }[];
};

type LeaderRow = { user_id: string; nickname: string; total: number; matchdays_played: number };
type Invite = { id: string; code: string; used_by_nickname: string | null; revoked_at: string | null };

export default function LeaguePage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [lg, setLg] = useState<LeagueDetail | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [md, setMd] = useState('1');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    try {
      const detail = await api<LeagueDetail>(`/fg/leagues/${id}`);
      setLg(detail);
      const lb = await api<{ leaderboard: LeaderRow[] }>(`/fg/leagues/${id}/leaderboard`);
      setLeaderboard(lb.leaderboard);
      if (detail.is_admin) {
        const invs = await api<Invite[]>(`/fg/leagues/${id}/invites`);
        setInvites(invs);
      }
    } catch (e: any) { alert(e.message); }
  };
  useFocusEffect(useCallback(() => { load(); }, [id]));

  const genInvite = async () => {
    setBusy(true);
    try {
      const inv = await api<Invite>(`/fg/leagues/${id}/invites`, { method: 'POST' });
      setFlash(`Nuovo codice: ${inv.code}`);
      await load();
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  };

  const settle = async () => {
    const n = parseInt(md, 10);
    if (!(n >= 1 && n <= 38)) return alert('Giornata 1-38');
    setBusy(true);
    try {
      const r = await api<{ settled_users: number }>(`/fg/leagues/${id}/settle`, {
        method: 'POST', body: { matchday: n },
      });
      setFlash(`Giornata ${n} calcolata: ${r.settled_users} formazioni`);
      await load();
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  };

  const kickMember = async (m: { user_id: string; nickname: string }) => {
    if (!lg?.is_admin) return;
    const ok = await confirmDialog(
      'Escludi giocatore',
      `Vuoi escludere "${m.nickname}" da questa lega?\n\nVerrà rimosso dalla classifica e tutte le sue formazioni saranno eliminate.\n\nL'azione è IRREVERSIBILE.`,
      { destructive: true, confirmLabel: 'Escludi' },
    );
    if (!ok) return;
    try {
      await api(`/fg/leagues/${id}/kick/${m.user_id}`, { method: 'POST' });
      await load();
    } catch (e: any) { alert(e?.message || 'Errore'); }
  };

  if (!lg) return <View style={styles.center}><ActivityIndicator color={COLOR} /></View>;

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{lg.name}</Text>
          {lg.is_admin ? <Ionicons name="shield-checkmark" size={22} color={COLOR} /> : <View style={{ width: 22 }} />}
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: 60 }}>
        <MatchdayCountdown />
        {flash && <View style={styles.okBox}><Text style={styles.okText}>{flash}</Text></View>}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Formazione</Text>
          <Text style={styles.muted}>Compila la tua rosa (11 titolari + 8 riserve) per una giornata.</Text>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
            <TextInput
              style={[styles.input, { width: 80 }]} value={md} onChangeText={setMd} keyboardType="number-pad"
              placeholder="Giornata" placeholderTextColor={theme.colors.muted}
            />
            <Pressable
              style={[styles.cta, { backgroundColor: COLOR, flex: 1 }]}
              onPress={() => router.push(`/fantagiornata/${id}/lineup?matchday=${md}`)}
              testID="fg-open-lineup"
            >
              <Ionicons name="clipboard" size={18} color="#fff" />
              <Text style={styles.ctaText}>Apri formazione</Text>
            </Pressable>
          </View>
          <Pressable
            style={[styles.ctaOutline, { borderColor: COLOR }]}
            onPress={() => router.push(`/fantagiornata/${id}/lineups?matchday=${md}`)}
            testID="fg-view-all-lineups"
          >
            <Ionicons name="people" size={16} color={COLOR} />
            <Text style={[styles.ctaTextOutline, { color: COLOR }]}>Formazioni di tutti (giornata {md || '?'})</Text>
          </Pressable>
          {lg.is_admin && (
            <Pressable
              style={[styles.ctaOutline, { borderColor: COLOR, opacity: busy ? 0.5 : 1 }]}
              onPress={settle} disabled={busy}
              testID="fg-settle"
            >
              <Ionicons name="calculator" size={16} color={COLOR} />
              <Text style={[styles.ctaTextOutline, { color: COLOR }]}>Calcola giornata (admin)</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Classifica</Text>
          {leaderboard.length === 0 && <Text style={styles.muted}>Ancora nessuna giornata calcolata.</Text>}
          {leaderboard.map((r, i) => (
            <View key={r.user_id} style={styles.row}>
              <Text style={styles.rank}>{i + 1}.</Text>
              <Text style={styles.nick}>{r.nickname}</Text>
              <Text style={styles.pts}>{r.total.toFixed(2)} pt</Text>
              {lg.is_admin && (
                <Pressable
                  testID={`fg-kick-${r.user_id}`}
                  onPress={() => kickMember(r)}
                  hitSlop={6}
                  style={styles.kickBtn}
                >
                  <Ionicons name="person-remove" size={14} color={theme.colors.error} />
                </Pressable>
              )}
            </View>
          ))}
        </View>

        {lg.is_admin && lg.members && lg.members.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Membri iscritti ({lg.members.length})</Text>
            <Text style={styles.muted}>Escludi qui i giocatori non ancora presenti in classifica.</Text>
            {lg.members.map((m) => (
              <View key={m.user_id} style={styles.row}>
                <Text style={styles.nick}>{m.nickname}</Text>
                <Pressable
                  testID={`fg-kick-member-${m.user_id}`}
                  onPress={() => kickMember(m)}
                  hitSlop={6}
                  style={styles.kickBtn}
                >
                  <Ionicons name="person-remove" size={14} color={theme.colors.error} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {lg.is_admin && (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.cardTitle}>Inviti</Text>
              <Pressable onPress={genInvite} disabled={busy} hitSlop={10} testID="fg-gen-invite">
                <Ionicons name="add-circle" size={22} color={COLOR} />
              </Pressable>
            </View>
            {invites.length === 0 && <Text style={styles.muted}>Nessun invito.</Text>}
            {invites.map((inv) => (
              <View key={inv.id} style={styles.inviteRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.code}>{inv.code}</Text>
                  <Text style={styles.gameTag}>FantaGiornata</Text>
                </View>
                <Text style={styles.inviteMeta}>
                  {inv.revoked_at ? '❌ revocato' : inv.used_by_nickname ? `✅ ${inv.used_by_nickname}` : '⏳ disponibile'}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: theme.spacing.lg, gap: theme.spacing.md,
  },
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800', flex: 1 },
  card: {
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary, gap: theme.spacing.sm,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  cardTitle: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 15 },
  muted: { color: theme.colors.muted, fontSize: 12, fontStyle: 'italic' },
  input: {
    color: theme.colors.onSurface, backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border, fontSize: 14,
  },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: theme.spacing.sm, paddingVertical: 10, borderRadius: theme.radius.pill,
  },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  ctaOutline: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8, borderRadius: theme.radius.pill, borderWidth: 1,
  },
  ctaTextOutline: { fontWeight: '700', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: 4 },
  rank: { color: theme.colors.muted, fontSize: 13, fontWeight: '700', width: 24 },
  nick: { color: theme.colors.onSurface, fontSize: 14, flex: 1 },
  pts: { color: COLOR, fontWeight: '800', fontSize: 14 },
  kickBtn: {
    padding: 6,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.error + '18',
    borderWidth: 1,
    borderColor: theme.colors.error + '55',
  },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  code: { color: theme.colors.onSurface, fontSize: 14, fontWeight: '800', fontFamily: 'monospace' as any },
  gameTag: {
    color: theme.colors.muted, fontSize: 10, fontWeight: '700',
    letterSpacing: 0.5, marginTop: 1, textTransform: 'uppercase',
  },
  inviteMeta: { color: theme.colors.muted, fontSize: 12 },
  okBox: {
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.success + '22',
  },
  okText: { color: theme.colors.success, fontSize: 13, fontWeight: '600' },
});
