/**
 * ScoreAndLive tournament detail: matchdays list, participants, admin actions.
 */
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

const COLOR = '#10B981';

type Participant = { user_id: string; nickname: string; lives_remaining: number; eliminated_at_matchday: number | null; is_me?: boolean };
type Matchday = { id: string; matchday_number: number; status: string; fixtures_count: number };
type SalInvite = {
  id: string; code: string;
  used_by_user_id: string | null; used_by_nickname: string | null;
  revoked_at: string | null;
};
type Detail = {
  id: string; name: string; status: string; initial_lives: number; is_admin: boolean;
  invite_code: string; participants: Participant[]; matchdays: Matchday[];
  my_blocked_teams: string[]; invites_available: number;
};

export default function TournamentPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [t, setT] = useState<Detail | null>(null);
  const [invites, setInvites] = useState<SalInvite[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const detail = await api<Detail>(`/sal/tournaments/${id}`);
      setT(detail);
      if (detail.is_admin) {
        try {
          setInvites(await api<SalInvite[]>(`/sal/tournaments/${id}/invites`));
        } catch {}
      }
    } catch (e: any) { alert(e.message); }
  };
  useFocusEffect(useCallback(() => { load(); }, [id]));

  const genInvite = async () => {
    setBusy(true);
    try {
      await api<{ code: string }>(`/sal/tournaments/${id}/invites`, { method: 'POST' });
      await load();
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  };

  if (!t) return <View style={styles.center}><ActivityIndicator color={COLOR} /></View>;

  const me = t.participants.find((p) => p.is_me);

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{t.name}</Text>
          {t.is_admin ? <Ionicons name="shield-checkmark" size={22} color={COLOR} /> : <View style={{ width: 22 }} />}
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: 60 }}>
        {me && (
          <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: COLOR }]}>
            <Text style={styles.cardTitle}>Le tue vite: {me.lives_remaining}/{t.initial_lives}</Text>
            {t.my_blocked_teams.length > 0 && (
              <Text style={styles.muted}>Bloccate: {t.my_blocked_teams.join(', ')}</Text>
            )}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Giornate ({t.matchdays.length})</Text>
          {t.matchdays.length === 0 && <Text style={styles.muted}>Ancora nessuna giornata creata.</Text>}
          {t.matchdays.map((m) => (
            <View key={m.id} style={styles.mdRow}>
              <Pressable
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
                onPress={() => router.push(`/scoreandlive/${id}/pick?matchday_id=${m.id}`)}
                testID={`sal-md-${m.matchday_number}`}
              >
                <Text style={styles.mdNum}>G{m.matchday_number}</Text>
                <Text style={styles.mdMeta}>{m.fixtures_count} partite · {m.status}</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push(`/scoreandlive/${id}/summary?matchday_id=${m.id}`)}
                hitSlop={10}
                testID={`sal-summary-${m.matchday_number}`}
                style={styles.summaryBtn}
              >
                <Ionicons name="stats-chart" size={16} color={COLOR} />
              </Pressable>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
            </View>
          ))}
        </View>

        {t.is_admin && (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[styles.cardTitle, { flex: 1 }]}>Codici invito ({invites.length})</Text>
              <Pressable
                style={[styles.ctaSmall, { backgroundColor: COLOR, opacity: busy ? 0.5 : 1 }]}
                onPress={genInvite} disabled={busy}
                testID="sal-gen-invite"
              >
                {busy
                  ? <ActivityIndicator color="#fff" size="small" />
                  : (
                    <>
                      <Ionicons name="add" size={16} color="#fff" />
                      <Text style={styles.ctaText}>Genera</Text>
                    </>
                  )}
              </Pressable>
            </View>
            {invites.length === 0 && (
              <Text style={styles.muted}>Nessun codice. Premi &quot;Genera&quot; per crearne uno.</Text>
            )}
            {invites.map((inv) => {
              const st = inv.revoked_at ? 'revoked' : inv.used_by_user_id ? 'used' : 'available';
              return (
                <View key={inv.id} style={styles.inviteRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.inviteCode,
                      st !== 'available' && { textDecorationLine: 'line-through', color: theme.colors.muted }
                    ]}>{inv.code}</Text>
                    <Text style={styles.gameTag}>ScoreAndLive</Text>
                  </View>
                  <Text style={[styles.inviteMeta,
                    st === 'available' && { color: COLOR },
                    st === 'used' && { color: theme.colors.accent },
                    st === 'revoked' && { color: theme.colors.muted },
                  ]}>
                    {st === 'revoked' ? '❌ revocato' :
                     st === 'used' ? `✅ ${inv.used_by_nickname || 'usato'}` : '⏳ disponibile'}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Partecipanti</Text>
          {t.participants.map((p) => (
            <View key={p.user_id} style={styles.row}>
              <Text style={[styles.nick, p.is_me && { color: COLOR, fontWeight: '800' }]}>{p.nickname}{p.is_me ? ' (tu)' : ''}</Text>
              <Text style={styles.lives}>
                {p.eliminated_at_matchday !== null
                  ? `💀 elim G${p.eliminated_at_matchday}`
                  : `❤️ ${p.lives_remaining}`}
              </Text>
            </View>
          ))}
        </View>

        <Pressable
          style={[styles.historyBtn, { borderColor: COLOR + '55' }]}
          onPress={() => router.push(`/scoreandlive/${id}/history`)}
          testID="sal-history"
        >
          <Ionicons name="albums" size={16} color={COLOR} />
          <Text style={[styles.historyText, { color: COLOR }]}>Vedi storico giocate</Text>
          <Ionicons name="chevron-forward" size={16} color={COLOR} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.lg },
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
    borderWidth: 1, borderColor: theme.colors.border, fontSize: 13,
  },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, paddingVertical: 10, borderRadius: theme.radius.pill },
  ctaSmall: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: theme.radius.pill,
  },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  ctaOutline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: theme.radius.pill, borderWidth: 1 },
  ctaTextOutline: { fontWeight: '700', fontSize: 13 },
  mdRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.sm, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surface },
  mdNum: { color: COLOR, fontWeight: '800', fontSize: 15, width: 40 },
  mdMeta: { color: theme.colors.onSurface, fontSize: 13, flex: 1 },
  summaryBtn: {
    paddingHorizontal: 8, paddingVertical: 6,
    borderRadius: theme.radius.sm,
    backgroundColor: COLOR + '18',
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  nick: { color: theme.colors.onSurface, fontSize: 14, flex: 1 },
  lives: { color: theme.colors.onSurfaceSecondary, fontSize: 13, fontWeight: '600' },
  inviteRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
  },
  inviteCode: {
    color: theme.colors.onSurface, fontSize: 15, fontWeight: '800',
    letterSpacing: 2, fontFamily: 'monospace' as any,
  },
  gameTag: {
    color: theme.colors.muted, fontSize: 10, fontWeight: '700',
    letterSpacing: 0.5, marginTop: 1, textTransform: 'uppercase',
  },
  inviteMeta: { fontSize: 12, fontWeight: '600' },
  historyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: theme.spacing.sm,
    paddingVertical: 12, borderRadius: theme.radius.pill,
    borderWidth: 1, backgroundColor: theme.colors.surfaceSecondary,
    marginTop: theme.spacing.sm,
  },
  historyText: { fontWeight: '800', fontSize: 14 },
  toggle: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm, borderWidth: 1,
    backgroundColor: theme.colors.surface,
  },
  toggleText: { color: theme.colors.onSurfaceSecondary, fontSize: 13, fontWeight: '600', flex: 1 },
});
