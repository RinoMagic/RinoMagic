import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/AuthContext';
import { theme } from '@/src/theme';

type League = {
  id: string;
  name: string;
  code: string;
  owner_id: string;
  members_count: number;
  is_owner: boolean;
  current_matchday: number;
};

type LeaderRow = {
  user_id: string;
  username: string;
  total: number;
  rank: number;
  is_winner: boolean;
};

type HistoryItem = { matchday: number; winner_username: string | null; winner_score: number };

export default function LeagueDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [league, setLeague] = useState<League | null>(null);
  const [tab, setTab] = useState<'current' | 'history'>('current');
  const [currentResults, setCurrentResults] = useState<LeaderRow[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const lg = await api<League>(`/leagues/${id}`);
      setLeague(lg);
      const cr = await api<{ results: LeaderRow[] }>(
        `/leagues/${id}/results/${lg.current_matchday}`
      );
      setCurrentResults(cr.results);
      const h = await api<{ history: HistoryItem[] }>(`/leagues/${id}/history`);
      setHistory(h.history);
    } catch {} finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading || !league) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.brand} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: theme.colors.surface }}>
        <View style={styles.header}>
          <Pressable
            testID="league-back-button"
            onPress={() => router.back()}
            hitSlop={12}
          >
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {league.name}
          </Text>
          <View style={{ width: 26 }} />
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.brand}
          />
        }
      >
        {/* Meta card */}
        <View style={styles.metaCard}>
          <View style={styles.metaRow}>
            <View>
              <Text style={styles.metaLabel}>GIORNATA</Text>
              <Text style={styles.metaValue}>{league.current_matchday}</Text>
            </View>
            <View style={styles.metaSep} />
            <View>
              <Text style={styles.metaLabel}>MEMBRI</Text>
              <Text style={styles.metaValue}>{league.members_count}</Text>
            </View>
            <View style={styles.metaSep} />
            <View>
              <Text style={styles.metaLabel}>CODICE</Text>
              <Text style={[styles.metaValue, { color: theme.colors.brand, letterSpacing: 2 }]}>
                {league.code}
              </Text>
            </View>
          </View>
        </View>

        {/* CTA row */}
        <View style={styles.ctaRow}>
          <Pressable
            testID="goto-lineup-button"
            style={[styles.cta, { backgroundColor: theme.colors.brand }]}
            onPress={() => router.push(`/league/${league.id}/lineup`)}
          >
            <Ionicons name="football" size={18} color={theme.colors.onBrand} />
            <Text style={[styles.ctaText, { color: theme.colors.onBrand }]}>
              Formazione G{league.current_matchday}
            </Text>
          </Pressable>
          {league.is_owner && (
            <Pressable
              testID="goto-admin-button"
              style={[styles.cta, styles.ctaSecondary]}
              onPress={() => router.push(`/league/${league.id}/admin`)}
            >
              <Ionicons name="cog" size={18} color={theme.colors.brandSecondary} />
              <Text style={[styles.ctaText, { color: theme.colors.onSurface }]}>Gestione</Text>
            </Pressable>
          )}
        </View>

        {/* Segmented control */}
        <View style={styles.segments}>
          {(['current', 'history'] as const).map((t) => (
            <Pressable
              key={t}
              testID={`segment-${t}`}
              onPress={() => setTab(t)}
              style={[styles.segment, tab === t && styles.segmentActive]}
            >
              <Text
                style={[
                  styles.segmentText,
                  tab === t && { color: theme.colors.onBrand, fontWeight: '800' },
                ]}
              >
                {t === 'current' ? 'Giornata' : 'Storico'}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === 'current' && (
          <View style={styles.listWrap}>
            <Text style={styles.sectionTitle}>Giornata {league.current_matchday}</Text>
            {currentResults.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  Ancora nessuna formazione consegnata per questa giornata.
                </Text>
              </View>
            ) : (
              currentResults.map((row) => (
                <View
                  key={row.user_id}
                  testID={`current-row-${row.user_id}`}
                  style={[
                    styles.leaderRow,
                    row.user_id === user?.id && { backgroundColor: theme.colors.brandTertiary },
                  ]}
                >
                  <Text style={styles.rank}>{row.rank}</Text>
                  <View style={styles.miniAv}>
                    <Text style={styles.miniAvText}>
                      {row.username.slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.leaderName}>{row.username}</Text>
                  {row.is_winner && (
                    <Ionicons
                      name="trophy"
                      size={18}
                      color={theme.colors.brandSecondary}
                      style={{ marginRight: 6 }}
                    />
                  )}
                  <Text style={styles.leaderScore}>{row.total.toFixed(2)}</Text>
                </View>
              ))
            )}
          </View>
        )}

        {tab === 'history' && (
          <View style={styles.listWrap}>
            <Text style={styles.sectionTitle}>Vincitori giornate</Text>
            {history.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>Nessuna giornata giocata ancora.</Text>
              </View>
            ) : (
              history.map((h) => (
                <View key={h.matchday} style={styles.historyRow}>
                  <View style={styles.historyLeft}>
                    <View style={styles.mdBadge}>
                      <Text style={styles.mdBadgeText}>G{h.matchday}</Text>
                    </View>
                    <View>
                      <Text style={styles.historyWinner}>
                        {h.winner_username || 'Nessuno'}
                      </Text>
                      <Text style={styles.historySub}>Vincitore giornata</Text>
                    </View>
                  </View>
                  <View style={styles.trophyChip}>
                    <Ionicons name="trophy" size={14} color={theme.colors.onBrandSecondary} />
                    <Text style={styles.trophyText}>{h.winner_score.toFixed(1)}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: theme.colors.onSurface,
    fontSize: 18,
    fontWeight: '800',
    flex: 1,
    textAlign: 'center',
  },
  metaCard: {
    marginHorizontal: theme.spacing.lg,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center' },
  metaSep: { width: 1, height: 36, backgroundColor: theme.colors.divider, marginHorizontal: theme.spacing.md },
  metaLabel: { color: theme.colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  metaValue: {
    color: theme.colors.onSurface,
    fontSize: 22,
    fontWeight: '800',
    marginTop: 4,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
  },
  cta: {
    flex: 1,
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.md,
  },
  ctaSecondary: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  ctaText: { fontWeight: '800' },
  segments: {
    flexDirection: 'row',
    marginTop: theme.spacing.lg,
    marginHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceSecondary,
    padding: 4,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: theme.radius.sm,
  },
  segmentActive: { backgroundColor: theme.colors.brand },
  segmentText: { color: theme.colors.onSurfaceSecondary, fontWeight: '600', fontSize: 13 },
  listWrap: { paddingHorizontal: theme.spacing.lg, marginTop: theme.spacing.lg },
  sectionTitle: {
    color: theme.colors.onSurface,
    fontWeight: '800',
    fontSize: 16,
    marginBottom: theme.spacing.sm,
  },
  hint: { color: theme.colors.muted, fontSize: 12, marginBottom: theme.spacing.md },
  empty: {
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  emptyText: { color: theme.colors.muted, textAlign: 'center' },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.sm,
    gap: theme.spacing.md,
  },
  rank: {
    color: theme.colors.onSurface,
    fontWeight: '800',
    fontSize: 18,
    width: 22,
    textAlign: 'center',
  },
  miniAv: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.surfaceTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniAvText: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 12 },
  leaderName: { color: theme.colors.onSurface, flex: 1, fontWeight: '600' },
  leaderSub: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  leaderScore: {
    color: theme.colors.brand,
    fontWeight: '800',
    fontSize: 18,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.sm,
  },
  historyLeft: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  mdBadge: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mdBadgeText: { color: theme.colors.brand, fontWeight: '800' },
  historyWinner: { color: theme.colors.onSurface, fontWeight: '800' },
  historySub: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  trophyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.colors.brandSecondary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
  },
  trophyText: { color: theme.colors.onBrandSecondary, fontWeight: '800', fontSize: 13 },
});
