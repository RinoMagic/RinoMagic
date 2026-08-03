/*
 * Surviva 2.0 — tournament history (archived / finished tournament view).
 *
 * Read-only view of a finished tournament. Shows the final leaderboard and
 * every settled matchday summary (aggregated + detailed picks per fixture).
 */
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

const COLOR = '#EF4444';

type T = {
  id: string; name: string; season: string; status: string;
  initial_lives: number; players_total: number; players_alive: number;
  finished_at: string | null;
};
type Matchday = {
  id: string; matchday: number; status: string;
  fixtures: { home_team: string; away_team: string }[];
  settled: boolean;
};
type LeaderboardRow = {
  user_id: string; nickname: string; lives_left: number;
  blocked_signs_count: number; eliminated: boolean; rank: number;
};
type SummaryFixture = {
  home_team: string; away_team: string;
  counts: { '1': number; X: number; '2': number };
  picks: { nickname: string; pick: string; correct?: boolean | null }[] | null;
};

export default function SurvivaHistory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [t, setT] = useState<T | null>(null);
  const [mds, setMds] = useState<Matchday[]>([]);
  const [lb, setLb] = useState<LeaderboardRow[]>([]);
  const [summaries, setSummaries] = useState<Record<string, { fixtures: SummaryFixture[] }>>({});
  const [loading, setLoading] = useState(true);
  const [expandedMd, setExpandedMd] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [tour, allMds, board] = await Promise.all([
        api<T>(`/sv/tournaments/${id}`),
        api<Matchday[]>(`/sv/tournaments/${id}/matchdays`),
        api<LeaderboardRow[]>(`/sv/tournaments/${id}/leaderboard`),
      ]);
      setT(tour);
      setMds(allMds.filter((m) => m.settled));
      setLb(board);
    } catch (e: any) { alert(e.message); }
    finally { setLoading(false); }
  };
  useFocusEffect(useCallback(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]));

  const toggleMd = async (md: Matchday) => {
    if (expandedMd === md.id) {
      setExpandedMd(null);
      return;
    }
    setExpandedMd(md.id);
    if (!summaries[md.id]) {
      try {
        const s = await api<{ fixtures: SummaryFixture[] }>(
          `/sv/tournaments/${id}/matchdays/${md.id}/summary`,
        );
        setSummaries((prev) => ({ ...prev, [md.id]: s }));
      } catch (e: any) {
        alert(e.message);
      }
    }
  };

  if (loading || !t) {
    return <View style={styles.center}><ActivityIndicator color={COLOR} /></View>;
  }

  const winner = lb.find((r) => r.rank === 1 && !r.eliminated) || lb[0];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.replace('/surviva')} hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{t.name}</Text>
            <Text style={styles.subtitle}>
              Stagione {t.season || '?'} · Concluso{' '}
              {t.finished_at ? new Date(t.finished_at).toLocaleDateString('it-IT') : '—'}
            </Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.body}>
        {winner && (
          <View style={styles.winnerCard}>
            <Ionicons name="trophy" size={26} color={COLOR} />
            <View style={{ flex: 1 }}>
              <Text style={styles.winnerLabel}>Vincitore</Text>
              <Text style={styles.winnerName}>{winner.nickname}</Text>
              <Text style={styles.winnerLives}>❤️ {winner.lives_left} vite finali</Text>
            </View>
          </View>
        )}

        <Text style={styles.section}>Classifica finale</Text>
        {lb.map((r) => (
          <View key={r.user_id} style={[styles.lbRow, r.eliminated && { opacity: 0.55 }]}>
            <Text style={styles.lbRank}>#{r.rank}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.lbName}>{r.nickname}</Text>
              {r.eliminated && <Text style={styles.lbEliminated}>Eliminato</Text>}
            </View>
            <View style={styles.livesBadge}>
              <Ionicons name="heart" size={12} color={COLOR} />
              <Text style={styles.livesBadgeText}>{r.lives_left}</Text>
            </View>
          </View>
        ))}

        <Text style={styles.section}>Giornate ({mds.length})</Text>
        {mds.length === 0 && (
          <Text style={styles.muted}>Nessuna giornata giocata.</Text>
        )}
        {mds.map((md) => {
          const isOpen = expandedMd === md.id;
          const sum = summaries[md.id];
          return (
            <View key={md.id} style={styles.mdCard}>
              <Pressable onPress={() => toggleMd(md)} style={styles.mdHeader}>
                <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={18} color={theme.colors.muted} />
                <Text style={styles.mdTitle}>Giornata {md.matchday}</Text>
                <Text style={styles.mdMeta}>{md.fixtures.length} partite</Text>
              </Pressable>
              {isOpen && sum && sum.fixtures.map((fx, i) => {
                const total = fx.counts['1'] + fx.counts['X'] + fx.counts['2'];
                return (
                  <View key={i} style={styles.mdFixture}>
                    <View style={styles.fxTeams}>
                      <Text style={styles.fxTeam}>{fx.home_team}</Text>
                      <Text style={styles.fxVs}>vs</Text>
                      <Text style={styles.fxTeam}>{fx.away_team}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      {(['1', 'X', '2'] as const).map((s) => (
                        <View key={s} style={styles.summaryCell}>
                          <Text style={styles.summarySign}>{s}</Text>
                          <Text style={styles.summaryCount}>{fx.counts[s]}</Text>
                          <Text style={styles.summaryPct}>
                            {total > 0 ? `${Math.round((fx.counts[s] / total) * 100)}%` : '—'}
                          </Text>
                        </View>
                      ))}
                    </View>
                    {fx.picks && fx.picks.length > 0 && (
                      <View style={styles.picksList}>
                        {fx.picks.map((p, k) => (
                          <View
                            key={k}
                            style={[
                              styles.pickChip,
                              p.correct === true && { backgroundColor: '#22C55E22', borderColor: '#22C55E' },
                              p.correct === false && { backgroundColor: '#EF444422', borderColor: '#EF4444' },
                            ]}
                          >
                            <Text style={styles.pickChipSign}>{p.pick}</Text>
                            <Text style={styles.pickChipName}>{p.nickname}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
              {isOpen && !sum && <ActivityIndicator color={COLOR} style={{ margin: 12 }} />}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md,
  },
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  body: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 48 },
  section: {
    color: theme.colors.onSurface, fontWeight: '800',
    fontSize: 15, marginTop: theme.spacing.md,
  },
  muted: { color: theme.colors.muted, fontSize: 13, fontStyle: 'italic' },
  winnerCard: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.md, backgroundColor: COLOR + '15',
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: COLOR + '55',
  },
  winnerLabel: { color: COLOR, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  winnerName: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '900', marginTop: 2 },
  winnerLives: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  lbRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md, borderWidth: 1,
    borderColor: theme.colors.border,
  },
  lbRank: { color: COLOR, fontWeight: '900', fontSize: 14, minWidth: 30 },
  lbName: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 14 },
  lbEliminated: { color: theme.colors.error, fontSize: 11, marginTop: 2 },
  livesBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLOR + '18',
    borderRadius: theme.radius.pill,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  livesBadgeText: { color: COLOR, fontWeight: '900', fontSize: 13 },
  mdCard: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  mdHeader: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    padding: theme.spacing.md,
  },
  mdTitle: { color: theme.colors.onSurface, fontWeight: '800', flex: 1 },
  mdMeta: { color: theme.colors.muted, fontSize: 11 },
  mdFixture: {
    padding: theme.spacing.md,
    borderTopWidth: 1, borderTopColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  fxTeams: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  fxTeam: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 13, flex: 1 },
  fxVs: { color: theme.colors.muted, fontSize: 10 },
  summaryRow: { flexDirection: 'row', gap: theme.spacing.sm },
  summaryCell: {
    flex: 1, alignItems: 'center',
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  summarySign: { color: COLOR, fontWeight: '800', fontSize: 13 },
  summaryCount: { color: theme.colors.onSurface, fontWeight: '900', fontSize: 18, marginTop: 2 },
  summaryPct: { color: theme.colors.muted, fontSize: 10, marginTop: 2 },
  picksList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  pickChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.colors.border,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  pickChipSign: { color: COLOR, fontWeight: '900', fontSize: 12 },
  pickChipName: { color: theme.colors.onSurface, fontSize: 11 },
});
