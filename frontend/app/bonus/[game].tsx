/*
 * /bonus/[game] — Play + history view for a single Bonus game.
 *
 * Per-subscription model: a user with N subscriptions (rooms/tournaments/
 * leagues) plays the same question N times — one pick per subscription,
 * each with an independent reward on win.
 *
 * The Admin config lives in /admin/bonus (Impostazioni → Gestione Bonus),
 * so this page is now player-focused.
 */
import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  TextInput, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session, User } from '@/src/api';
import { theme } from '@/src/theme';

type Game = 'tiket' | 'score' | 'fanta' | 'survival';
type BonusType = 'exact_score' | 'first_scorer';

type Subscription = {
  id: string;
  name: string;
  kind: string;
  color?: string;
  my_pick: null | {
    id: string;
    pick: any;
    is_correct: boolean | null;
    reward_details?: any;
  };
};

type Available = {
  game: Game;
  bonus_type: BonusType;
  eligible: boolean;
  season: string;
  config: null | {
    id: string;
    matchday: number;
    lock_at: string | null;
    status: 'open' | 'locked' | 'settled';
    big_match: { home_team: string; away_team: string; kickoff_iso?: string } | null;
    result: any;
  };
  subscriptions: Subscription[];
  fixtures: { home_team: string; away_team: string; kickoff_iso?: string | null }[];
};

type HistoryRow = {
  id: string; matchday: number; game: Game;
  subscription_id: string; subscription_name?: string;
  pick: any; is_correct: boolean | null;
  reward_details: any; submitted_at: string;
};

const META: Record<Game, { name: string; color: string; parent: string; reward: string; icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap; subLabel: string; subPlural: string }> = {
  tiket:    { name: 'Bonus Tiket',    color: '#FFB300', parent: 'TheBestTiket',  reward: 'Giocata extra', icon: 'trophy',   subLabel: 'Stanza', subPlural: 'stanze' },
  score:    { name: 'Bonus Score',    color: '#3B82F6', parent: 'ScoreAndLive',  reward: '+1 Vita',       icon: 'pulse',    subLabel: 'Torneo', subPlural: 'tornei' },
  fanta:    { name: 'Bonus Fanta',    color: '#A855F7', parent: 'FantaGiornata', reward: '+3 Punti',      icon: 'football', subLabel: 'Lega',   subPlural: 'leghe' },
  survival: { name: 'Bonus Survival', color: '#EF4444', parent: 'Survival 2.0',  reward: '+1 Vita',       icon: 'heart',    subLabel: 'Torneo', subPlural: 'tornei' },
};

const SEASON = '2026-27';

export default function BonusGame() {
  const { game: gameParam } = useLocalSearchParams<{ game: string }>();
  const game = (gameParam as Game) in META ? (gameParam as Game) : 'tiket';
  const meta = META[game];
  const router = useRouter();

  const [me, setMe] = useState<User | null>(null);
  const [data, setData] = useState<Available | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await session.load();
      setMe(s.user);
      const [av, hs] = await Promise.all([
        api<Available>(`/bonus/available?game=${game}&season=${SEASON}`),
        api<HistoryRow[]>(`/bonus/history?game=${game}&season=${SEASON}&limit=30`).catch(() => []),
      ]);
      setData(av);
      setHistory(hs);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  }, [game]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !data) {
    return <View style={styles.center}><ActivityIndicator color={meta.color} /></View>;
  }

  const isAdmin = me?.role === 'admin';
  const canPlay = !!data.config && data.config.status === 'open';

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: meta.color + '25' }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <View style={[styles.headerIcon, { backgroundColor: meta.color }]}>
            <Ionicons name={meta.icon} size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{meta.name}</Text>
            <Text style={styles.sub}>{meta.parent} · Premio: {meta.reward}</Text>
          </View>
          {isAdmin && (
            <Pressable onPress={() => router.push('/admin/bonus')} hitSlop={10} testID="bonus-admin-btn">
              <Ionicons name="construct" size={22} color={meta.color} />
            </Pressable>
          )}
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={meta.color}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
        />}
      >
        {!data.eligible && (
          <View style={[styles.notice, { borderColor: theme.colors.error }]}>
            <Ionicons name="lock-closed" size={18} color={theme.colors.error} />
            <Text style={styles.noticeText}>
              {game === 'fanta'
                ? `Non sei iscritto a nessuna lega di ${meta.parent}. Iscriviti per giocare al bonus.`
                : game === 'tiket'
                  ? `Non sei iscritto a nessuna stanza di ${meta.parent}. Iscriviti per giocare al bonus.`
                  : `Non hai tornei attivi di ${meta.parent}. Il bonus è disponibile solo se sei ancora in gara (vite > 0) in almeno un torneo. Se sei stato eliminato, riproverai al prossimo torneo.`}
            </Text>
          </View>
        )}

        {!data.config && data.eligible && (
          <View style={styles.notice}>
            <Ionicons name="hourglass" size={18} color={theme.colors.muted} />
            <Text style={styles.noticeText}>
              Nessun bonus attivo. L&apos;admin deve configurarlo dalle Impostazioni → Gestione Giochi Bonus.
            </Text>
          </View>
        )}

        {data.config && (
          <>
            <MatchdayCard data={data} color={meta.color} />

            {data.subscriptions.length > 1 && (
              <View style={styles.multiHint}>
                <Ionicons name="ribbon" size={16} color={meta.color} />
                <Text style={styles.multiHintText}>
                  Hai {data.subscriptions.length} {meta.subPlural}: gioca il bonus per ognun{game === 'fanta' ? 'a' : 'o'}.
                </Text>
              </View>
            )}

            {data.subscriptions.map((sub) => (
              <SubscriptionCard
                key={sub.id}
                game={game}
                subscription={sub}
                bonusType={data.bonus_type}
                color={meta.color}
                subLabel={meta.subLabel}
                canPlay={canPlay}
                configStatus={data.config!.status}
                season={SEASON}
                onReload={load}
              />
            ))}
          </>
        )}

        {history.length > 0 && (
          <View style={styles.histBox}>
            <Text style={styles.histTitle}>Storico giornate</Text>
            {history.map((h) => (
              <HistoryRowView key={h.id} h={h} color={meta.color} type={data.bonus_type} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// -------------------------------------------------------------------------
// Subscription pick card
// -------------------------------------------------------------------------
function SubscriptionCard({
  game, subscription, bonusType, color, subLabel, canPlay, configStatus, season, onReload,
}: {
  game: Game;
  subscription: Subscription;
  bonusType: BonusType;
  color: string;
  subLabel: string;
  canPlay: boolean;
  configStatus: 'open' | 'locked' | 'settled';
  season: string;
  onReload: () => Promise<void>;
}) {
  const [home, setHome] = useState(
    bonusType === 'exact_score' && subscription.my_pick?.pick?.home_score !== undefined
      ? String(subscription.my_pick.pick.home_score) : ''
  );
  const [away, setAway] = useState(
    bonusType === 'exact_score' && subscription.my_pick?.pick?.away_score !== undefined
      ? String(subscription.my_pick.pick.away_score) : ''
  );
  const [scorer, setScorer] = useState(
    bonusType === 'first_scorer' ? (subscription.my_pick?.pick?.player_name ?? '') : ''
  );
  const [submitting, setSubmitting] = useState(false);

  const submitExact = async () => {
    const h = parseInt(home, 10);
    const a = parseInt(away, 10);
    if (isNaN(h) || h < 0 || h > 30) return alert('Gol casa non valido (0-30)');
    if (isNaN(a) || a < 0 || a > 30) return alert('Gol trasferta non valido (0-30)');
    setSubmitting(true);
    try {
      await api('/bonus/picks/exact', {
        method: 'POST',
        body: {
          game, season, subscription_id: subscription.id,
          home_score: h, away_score: a,
        },
      });
      await onReload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const submitScorer = async () => {
    const name = scorer.trim();
    if (!name) return alert('Inserisci il nome del giocatore');
    setSubmitting(true);
    try {
      await api('/bonus/picks/scorer', {
        method: 'POST',
        body: {
          game, season, subscription_id: subscription.id,
          player_name: name,
        },
      });
      await onReload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const hasPick = !!subscription.my_pick;
  const settled = configStatus === 'settled';
  const isCorrect = subscription.my_pick?.is_correct;

  return (
    <View style={[styles.subCard, { borderColor: color }]}>
      <View style={styles.subHeader}>
        <View style={[styles.subDot, { backgroundColor: color }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.subTag}>{subLabel.toUpperCase()}</Text>
          <Text style={styles.subName}>{subscription.name}</Text>
        </View>
        {hasPick && !settled && (
          <View style={[styles.pickPill, { backgroundColor: color + '22', borderColor: color }]}>
            <Ionicons name="checkmark" size={12} color={color} />
            <Text style={[styles.pickPillText, { color }]}>Inviato</Text>
          </View>
        )}
      </View>

      {bonusType === 'exact_score' ? (
        <View style={styles.scoreRow}>
          <View style={styles.scoreCell}>
            <Text style={styles.scoreLabel}>CASA</Text>
            <TextInput
              style={[styles.scoreInput, { borderColor: color }]}
              value={home} onChangeText={setHome}
              keyboardType="number-pad" maxLength={2}
              editable={canPlay}
              testID={`bonus-home-${subscription.id}`}
            />
          </View>
          <Text style={[styles.scoreDash, { color }]}>-</Text>
          <View style={styles.scoreCell}>
            <Text style={styles.scoreLabel}>TRASFERTA</Text>
            <TextInput
              style={[styles.scoreInput, { borderColor: color }]}
              value={away} onChangeText={setAway}
              keyboardType="number-pad" maxLength={2}
              editable={canPlay}
              testID={`bonus-away-${subscription.id}`}
            />
          </View>
        </View>
      ) : (
        <TextInput
          style={[styles.scorerInput, { borderColor: color }]}
          value={scorer} onChangeText={setScorer}
          placeholder="Es. Lautaro Martinez"
          placeholderTextColor={theme.colors.muted}
          editable={canPlay}
          autoCapitalize="words"
          testID={`bonus-scorer-${subscription.id}`}
        />
      )}

      <Pressable
        disabled={!canPlay || submitting}
        onPress={bonusType === 'exact_score' ? submitExact : submitScorer}
        style={[
          styles.submitBtn,
          { backgroundColor: color },
          (!canPlay || submitting) && { opacity: 0.4 },
        ]}
        testID={`bonus-submit-${subscription.id}`}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitBtnText}>
            {hasPick ? 'Aggiorna pronostico' : 'Invia pronostico'}
          </Text>
        )}
      </Pressable>

      {settled && isCorrect !== null && (
        <View style={[styles.resultBadge, {
          backgroundColor: isCorrect ? theme.colors.success + '22' : theme.colors.error + '22',
          borderColor: isCorrect ? theme.colors.success : theme.colors.error,
        }]}>
          <Ionicons name={isCorrect ? 'trophy' : 'close-circle'} size={16}
            color={isCorrect ? theme.colors.success : theme.colors.error} />
          <Text style={{
            color: isCorrect ? theme.colors.success : theme.colors.error,
            fontWeight: '800', fontSize: 13,
          }}>
            {isCorrect ? '🏆 Hai vinto il bonus!' : 'Non hai indovinato'}
          </Text>
        </View>
      )}
    </View>
  );
}

// -------------------------------------------------------------------------
// Matchday card (shared big match / question header)
// -------------------------------------------------------------------------
function MatchdayCard({ data, color }: { data: Available; color: string }) {
  const c = data.config!;
  return (
    <View style={[styles.matchCard, { borderColor: color }]}>
      <View style={styles.matchRow}>
        <Text style={styles.matchLabel}>Giornata</Text>
        <Text style={[styles.matchMd, { color }]}>#{c.matchday}</Text>
      </View>
      {data.bonus_type === 'exact_score' && c.big_match && (
        <>
          <Text style={styles.bigMatchTitle}>BIG MATCH</Text>
          <View style={styles.teamsRow}>
            <Text style={styles.teamName}>{c.big_match.home_team}</Text>
            <Text style={[styles.vs, { color }]}>VS</Text>
            <Text style={styles.teamName}>{c.big_match.away_team}</Text>
          </View>
        </>
      )}
      {data.bonus_type === 'first_scorer' && (
        <Text style={styles.firstScorerTitle}>Indovina il PRIMO MARCATORE della giornata</Text>
      )}
      <Countdown iso={c.lock_at} color={color} settled={c.status === 'settled'} />
      {c.status === 'settled' && c.result && (
        <View style={[styles.resultBox, { backgroundColor: color + '22' }]}>
          <Ionicons name="checkmark-circle" size={16} color={color} />
          <Text style={[styles.resultText, { color }]}>
            Risultato:{' '}
            {data.bonus_type === 'exact_score'
              ? `${c.result.home_score} - ${c.result.away_score}`
              : c.result.player_name}
          </Text>
        </View>
      )}
    </View>
  );
}

function Countdown({ iso, color, settled }: { iso: string | null; color: string; settled: boolean }) {
  const [now, setNow] = useState(Date.now());
  useFocusEffect(useCallback(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []));
  if (settled) {
    return (
      <View style={styles.cdLocked}>
        <Ionicons name="flag" size={13} color={theme.colors.muted} />
        <Text style={styles.cdLockedText}>Bonus concluso</Text>
      </View>
    );
  }
  if (!iso) return null;
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) {
    return (
      <View style={styles.cdLocked}>
        <Ionicons name="lock-closed" size={13} color={theme.colors.muted} />
        <Text style={styles.cdLockedText}>Countdown scaduto — pronostici bloccati</Text>
      </View>
    );
  }
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return (
    <View style={[styles.cdBox, { backgroundColor: color + '22' }]}>
      <Ionicons name="time" size={13} color={color} />
      <Text style={[styles.cdText, { color }]}>
        Chiusura tra {d > 0 ? `${d}g ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`}
      </Text>
    </View>
  );
}

function HistoryRowView({ h, color, type }: { h: HistoryRow; color: string; type: BonusType }) {
  const pickLabel = type === 'exact_score'
    ? `${h.pick?.home_score ?? '-'} - ${h.pick?.away_score ?? '-'}`
    : (h.pick?.player_name ?? '-');
  return (
    <View style={styles.histRow}>
      <Text style={styles.histMd}>G{h.matchday}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.histPick}>{pickLabel}</Text>
        {h.subscription_name && <Text style={styles.histSub}>{h.subscription_name}</Text>}
      </View>
      {h.is_correct === true && (
        <View style={[styles.histBadge, { backgroundColor: color + '33' }]}>
          <Ionicons name="trophy" size={12} color={color} />
          <Text style={[styles.histBadgeText, { color }]}>Vinto</Text>
        </View>
      )}
      {h.is_correct === false && (
        <View style={[styles.histBadge, { backgroundColor: theme.colors.muted + '33' }]}>
          <Text style={[styles.histBadgeText, { color: theme.colors.muted }]}>Perso</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  headerIcon: { width: 44, height: 44, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.colors.onSurface, fontSize: 20, fontWeight: '800' },
  sub: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  body: { padding: theme.spacing.lg, paddingBottom: 120, gap: theme.spacing.lg },

  notice: {
    flexDirection: 'row', gap: theme.spacing.sm, padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  noticeText: { color: theme.colors.onSurfaceSecondary, fontSize: 13, flex: 1, lineHeight: 18 },

  matchCard: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md, borderWidth: 1.5,
    padding: theme.spacing.lg, gap: theme.spacing.sm,
  },
  matchRow: { flexDirection: 'row', alignItems: 'center' },
  matchLabel: { color: theme.colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', flex: 1 },
  matchMd: { fontSize: 18, fontWeight: '800' },
  bigMatchTitle: { color: theme.colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginTop: 4 },
  firstScorerTitle: { color: theme.colors.onSurface, fontSize: 15, fontWeight: '700', textAlign: 'center', marginVertical: 8 },
  teamsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, marginVertical: 6,
  },
  teamName: { color: theme.colors.onSurface, fontSize: 17, fontWeight: '800', flex: 1, textAlign: 'center' },
  vs: { fontSize: 13, fontWeight: '800' },

  cdBox: {
    flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill,
  },
  cdText: { fontSize: 12, fontWeight: '800' },
  cdLocked: {
    flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceTertiary,
  },
  cdLockedText: { color: theme.colors.muted, fontSize: 12, fontWeight: '700' },
  resultBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    marginTop: 4,
  },
  resultText: { fontSize: 13, fontWeight: '800' },

  multiHint: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.sm,
    borderLeftWidth: 3,
  },
  multiHintText: { color: theme.colors.onSurfaceSecondary, fontSize: 12, flex: 1, fontWeight: '600' },

  subCard: {
    backgroundColor: theme.colors.surfaceSecondary,
    padding: theme.spacing.lg, borderRadius: theme.radius.md,
    gap: theme.spacing.md,
    borderWidth: 1.5,
  },
  subHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  subDot: { width: 10, height: 10, borderRadius: 5 },
  subTag: {
    color: theme.colors.muted, fontSize: 10, fontWeight: '800',
    letterSpacing: 0.8,
  },
  subName: { color: theme.colors.onSurface, fontSize: 15, fontWeight: '800' },
  pickPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: theme.radius.pill, borderWidth: 1,
  },
  pickPillText: { fontSize: 11, fontWeight: '800' },

  scoreRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12,
  },
  scoreCell: { flex: 1, alignItems: 'center', gap: 4 },
  scoreLabel: { color: theme.colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  scoreInput: {
    width: 80, height: 72,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md, borderWidth: 2,
    color: theme.colors.onSurface, fontSize: 32, fontWeight: '800',
    textAlign: 'center',
  },
  scoreDash: { fontSize: 32, fontWeight: '800', marginTop: 20 },
  scorerInput: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md, borderWidth: 1.5,
    color: theme.colors.onSurface, fontSize: 16,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  submitBtn: {
    paddingVertical: 13, borderRadius: theme.radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  submitBtnText: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 0.3 },
  resultBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    borderWidth: 1,
  },

  histBox: {
    backgroundColor: theme.colors.surfaceSecondary,
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    gap: theme.spacing.sm,
  },
  histTitle: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 14 },
  histRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: theme.spacing.sm, backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
  },
  histMd: { color: theme.colors.muted, fontWeight: '800', fontSize: 12, width: 32 },
  histPick: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 13 },
  histSub: { color: theme.colors.muted, fontSize: 10, marginTop: 1 },
  histBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill,
  },
  histBadgeText: { fontSize: 11, fontWeight: '800' },
});
