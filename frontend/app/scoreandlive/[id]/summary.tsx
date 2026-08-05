/*
 * ScoreAndLive — Riassunto Giornata.
 *
 * Shows the aggregated picks per fixture for a single matchday of the
 * currently-selected tournament. Privacy rules:
 *   • Before the first kickoff of the matchday → only counts per candidate,
 *     without revealing WHO picked whom.
 *   • After the first kickoff (or once the matchday is settled) → every
 *     candidate row expands to show the nicknames that chose it.
 */
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

const COLOR = '#3B82F6';

type Candidate = {
  player_id: string;
  player_name: string | null;
  team: string | null;
  count: number;
  pickers: { user_id: string; nickname: string; deadlock_override: boolean }[] | null;
};
type SummaryFixture = {
  fixture_idx: number;
  home_team: string;
  away_team: string;
  kickoff_iso: string | null;
  total_picks: number;
  candidates: Candidate[];
};
type Summary = {
  matchday: number;
  kickoff_first: string | null;
  locked: boolean;
  settled: boolean;
  privacy_boost?: boolean;
  active_participants?: number;
  fixtures: SummaryFixture[];
};

export default function SalSummary() {
  const { id, matchday_id } = useLocalSearchParams<{ id: string; matchday_id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api<Summary>(
        `/sal/tournaments/${id}/matchdays/${matchday_id}/summary`,
      );
      setData(r);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  };
  useFocusEffect(useCallback(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, matchday_id]));

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Riassunto Giornata</Text>
            <Text style={styles.subtitle}>
              {data ? `Giornata ${data.matchday}` : 'Caricamento…'}
            </Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.body}>
        {err && (
          <View style={[styles.notice, { borderColor: theme.colors.error + '55' }]}>
            <Ionicons name="alert-circle" size={18} color={theme.colors.error} />
            <Text style={[styles.noticeText, { color: theme.colors.error }]}>{err}</Text>
          </View>
        )}
        {!data && !err && <ActivityIndicator color={COLOR} />}
        {data && (
          <>
            <View style={[styles.notice, data.locked && { borderColor: COLOR + '55' }]}>
              <Ionicons
                name={data.locked ? 'lock-open' : 'lock-closed'}
                size={18}
                color={data.locked ? COLOR : theme.colors.muted}
              />
              <Text style={styles.noticeText}>
                {data.locked
                  ? 'Giornata iniziata: puoi vedere le scelte di tutti i partecipanti.'
                  : 'Le scelte individuali sono nascoste fino al calcio d\u2019inizio della prima partita. Solo aggregati.'}
              </Text>
            </View>
            {data.privacy_boost && (
              <View style={[styles.notice, { borderColor: '#F97316' + '77' }]}>
                <Ionicons name="shield-checkmark" size={18} color="#F97316" />
                <Text style={[styles.noticeText, { color: '#F97316' }]}>
                  Fase finale del torneo: rimangono solo {data.active_participants} giocatori attivi.
                  Le statistiche aggregate sono nascoste fino al calcio d&apos;inizio per non
                  rivelare le scelte altrui.
                </Text>
              </View>
            )}
            {data.fixtures.length === 0 && (
              <Text style={styles.muted}>Nessuna partita in questa giornata.</Text>
            )}
            {data.fixtures.map((fx) => (
              <View key={fx.fixture_idx} style={styles.fxCard}>
                <View style={styles.fxHeader}>
                  <Text style={styles.fxTeam}>{fx.home_team}</Text>
                  <Text style={styles.fxVs}>vs</Text>
                  <Text style={styles.fxTeam}>{fx.away_team}</Text>
                </View>
                <Text style={styles.fxMeta}>
                  {fx.total_picks} pronostici totali
                </Text>
                {fx.candidates.length === 0 ? (
                  <Text style={styles.muted}>Nessun pronostico su questa partita.</Text>
                ) : (
                  fx.candidates.map((c) => (
                    <View key={c.player_id} style={styles.candidateRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.candidateName}>
                          {c.player_name || c.player_id}
                        </Text>
                        {c.team && <Text style={styles.candidateTeam}>{c.team}</Text>}
                        {data.locked && c.pickers && c.pickers.length > 0 && (
                          <View style={styles.pickerChips}>
                            {c.pickers.map((p) => (
                              <View
                                key={p.user_id}
                                style={[
                                  styles.pickerChip,
                                  p.deadlock_override && { borderColor: '#F97316', backgroundColor: '#F9731618' },
                                ]}
                              >
                                <Text style={styles.pickerChipText}>{p.nickname}</Text>
                                {p.deadlock_override && (
                                  <Ionicons name="warning" size={11} color="#F97316" />
                                )}
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                      <View style={styles.countBadge}>
                        <Text style={styles.countText}>{c.count}</Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md,
  },
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  body: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 60 },
  muted: { color: theme.colors.muted, fontSize: 13, fontStyle: 'italic' },
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceSecondary,
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  noticeText: { color: theme.colors.onSurface, flex: 1, fontSize: 12, lineHeight: 16 },
  fxCard: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
    padding: theme.spacing.md, gap: theme.spacing.sm,
  },
  fxHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  fxTeam: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 15, flex: 1 },
  fxVs: { color: theme.colors.muted, fontSize: 11 },
  fxMeta: { color: theme.colors.muted, fontSize: 12 },
  candidateRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  candidateName: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 13 },
  candidateTeam: { color: theme.colors.muted, fontSize: 11, marginTop: 1 },
  countBadge: {
    backgroundColor: COLOR + '22',
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10, paddingVertical: 4,
    minWidth: 32, alignItems: 'center',
  },
  countText: { color: COLOR, fontWeight: '900', fontSize: 15 },
  pickerChips: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6,
  },
  pickerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 6, paddingVertical: 2,
    backgroundColor: theme.colors.surface,
  },
  pickerChipText: { color: theme.colors.onSurface, fontSize: 11 },
});
