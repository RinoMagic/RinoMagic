/*
 * Surviva 2.0 — tournament detail page.
 *
 * Shows the current matchday with a 1/X/2 grid for every fixture. The
 * player picks exactly ONE fixture per matchday. Signs already used
 * successfully (blocked_signs) are greyed out and unclickable.
 *
 * Tabs:
 *   • Giornata — the pick UI (this page's main content)
 *   • Classifica — participants leaderboard (lives + status)
 *   • Riassunto — aggregated picks (private pre-kickoff, detailed after)
 */
import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { confirmDialog } from '@/src/utils/confirm';

const COLOR = '#EF4444';

type Fixture = { home_team: string; away_team: string; kickoff_iso?: string | null; postponed_before?: boolean };
type Matchday = {
  id: string; matchday: number; status: string;
  kickoff_first: string | null; fixtures: Fixture[];
  locked: boolean; settled: boolean; my_picks_count: number;
};
type Tournament = {
  id: string; name: string; season: string; status: string;
  initial_lives: number; current_matchday: number;
  is_admin: boolean; joined: boolean;
  players_total: number; players_alive: number;
  invite_code: string;
};
type BlockedSign = { team: string; outcome: 'W' | 'D' | 'L'; matchday: number };
type MyPick = { home_team: string; away_team: string; pick: '1' | 'X' | '2'; correct?: boolean | null };
type LeaderboardRow = {
  user_id: string; nickname: string; lives_left: number;
  blocked_signs_count: number; eliminated: boolean; rank: number;
};
type SummaryFixture = {
  home_team: string; away_team: string;
  counts: { '1': number; X: number; '2': number };
  picks: { nickname: string; pick: string }[] | null;
};

export default function SurvivaTournament() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<'play' | 'leaderboard' | 'summary'>('play');
  const [t, setT] = useState<Tournament | null>(null);
  const [md, setMd] = useState<Matchday | null>(null);
  const [myPick, setMyPick] = useState<MyPick | null>(null);
  const [blocked, setBlocked] = useState<BlockedSign[]>([]);
  const [livesLeft, setLivesLeft] = useState<number>(0);
  const [lb, setLb] = useState<LeaderboardRow[]>([]);
  const [summary, setSummary] = useState<{ locked: boolean; fixtures: SummaryFixture[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const detail = await api<Tournament>(`/sv/tournaments/${id}`);
      setT(detail);
      // Load in parallel to keep the UI snappy
      const [cur, blk, board] = await Promise.all([
        api<Matchday>(`/sv/tournaments/${id}/matchdays/current`).catch(() => null),
        detail.joined
          ? api<{ blocked_signs: BlockedSign[]; lives_left: number }>(`/sv/tournaments/${id}/blocked-signs`)
              .catch(() => ({ blocked_signs: [], lives_left: 0 }))
          : Promise.resolve({ blocked_signs: [], lives_left: 0 }),
        api<LeaderboardRow[]>(`/sv/tournaments/${id}/leaderboard`),
      ]);
      setMd(cur);
      setBlocked(blk.blocked_signs);
      setLivesLeft(blk.lives_left);
      setLb(board);
      if (cur && detail.joined) {
        const p = await api<MyPick | { empty: true }>(
          `/sv/tournaments/${id}/matchdays/${cur.id}/my-pick`,
        ).catch(() => null);
        setMyPick(p && !('empty' in p) ? (p as MyPick) : null);
      } else {
        setMyPick(null);
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };
  useFocusEffect(useCallback(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]));

  const loadSummary = async () => {
    if (!md) return;
    try {
      const s = await api<{ locked: boolean; fixtures: SummaryFixture[] }>(
        `/sv/tournaments/${id}/matchdays/${md.id}/summary`,
      );
      setSummary(s);
    } catch (e: any) { alert(e.message); }
  };

  // Given a pick sign for a fixture, return whether it is blocked and which
  // (team, outcome) triggered the block.
  const blockedByPick = (sign: '1' | 'X' | '2', fx: Fixture): BlockedSign | null => {
    const homeOutcome = sign === '1' ? 'W' : sign === 'X' ? 'D' : 'L';
    const awayOutcome = sign === '1' ? 'L' : sign === 'X' ? 'D' : 'W';
    for (const b of blocked) {
      if (b.team === fx.home_team && b.outcome === homeOutcome) return b;
      if (b.team === fx.away_team && b.outcome === awayOutcome) return b;
    }
    return null;
  };

  const submitPick = async (fx: Fixture, sign: '1' | 'X' | '2') => {
    if (!md || !t) return;
    if (md.locked) return;
    if (fx.postponed_before) return;
    if (blockedByPick(sign, fx)) return;
    const key = `${fx.home_team}|${fx.away_team}|${sign}`;
    setSubmitting(key);
    try {
      await api(`/sv/tournaments/${id}/matchdays/${md.id}/pick`, {
        method: 'POST',
        body: { home_team: fx.home_team, away_team: fx.away_team, pick: sign },
      });
      setMyPick({ home_team: fx.home_team, away_team: fx.away_team, pick: sign });
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSubmitting(null);
    }
  };

  const removeFixture = async (fx: Fixture, idx: number) => {
    if (!md || !t?.is_admin) return;
    const ok = await confirmDialog(
      'Rinvia partita',
      `Vuoi rimuovere ${fx.home_team} - ${fx.away_team} da questa giornata? La scelta sarà eliminata per chi l'aveva già selezionata.`,
      { destructive: true, confirmLabel: 'Rimuovi' },
    );
    if (!ok) return;
    try {
      await api(`/sv/tournaments/${id}/matchdays/${md.id}/fixtures/${idx}`, {
        method: 'DELETE',
      });
      // Reload
      await load();
    } catch (e: any) {
      alert(e.message || 'Errore');
    }
  };

  const togglePostponed = async (fx: Fixture, idx: number, next: boolean) => {
    if (!md || !t?.is_admin) return;
    try {
      await api(`/sv/tournaments/${id}/matchdays/${md.id}/fixtures/${idx}`, {
        method: 'PATCH',
        body: { postponed_before: next },
      });
      await load();
    } catch (e: any) {
      alert(e.message || 'Errore');
    }
  };

  const canPlay = useMemo(() => {
    return t?.joined && md && !md.locked && livesLeft > 0;
  }, [t, md, livesLeft]);

  const outcomeLabel = (o: 'W' | 'D' | 'L') =>
    o === 'W' ? 'Vittoria' : o === 'D' ? 'Pareggio' : 'Sconfitta';

  if (loading || !t) {
    return (
      <View style={styles.center}><ActivityIndicator color={COLOR} /></View>
    );
  }

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
              {t.joined
                ? `❤️ ${livesLeft} vite · Giornata ${t.current_matchday}`
                : `Giornata ${t.current_matchday}`}
            </Text>
          </View>
        </View>
        <View style={styles.tabs}>
          {(['play', 'leaderboard', 'summary'] as const).map((k) => (
            <Pressable
              key={k}
              onPress={() => {
                setTab(k);
                if (k === 'summary') loadSummary();
              }}
              style={[styles.tab, tab === k && styles.tabActive]}
              testID={`sv-tab-${k}`}
            >
              <Text style={[styles.tabText, tab === k && { color: COLOR }]}>
                {k === 'play' ? 'Giornata' : k === 'leaderboard' ? 'Classifica' : 'Riassunto'}
              </Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.body}>
        {tab === 'play' && (
          <PlayTab
            t={t} md={md} myPick={myPick} blocked={blocked}
            livesLeft={livesLeft} canPlay={!!canPlay}
            blockedByPick={blockedByPick} outcomeLabel={outcomeLabel}
            onPick={submitPick} submitting={submitting}
            onRemoveFixture={removeFixture}
            onTogglePostponed={togglePostponed}
          />
        )}
        {tab === 'leaderboard' && <LeaderboardTab rows={lb} />}
        {tab === 'summary' && (
          <SummaryTab
            md={md} summary={summary}
            hasPicked={!!myPick} joined={!!t.joined}
          />
        )}
      </ScrollView>
    </View>
  );
}

function PlayTab({
  t, md, myPick, blocked, livesLeft, canPlay,
  blockedByPick, outcomeLabel, onPick, submitting,
  onRemoveFixture, onTogglePostponed,
}: {
  t: Tournament; md: Matchday | null; myPick: MyPick | null;
  blocked: BlockedSign[]; livesLeft: number; canPlay: boolean;
  blockedByPick: (s: '1' | 'X' | '2', fx: Fixture) => BlockedSign | null;
  outcomeLabel: (o: 'W' | 'D' | 'L') => string;
  onPick: (fx: Fixture, s: '1' | 'X' | '2') => void;
  submitting: string | null;
  onRemoveFixture: (fx: Fixture, idx: number) => void;
  onTogglePostponed: (fx: Fixture, idx: number, next: boolean) => void;
}) {
  if (!md) {
    return <Text style={styles.muted}>Nessuna giornata in corso.</Text>;
  }
  if (!t.joined && !t.is_admin) {
    return (
      <View style={styles.notice}>
        <Ionicons name="lock-closed" size={22} color={theme.colors.muted} />
        <Text style={styles.noticeText}>
          Non sei iscritto a questo torneo. Usa il codice invito per entrare.
        </Text>
      </View>
    );
  }
  if (t.joined && livesLeft <= 0) {
    return (
      <View style={[styles.notice, { borderColor: theme.colors.error + '55' }]}>
        <Ionicons name="skull" size={24} color={theme.colors.error} />
        <Text style={[styles.noticeText, { color: theme.colors.error, fontWeight: '800' }]}>
          Sei stato eliminato dal torneo.
        </Text>
      </View>
    );
  }
  return (
    <>
      <View style={styles.notice}>
        <Ionicons name="information-circle" size={18} color={COLOR} />
        <Text style={styles.noticeText}>
          {md.locked
            ? 'Giornata bloccata: le partite sono iniziate.'
            : t.is_admin && !t.joined
              ? 'Vista admin: puoi gestire le partite di questa giornata (rinvii).'
              : `Scegli UNA partita e il segno 1/X/2. ${myPick ? 'Puoi cambiare il tuo pronostico prima del calcio d\u2019inizio.' : ''}`}
        </Text>
      </View>

      {t.is_admin && !md.locked && (
        <View style={styles.adminHint}>
          <Ionicons name="construct" size={14} color={COLOR} />
          <Text style={styles.adminHintText}>
            Modalità admin: tocca il cestino per rimuovere una partita rinviata.
          </Text>
        </View>
      )}

      {blocked.length > 0 && (
        <View style={styles.blockedList}>
          <Text style={styles.blockedTitle}>Segni bloccati ({blocked.length})</Text>
          <View style={styles.blockedRow}>
            {blocked.map((b, i) => (
              <View key={i} style={styles.blockedChip}>
                <Text style={styles.blockedText}>
                  {b.team} → {outcomeLabel(b.outcome)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {md.fixtures.length === 0 && (
        <Text style={styles.muted}>Nessuna partita in calendario per questa giornata.</Text>
      )}

      {md.fixtures.map((fx, i) => {
        const isSelected = myPick && myPick.home_team === fx.home_team && myPick.away_team === fx.away_team;
        const postponed = !!fx.postponed_before;
        return (
          <View
            key={`${fx.home_team}-${fx.away_team}-${i}`}
            style={[
              styles.fxCard,
              isSelected && { borderColor: COLOR, borderWidth: 2 },
              postponed && styles.fxCardPostponed,
            ]}
          >
            <View style={styles.fxTeams}>
              <Text style={[styles.fxTeam, postponed && { color: theme.colors.muted, textDecorationLine: 'line-through' }]}>
                {fx.home_team}
              </Text>
              <Text style={styles.fxVs}>vs</Text>
              <Text style={[styles.fxTeam, postponed && { color: theme.colors.muted, textDecorationLine: 'line-through' }]}>
                {fx.away_team}
              </Text>
              {postponed && (
                <View style={styles.postponedBadge}>
                  <Text style={styles.postponedBadgeText}>Rinviata</Text>
                </View>
              )}
              {t.is_admin && !md.locked && (
                <Pressable
                  onPress={() => onRemoveFixture(fx, i)}
                  hitSlop={8}
                  style={styles.trashBtn}
                  testID={`sv-remove-fx-${i}`}
                >
                  <Ionicons name="trash" size={16} color={theme.colors.error} />
                </Pressable>
              )}
            </View>

            {postponed && t.is_admin && !md.locked && (
              <Pressable
                onPress={() => onTogglePostponed(fx, i, false)}
                style={styles.restoreBtn}
                testID={`sv-restore-fx-${i}`}
              >
                <Ionicons name="refresh" size={14} color={COLOR} />
                <Text style={styles.restoreBtnText}>Ripristina partita</Text>
              </Pressable>
            )}

            {!postponed && (
              <View style={styles.signRow}>
                {(['1', 'X', '2'] as const).map((sign) => {
                  const blockedBy = blockedByPick(sign, fx);
                  const selected = myPick && myPick.home_team === fx.home_team
                    && myPick.away_team === fx.away_team && myPick.pick === sign;
                  const disabled = !canPlay || !!blockedBy;
                  const key = `${fx.home_team}|${fx.away_team}|${sign}`;
                  const isSubmitting = submitting === key;
                  return (
                    <Pressable
                      key={sign}
                      disabled={disabled || isSubmitting}
                      onPress={() => onPick(fx, sign)}
                      style={[
                        styles.signBtn,
                        selected && { backgroundColor: COLOR, borderColor: COLOR },
                        !selected && blockedBy && styles.signBtnBlocked,
                        !selected && !blockedBy && disabled && { opacity: 0.4 },
                      ]}
                      testID={`sv-pick-${fx.home_team}-${sign}`}
                    >
                      {isSubmitting ? (
                        <ActivityIndicator color={selected ? '#fff' : COLOR} size="small" />
                      ) : (
                        <Text
                          style={[
                            styles.signText,
                            selected && { color: '#fff' },
                            !selected && blockedBy && { color: theme.colors.muted, textDecorationLine: 'line-through' },
                          ]}
                        >
                          {sign}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
    </>
  );
}

function LeaderboardTab({ rows }: { rows: LeaderboardRow[] }) {
  if (rows.length === 0) return <Text style={styles.muted}>Nessun partecipante.</Text>;
  return (
    <>
      {rows.map((r) => (
        <View key={r.user_id} style={[styles.lbRow, r.eliminated && { opacity: 0.5 }]}>
          <Text style={styles.lbRank}>#{r.rank}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.lbName}>{r.nickname}</Text>
            {r.eliminated && (
              <Text style={styles.lbEliminated}>Eliminato</Text>
            )}
            {!r.eliminated && r.blocked_signs_count > 0 && (
              <Text style={styles.lbBlockedInfo}>
                {r.blocked_signs_count} segni bloccati
              </Text>
            )}
          </View>
          <View style={styles.livesBadge}>
            <Ionicons name="heart" size={14} color={COLOR} />
            <Text style={styles.livesBadgeText}>{r.lives_left}</Text>
          </View>
        </View>
      ))}
    </>
  );
}

function SummaryTab({
  md, summary, hasPicked, joined,
}: {
  md: Matchday | null;
  summary: { locked: boolean; fixtures: SummaryFixture[] } | null;
  hasPicked: boolean;
  joined: boolean;
}) {
  if (!md) return <Text style={styles.muted}>Nessuna giornata in corso.</Text>;
  if (!summary) return <ActivityIndicator color={COLOR} />;
  return (
    <>
      <View style={styles.notice}>
        <Ionicons name={summary.locked ? 'lock-open' : 'lock-closed'} size={18} color={COLOR} />
        <Text style={styles.noticeText}>
          {summary.locked
            ? 'Giornata iniziata: puoi vedere le scelte di tutti i partecipanti.'
            : 'Solo aggregati fino al calcio d\u2019inizio della prima partita. Le scelte individuali sono nascoste.'}
        </Text>
      </View>
      {joined && !hasPicked && !summary.locked && (
        <View style={[styles.notice, { borderColor: COLOR + '55' }]}>
          <Ionicons name="warning" size={18} color={COLOR} />
          <Text style={[styles.noticeText, { color: COLOR }]}>
            Non hai ancora inviato il tuo pronostico per questa giornata.
          </Text>
        </View>
      )}
      {summary.fixtures.map((fx, i) => {
        const total = fx.counts['1'] + fx.counts['X'] + fx.counts['2'];
        return (
          <View key={i} style={styles.fxCard}>
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
            {summary.locked && fx.picks && fx.picks.length > 0 && (
              <View style={styles.picksList}>
                {fx.picks.map((p, k) => (
                  <View key={k} style={styles.pickChip}>
                    <Text style={styles.pickChipSign}>{p.pick}</Text>
                    <Text style={styles.pickChipName}>{p.nickname}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}
      {summary.fixtures.length === 0 && (
        <Text style={styles.muted}>Nessuna partita in questa giornata.</Text>
      )}
    </>
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
  tabs: {
    flexDirection: 'row', gap: 0,
    paddingHorizontal: theme.spacing.lg,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  tab: {
    flex: 1, paddingVertical: theme.spacing.sm,
    alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: COLOR },
  tabText: { color: theme.colors.muted, fontSize: 13, fontWeight: '700' },
  body: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 48 },
  muted: { color: theme.colors.muted, fontSize: 13, fontStyle: 'italic' },

  notice: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceSecondary,
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  noticeText: { color: theme.colors.onSurface, flex: 1, fontSize: 12, lineHeight: 16 },

  blockedList: {
    padding: theme.spacing.sm, backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  blockedTitle: {
    color: theme.colors.muted, fontSize: 11, fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
  },
  blockedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  blockedChip: {
    backgroundColor: theme.colors.error + '15',
    borderWidth: 1, borderColor: theme.colors.error + '55',
    borderRadius: theme.radius.pill,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  blockedText: { color: theme.colors.error, fontSize: 11, fontWeight: '700' },

  fxCard: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md, borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md, gap: theme.spacing.sm,
  },
  fxCardPostponed: {
    opacity: 0.65,
    borderStyle: 'dashed',
  },
  postponedBadge: {
    backgroundColor: theme.colors.warning + '25',
    borderColor: theme.colors.warning + '55',
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  postponedBadgeText: {
    color: theme.colors.warning, fontSize: 11, fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  trashBtn: {
    padding: 6, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.error + '15',
  },
  restoreBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: COLOR + '18',
    borderWidth: 1, borderColor: COLOR + '55',
  },
  restoreBtnText: { color: COLOR, fontSize: 12, fontWeight: '700' },
  adminHint: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: theme.spacing.sm,
    backgroundColor: COLOR + '12',
    borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: COLOR + '33',
  },
  adminHintText: { color: COLOR, fontSize: 11, fontWeight: '600', flex: 1 },
  fxTeams: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  fxTeam: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 15, flex: 1 },
  fxVs: { color: theme.colors.muted, fontSize: 11 },
  signRow: { flexDirection: 'row', gap: theme.spacing.sm },
  signBtn: {
    flex: 1, paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    alignItems: 'center', justifyContent: 'center',
    minHeight: 48,
  },
  signBtnBlocked: {
    backgroundColor: theme.colors.surfaceTertiary,
    borderColor: theme.colors.border,
  },
  signText: { color: theme.colors.onSurface, fontWeight: '900', fontSize: 20 },

  lbRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md, borderWidth: 1,
    borderColor: theme.colors.border,
  },
  lbRank: {
    color: COLOR, fontWeight: '900', fontSize: 16, minWidth: 32,
  },
  lbName: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 14 },
  lbEliminated: { color: theme.colors.error, fontSize: 11, marginTop: 2 },
  lbBlockedInfo: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  livesBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLOR + '18',
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  livesBadgeText: { color: COLOR, fontWeight: '900', fontSize: 14 },

  summaryRow: { flexDirection: 'row', gap: theme.spacing.sm },
  summaryCell: {
    flex: 1, alignItems: 'center',
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  summarySign: { color: COLOR, fontWeight: '800', fontSize: 15 },
  summaryCount: {
    color: theme.colors.onSurface, fontWeight: '900',
    fontSize: 22, marginTop: 2,
  },
  summaryPct: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  picksList: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6,
  },
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
