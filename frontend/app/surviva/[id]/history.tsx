/*
 * Surviva 2.0 — tournament history (archived / finished tournament view).
 *
 * Read-only view of a finished tournament. Uses the same visual language
 * as the "Test bigmach" leaderboard experience:
 *   • Winner card
 *   • Final leaderboard — each row tappable → opens the same participant
 *     picks modal as the live tournament view (SurvivaPicksModal)
 *   • Riassunto giornate — one card per settled matchday with aggregated
 *     pick counts per fixture (majority sign highlighted); expanded state
 *     shows detailed picks grouped by sign.
 */
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { SurvivaPicksModal, SurvivaLeaderboardRow } from '@/src/components/SurvivaPicksModal';

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
  const [lb, setLb] = useState<SurvivaLeaderboardRow[]>([]);
  const [summaries, setSummaries] = useState<Record<string, { fixtures: SummaryFixture[] }>>({});
  const [loading, setLoading] = useState(true);
  const [expandedMd, setExpandedMd] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<SurvivaLeaderboardRow | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [tour, allMds, board] = await Promise.all([
        api<T>(`/sv/tournaments/${id}`),
        api<Matchday[]>(`/sv/tournaments/${id}/matchdays`),
        api<SurvivaLeaderboardRow[]>(`/sv/tournaments/${id}/leaderboard`),
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
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
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
          <Pressable
            key={r.user_id}
            onPress={() => setSelectedRow(r)}
            testID={`sv-history-lb-${r.user_id}`}
            style={({ pressed }) => [
              styles.lbRow,
              r.eliminated && { opacity: 0.55 },
              pressed && { backgroundColor: theme.colors.surfaceTertiary },
            ]}
          >
            <Text style={styles.lbRank}>#{r.rank}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.lbName}>{r.nickname}</Text>
              {r.eliminated && (
                <Text style={styles.lbEliminated}>
                  {(r as any).eliminated_matchday
                    ? `Eliminato · G${(r as any).eliminated_matchday}`
                    : 'Eliminato'}
                </Text>
              )}
            </View>
            <View style={styles.lbBadgesCol}>
              <View style={[styles.livesBadge, styles.livesBadgeSmall]}>
                <Ionicons name="heart-outline" size={10} color={theme.colors.muted} />
                <Text style={styles.livesBadgeSmallText}>
                  {((r as any).pick_lives ?? 0) >= 0 ? ((r as any).pick_lives ?? 0) : `${(r as any).pick_lives}`}
                </Text>
              </View>
              <View style={styles.bonusBadge}>
                <Ionicons name="gift" size={11} color="#F59E0B" />
                <Text style={styles.bonusBadgeText}>+{(r as any).bonus_wins ?? 0}</Text>
              </View>
              <View style={[styles.livesBadge, styles.livesBadgeTotal]}>
                <Ionicons name="heart" size={12} color={COLOR} />
                <Text style={styles.livesBadgeText}>{r.lives_left}</Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={theme.colors.muted}
              style={{ marginLeft: 4 }}
            />
          </Pressable>
        ))}

        <Text style={styles.section}>Riassunto giornate ({mds.length})</Text>
        {mds.length === 0 && (
          <Text style={styles.muted}>Nessuna giornata giocata.</Text>
        )}
        {mds.map((md) => {
          const isOpen = expandedMd === md.id;
          const sum = summaries[md.id];
          return (
            <View key={md.id} style={styles.mdBlock}>
              <Pressable onPress={() => toggleMd(md)} style={styles.mdBlockHeader}>
                <Text style={styles.mdBlockTitle}>Giornata {md.matchday}</Text>
                <View style={styles.mdHeaderRight}>
                  <View style={[styles.mdBlockBadge, { backgroundColor: theme.colors.success + '22' }]}>
                    <Text style={[styles.mdBlockBadgeText, { color: theme.colors.success }]}>Calcolata</Text>
                  </View>
                  <Ionicons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={theme.colors.muted}
                  />
                </View>
              </Pressable>

              {isOpen && !sum && <ActivityIndicator color={COLOR} style={{ margin: 12 }} />}

              {isOpen && sum && sum.fixtures.length === 0 && (
                <Text style={styles.muted}>Nessuna partita in questa giornata.</Text>
              )}

              {isOpen && sum && sum.fixtures.map((fx, i) => {
                const total = fx.counts['1'] + fx.counts['X'] + fx.counts['2'];
                const picksBySign: Record<'1' | 'X' | '2', { nickname: string; correct?: boolean | null }[]> = {
                  '1': [], 'X': [], '2': [],
                };
                if (fx.picks) {
                  fx.picks.forEach(p => {
                    const s = (p.pick as '1' | 'X' | '2');
                    if (picksBySign[s]) picksBySign[s].push({ nickname: p.nickname, correct: p.correct });
                  });
                }
                const winnerSign = ['1', 'X', '2'].reduce<'1' | 'X' | '2'>(
                  (best, cur) => fx.counts[cur as '1' | 'X' | '2']
                    > fx.counts[best] ? (cur as '1' | 'X' | '2') : best,
                  '1',
                );
                const labelFor = (s: '1' | 'X' | '2'): string =>
                  s === '1' ? fx.home_team : s === '2' ? fx.away_team : 'Pareggio';
                return (
                  <View key={i} style={styles.summaryFxWrap}>
                    <View style={styles.summaryFxRow}>
                      <Text style={styles.pickTeams} numberOfLines={1}>
                        {fx.home_team} - {fx.away_team}
                      </Text>
                      <View style={styles.summaryCountsRow}>
                        {(['1', 'X', '2'] as const).map((s) => {
                          const isWinner = total > 0 && fx.counts[s] > 0 && s === winnerSign;
                          return (
                            <View
                              key={s}
                              style={[
                                styles.summaryCountPill,
                                isWinner && {
                                  backgroundColor: COLOR + '22',
                                  borderColor: COLOR,
                                },
                              ]}
                            >
                              <Text style={[
                                styles.summaryCountSign,
                                isWinner && { color: COLOR },
                              ]}>{s}</Text>
                              <Text style={[
                                styles.summaryCountValue,
                                isWinner && { color: COLOR },
                              ]}>{fx.counts[s]}</Text>
                            </View>
                          );
                        })}
                      </View>
                    </View>

                    {total > 0 && (
                      <View style={styles.picksGrouped}>
                        {(['1', 'X', '2'] as const).map((s) => {
                          const list = picksBySign[s];
                          if (list.length === 0) return null;
                          return (
                            <View key={s} style={styles.picksGroupRow}>
                              <View style={styles.picksGroupSign}>
                                <Text style={styles.picksGroupSignText}>{s}</Text>
                              </View>
                              <Text style={styles.picksGroupLabel} numberOfLines={1}>
                                {labelFor(s)}
                              </Text>
                              <View style={styles.picksGroupNames}>
                                {list.map((n, k) => (
                                  <View
                                    key={k}
                                    style={[
                                      styles.pickChip,
                                      n.correct === true && { backgroundColor: theme.colors.success + '22', borderColor: theme.colors.success },
                                      n.correct === false && { backgroundColor: theme.colors.error + '22', borderColor: theme.colors.error },
                                    ]}
                                  >
                                    <Text style={styles.pickChipName}>{n.nickname}</Text>
                                  </View>
                                ))}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      <SurvivaPicksModal
        tid={id!}
        row={selectedRow}
        onClose={() => setSelectedRow(null)}
      />
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

  // Leaderboard (clickable rows — same look as [id].tsx)
  lbRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md, borderWidth: 1,
    borderColor: theme.colors.border,
  },
  lbRank: { color: COLOR, fontWeight: '900', fontSize: 16, minWidth: 32 },
  lbName: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 14 },
  lbEliminated: { color: theme.colors.error, fontSize: 11, marginTop: 2 },
  livesBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLOR + '18',
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  livesBadgeText: { color: COLOR, fontWeight: '900', fontSize: 14 },
  livesBadgeSmall: {
    backgroundColor: theme.colors.surfaceTertiary,
    borderWidth: 1, borderColor: theme.colors.border,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  livesBadgeSmallText: {
    color: theme.colors.muted, fontWeight: '900', fontSize: 11,
  },
  livesBadgeTotal: {
    borderWidth: 1, borderColor: COLOR + '55',
  },
  lbBadgesCol: { alignItems: 'flex-end', gap: 4 },
  bonusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: theme.radius.pill,
    backgroundColor: '#F59E0B18',
    borderWidth: 1, borderColor: '#F59E0B55',
  },
  bonusBadgeText: { color: '#F59E0B', fontWeight: '900', fontSize: 11 },

  // Matchday summary card (same visual language as pick modal)
  mdBlock: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    borderWidth: 1, borderColor: theme.colors.border,
    gap: 6,
  },
  mdBlockHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  mdHeaderRight: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  mdBlockTitle: { color: theme.colors.onSurface, fontSize: 13, fontWeight: '800' },
  mdBlockBadge: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceTertiary,
  },
  mdBlockBadgeText: { color: theme.colors.muted, fontSize: 10, fontWeight: '800' },

  // Fixture row inside matchday card
  summaryFxWrap: {
    paddingVertical: 6,
    borderTopWidth: 1, borderTopColor: theme.colors.border,
  },
  summaryFxRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  pickTeams: { flex: 1, color: theme.colors.onSurface, fontSize: 12 },
  summaryCountsRow: { flexDirection: 'row', gap: 4 },
  summaryCountPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    minWidth: 44,
    paddingHorizontal: 6, paddingVertical: 3,
    borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    justifyContent: 'center',
  },
  summaryCountSign: { color: theme.colors.muted, fontWeight: '900', fontSize: 11 },
  summaryCountValue: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 12 },

  // Grouped picks (post-kickoff / settled)
  picksGrouped: {
    marginTop: 6, gap: 6,
    paddingTop: 6,
    borderTopWidth: 1, borderTopColor: theme.colors.border,
  },
  picksGroupRow: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6,
  },
  picksGroupSign: {
    minWidth: 22, paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  picksGroupSignText: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 11 },
  picksGroupLabel: {
    color: theme.colors.muted, fontSize: 11, fontWeight: '800',
    minWidth: 80,
  },
  picksGroupNames: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 },
  pickChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.colors.border,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  pickChipName: { color: theme.colors.onSurface, fontSize: 11 },
});
