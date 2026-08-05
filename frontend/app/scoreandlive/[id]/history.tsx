/*
 * ScoreAndLive — tournament history page.
 *
 * Publicly readable: shows every matchday of the tournament with the picks
 * of every participant. For an OPEN tournament, only ``locked``/``settled``
 * matchdays reveal picks — this prevents leaking others' picks before the
 * deadline. For a FINISHED tournament, every matchday's picks are visible.
 */
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

const COLOR = '#3B82F6';

type Fixture = {
  idx: number; home_team: string; away_team: string;
  postponed_before?: boolean; postponed_during?: boolean;
};
type UserPick = {
  user_id: string; nickname: string;
  picks: { fixture_idx: number; scorer_name: string; scorer_team?: string }[];
  outcome?: 'survived' | 'eliminated' | null;
};
type MdEntry = {
  id: string; matchday_number: number; status: string;
  starts_at: string | null; settled_at: string | null;
  fixtures: Fixture[];
  scorers: { fixture_idx: number; scorer_names: string[] }[];
  picks_visible: boolean; picks: UserPick[];
};
type HistoryResp = {
  tournament: {
    id: string; name: string; status: string;
    season?: string;
    winner_user_id: string | null; winner_nickname: string | null;
    finished_at: string | null;
    previous_tournament_id: string | null;
    next_tournament_id: string | null;
  };
  matchdays: MdEntry[];
};

export default function HistoryPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<HistoryResp | null>(null);
  const [expandedMd, setExpandedMd] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api<HistoryResp>(`/sal/tournaments/${id}/history`);
      setData(r);
      // Expand the last settled matchday by default
      const lastSettled = [...r.matchdays].reverse().find((m) => m.status === 'settled');
      if (lastSettled) setExpandedMd(lastSettled.id);
    } catch (e: any) { alert(e.message); }
    finally { setLoading(false); }
  };
  useFocusEffect(useCallback(() => { load(); }, [id]));

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Storico giocate</Text>
            {data && <Text style={styles.subtitle}>{data.tournament.name}</Text>}
          </View>
        </View>
      </SafeAreaView>

      {loading && <ActivityIndicator color={COLOR} style={{ marginTop: 32 }} />}

      {data && (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={[styles.winCard, {
            backgroundColor: data.tournament.status === 'finished' ? COLOR + '22' : theme.colors.surfaceSecondary,
            borderColor: data.tournament.status === 'finished' ? COLOR : theme.colors.border,
          }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons
                name={data.tournament.status === 'finished' ? 'trophy' : 'flame'}
                size={20}
                color={data.tournament.status === 'finished' ? COLOR : theme.colors.warning}
              />
              <Text style={styles.winCardTitle}>
                {data.tournament.status === 'finished' ? 'Torneo concluso' : 'Torneo in corso'}
              </Text>
            </View>
            {data.tournament.status === 'finished' && (
              <>
                <Text style={styles.winCardBig}>
                  🏆 {data.tournament.winner_nickname || 'Nessun vincitore'}
                </Text>
                <Text style={styles.muted}>
                  Concluso il {data.tournament.finished_at
                    ? new Date(data.tournament.finished_at).toLocaleString('it-IT')
                    : '—'}
                </Text>
              </>
            )}
            {data.tournament.status !== 'finished' && (
              <Text style={styles.muted}>
                Giocate visibili solo dalle giornate bloccate/risolte (per non svelare i pick in anticipo)
              </Text>
            )}
          </View>

          <Text style={styles.section}>Giornate ({data.matchdays.length})</Text>
          {data.matchdays.map((md) => {
            const isLocked = md.status === 'locked';
            const isSettled = md.status === 'settled';
            const isExpanded = expandedMd === md.id;

            return (
              <View key={md.id} style={styles.mdCard}>
                <Pressable
                  style={styles.mdHeader}
                  onPress={() => setExpandedMd(isExpanded ? null : md.id)}
                  testID={`hist-md-${md.matchday_number}`}
                >
                  <View style={[styles.mdBadge, {
                    backgroundColor: isSettled ? COLOR + '22' : isLocked ? theme.colors.warning + '22' : theme.colors.muted + '22',
                  }]}>
                    <Text style={[styles.mdBadgeText, {
                      color: isSettled ? COLOR : isLocked ? theme.colors.warning : theme.colors.muted,
                    }]}>G{md.matchday_number}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mdName}>
                      {isSettled ? '✅ Risolta' : isLocked ? '🔒 Bloccata' : '⏳ Aperta'}
                    </Text>
                    <Text style={styles.mdMeta}>
                      {md.picks_visible ? `${md.picks.length} giocatori · picks pubblici` : 'Pick privati'}
                    </Text>
                  </View>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={theme.colors.muted}
                  />
                </Pressable>

                {isExpanded && (
                  <View style={styles.mdBody}>
                    {!md.picks_visible && (
                      <Text style={styles.muted}>
                        I pick di questa giornata saranno visibili quando l&apos;admin la bloccherà.
                      </Text>
                    )}
                    {md.picks_visible && md.picks.length === 0 && (
                      <Text style={styles.muted}>Nessun pick registrato per questa giornata.</Text>
                    )}
                    {md.picks_visible && md.picks.map((up) => (
                      <View key={up.user_id} style={styles.pickBlock}>
                        <View style={styles.pickHeader}>
                          <Ionicons
                            name={up.outcome === 'survived' ? 'heart' : up.outcome === 'eliminated' ? 'skull' : 'person'}
                            size={14}
                            color={up.outcome === 'survived' ? COLOR : up.outcome === 'eliminated' ? theme.colors.error : theme.colors.muted}
                          />
                          <Text style={styles.pickNick}>{up.nickname}</Text>
                          {up.outcome && (
                            <Text style={[styles.pickOutcome, {
                              color: up.outcome === 'survived' ? COLOR : theme.colors.error,
                            }]}>
                              · {up.outcome === 'survived' ? 'sopravvissuto' : 'eliminato'}
                            </Text>
                          )}
                        </View>
                        {up.picks.map((p) => {
                          const fx = md.fixtures.find((f) => f.idx === p.fixture_idx);
                          const scorers = md.scorers.find((s) => s.fixture_idx === p.fixture_idx);
                          const hit = scorers?.scorer_names?.some(
                            (n) => n.toLowerCase() === p.scorer_name.toLowerCase(),
                          );
                          return (
                            <View key={p.fixture_idx} style={styles.pickRow}>
                              <Text style={styles.pickFix} numberOfLines={1}>
                                {fx ? `${fx.home_team}-${fx.away_team}` : `#${p.fixture_idx}`}
                              </Text>
                              <Text
                                style={[styles.pickName, isSettled && {
                                  color: hit ? COLOR : theme.colors.error,
                                }]}
                                numberOfLines={1}
                              >
                                {isSettled ? (hit ? '✓ ' : '✗ ') : ''}
                                {p.scorer_name}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md,
  },
  title: { color: theme.colors.onSurface, fontSize: 17, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  body: { padding: theme.spacing.lg, gap: theme.spacing.sm, paddingBottom: 32 },

  winCard: {
    borderRadius: theme.radius.md, borderWidth: 1,
    padding: theme.spacing.md, gap: theme.spacing.xs,
  },
  winCardTitle: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 14 },
  winCardBig: { color: theme.colors.onSurface, fontWeight: '900', fontSize: 22, marginTop: 4 },

  section: {
    color: theme.colors.onSurface, fontWeight: '800',
    fontSize: 14, marginTop: theme.spacing.sm,
  },
  muted: { color: theme.colors.muted, fontSize: 12, fontStyle: 'italic' },

  mdCard: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md, overflow: 'hidden',
    borderWidth: 1, borderColor: theme.colors.border,
  },
  mdHeader: {
    flexDirection: 'row', alignItems: 'center',
    padding: theme.spacing.sm, gap: theme.spacing.sm,
  },
  mdBadge: {
    minWidth: 40, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: theme.radius.sm, alignItems: 'center',
  },
  mdBadgeText: { fontWeight: '900', fontSize: 12 },
  mdName: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 13 },
  mdMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 1 },

  mdBody: { padding: theme.spacing.sm, gap: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.border },

  pickBlock: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    gap: 4,
  },
  pickHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pickNick: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 13 },
  pickOutcome: { fontSize: 11, fontStyle: 'italic', fontWeight: '600' },

  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingLeft: theme.spacing.sm,
  },
  pickFix: { color: theme.colors.onSurfaceSecondary, fontSize: 11, flex: 1 },
  pickName: { color: theme.colors.onSurface, fontSize: 12, fontWeight: '600' },
});
