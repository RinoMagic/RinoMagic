/*
 * /bonus/[game] — Play + admin view for a single Bonus game.
 *
 * Adaptive UI:
 *  - exact_score bonuses (Tiket + Survival): show the Big Match card, form
 *    with two number inputs (home / away goals) and countdown to kickoff.
 *  - first_scorer bonuses (Score + Fanta): show a single free-text input,
 *    countdown to the earliest matchday kickoff.
 *
 * Admin section (visible only to admins):
 *  - For exact_score: dropdown of matchday fixtures to pick the Big Match.
 *  - For first_scorer: no dropdown (question is implicit).
 *  - Settle form: enter final result / first scorer, trigger reward grant.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  TextInput, RefreshControl, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session, User } from '@/src/api';
import { theme } from '@/src/theme';

type Game = 'tiket' | 'score' | 'fanta' | 'survival';
type BonusType = 'exact_score' | 'first_scorer';

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
  my_pick: null | {
    pick: any;
    is_correct: boolean | null;
    reward_details?: any;
  };
  fixtures: { home_team: string; away_team: string; kickoff_iso?: string | null }[];
};

type HistoryRow = {
  id: string; matchday: number; game: Game;
  pick: any; is_correct: boolean | null;
  reward_details: any; submitted_at: string;
};

const META: Record<Game, { name: string; color: string; parent: string; reward: string; icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap }> = {
  tiket:    { name: 'Bonus Tiket',    color: '#FFB300', parent: 'TheBestTiket', reward: 'Giocata extra', icon: 'trophy' },
  score:    { name: 'Bonus Score',    color: '#3B82F6', parent: 'ScoreAndLive', reward: '+1 Vita',       icon: 'pulse' },
  fanta:    { name: 'Bonus Fanta',    color: '#A855F7', parent: 'FantaGiornata', reward: '+3 Punti',     icon: 'football' },
  survival: { name: 'Bonus Survival', color: '#EF4444', parent: 'Survival 2.0', reward: '+1 Vita',       icon: 'heart' },
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
  const [submitting, setSubmitting] = useState(false);
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [scorer, setScorer] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await session.load();
      setMe(s.user);
      const [av, hs] = await Promise.all([
        api<Available>(`/bonus/available?game=${game}&season=${SEASON}`),
        api<HistoryRow[]>(`/bonus/history?game=${game}&season=${SEASON}&limit=10`).catch(() => []),
      ]);
      setData(av);
      setHistory(hs);
      // Prefill form with existing pick if any
      if (av.my_pick && av.bonus_type === 'exact_score') {
        setHomeScore(String(av.my_pick.pick?.home_score ?? ''));
        setAwayScore(String(av.my_pick.pick?.away_score ?? ''));
      } else if (av.my_pick && av.bonus_type === 'first_scorer') {
        setScorer(av.my_pick.pick?.player_name ?? '');
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  }, [game]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submitExact = async () => {
    const h = parseInt(homeScore, 10);
    const a = parseInt(awayScore, 10);
    if (isNaN(h) || h < 0 || h > 30) return alert('Gol casa non valido (0-30)');
    if (isNaN(a) || a < 0 || a > 30) return alert('Gol trasferta non valido (0-30)');
    setSubmitting(true);
    try {
      await api('/bonus/picks/exact', {
        method: 'POST',
        body: { game, season: SEASON, home_score: h, away_score: a },
      });
      await load();
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
        body: { game, season: SEASON, player_name: name },
      });
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !data) {
    return <View style={styles.center}><ActivityIndicator color={meta.color} /></View>;
  }

  const canSubmit = !!data.config && data.config.status === 'open' && data.eligible;
  const isAdmin = me?.role === 'admin';

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
            <Pressable onPress={() => setAdminOpen(true)} hitSlop={10} testID="bonus-admin-btn">
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
              Non sei iscritto a nessun torneo/stanza di {meta.parent}. Iscriviti per giocare al bonus.
            </Text>
          </View>
        )}

        {!data.config && (
          <View style={styles.notice}>
            <Ionicons name="hourglass" size={18} color={theme.colors.muted} />
            <Text style={styles.noticeText}>
              Nessun bonus attivo per questa giornata. Torna quando l&apos;admin lo avrà configurato.
            </Text>
          </View>
        )}

        {data.config && (
          <>
            <MatchdayCard data={data} color={meta.color} />
            {data.bonus_type === 'exact_score' ? (
              <ExactScoreForm
                canSubmit={canSubmit && !!data.config.big_match}
                color={meta.color}
                home={homeScore} away={awayScore}
                setHome={setHomeScore} setAway={setAwayScore}
                submitting={submitting}
                onSubmit={submitExact}
                existing={data.my_pick}
                config={data.config}
              />
            ) : (
              <ScorerForm
                canSubmit={canSubmit}
                color={meta.color}
                value={scorer} setValue={setScorer}
                submitting={submitting}
                onSubmit={submitScorer}
                existing={data.my_pick}
                config={data.config}
              />
            )}
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

      {isAdmin && data.config && (
        <AdminModal
          visible={adminOpen}
          onClose={() => { setAdminOpen(false); load(); }}
          game={game}
          meta={meta}
          data={data}
        />
      )}
      {isAdmin && !data.config && (
        <AdminModal
          visible={adminOpen}
          onClose={() => { setAdminOpen(false); load(); }}
          game={game}
          meta={meta}
          data={data}
        />
      )}
    </View>
  );
}

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
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
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

function ExactScoreForm({
  canSubmit, color, home, away, setHome, setAway, submitting, onSubmit, existing, config,
}: {
  canSubmit: boolean; color: string;
  home: string; away: string;
  setHome: (v: string) => void; setAway: (v: string) => void;
  submitting: boolean; onSubmit: () => void;
  existing: Available['my_pick']; config: NonNullable<Available['config']>;
}) {
  return (
    <View style={styles.formBox}>
      <Text style={styles.formTitle}>Il tuo pronostico</Text>
      <View style={styles.scoreRow}>
        <View style={styles.scoreCell}>
          <Text style={styles.scoreLabel}>CASA</Text>
          <TextInput
            style={[styles.scoreInput, { borderColor: color }]}
            value={home} onChangeText={setHome}
            keyboardType="number-pad" maxLength={2}
            editable={canSubmit}
            testID="bonus-home-score"
          />
        </View>
        <Text style={[styles.scoreDash, { color }]}>-</Text>
        <View style={styles.scoreCell}>
          <Text style={styles.scoreLabel}>TRASFERTA</Text>
          <TextInput
            style={[styles.scoreInput, { borderColor: color }]}
            value={away} onChangeText={setAway}
            keyboardType="number-pad" maxLength={2}
            editable={canSubmit}
            testID="bonus-away-score"
          />
        </View>
      </View>
      <SubmitBtn
        color={color} canSubmit={canSubmit}
        submitting={submitting}
        onSubmit={onSubmit}
        hasExisting={!!existing}
      />
      {existing && config.status === 'settled' && (
        <ResultBadge is_correct={existing.is_correct} color={color} />
      )}
    </View>
  );
}

function ScorerForm({
  canSubmit, color, value, setValue, submitting, onSubmit, existing, config,
}: {
  canSubmit: boolean; color: string;
  value: string; setValue: (v: string) => void;
  submitting: boolean; onSubmit: () => void;
  existing: Available['my_pick']; config: NonNullable<Available['config']>;
}) {
  return (
    <View style={styles.formBox}>
      <Text style={styles.formTitle}>Il tuo pronostico</Text>
      <TextInput
        style={[styles.scorerInput, { borderColor: color }]}
        value={value} onChangeText={setValue}
        placeholder="Es. Lautaro Martinez"
        placeholderTextColor={theme.colors.muted}
        editable={canSubmit}
        autoCapitalize="words"
        testID="bonus-scorer-input"
      />
      <SubmitBtn
        color={color} canSubmit={canSubmit}
        submitting={submitting}
        onSubmit={onSubmit}
        hasExisting={!!existing}
      />
      {existing && config.status === 'settled' && (
        <ResultBadge is_correct={existing.is_correct} color={color} />
      )}
    </View>
  );
}

function SubmitBtn({
  color, canSubmit, submitting, onSubmit, hasExisting,
}: {
  color: string; canSubmit: boolean; submitting: boolean;
  onSubmit: () => void; hasExisting: boolean;
}) {
  return (
    <Pressable
      disabled={!canSubmit || submitting}
      onPress={onSubmit}
      style={[
        styles.submitBtn,
        { backgroundColor: color },
        (!canSubmit || submitting) && { opacity: 0.4 },
      ]}
      testID="bonus-submit"
    >
      {submitting ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.submitBtnText}>
          {hasExisting ? 'Aggiorna pronostico' : 'Invia pronostico'}
        </Text>
      )}
    </Pressable>
  );
}

function ResultBadge({ is_correct, color }: { is_correct: boolean | null; color: string }) {
  if (is_correct === null) return null;
  return (
    <View style={[styles.resultBadge, {
      backgroundColor: is_correct ? theme.colors.success + '22' : theme.colors.error + '22',
      borderColor: is_correct ? theme.colors.success : theme.colors.error,
    }]}>
      <Ionicons name={is_correct ? 'trophy' : 'close-circle'} size={16}
        color={is_correct ? theme.colors.success : theme.colors.error} />
      <Text style={{
        color: is_correct ? theme.colors.success : theme.colors.error,
        fontWeight: '800', fontSize: 13,
      }}>
        {is_correct ? '🏆 Hai vinto il bonus!' : 'Non hai indovinato'}
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
      <Text style={styles.histPick}>{pickLabel}</Text>
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

// -------------------------------------------------------------------------
// Admin modal (create/settle bonus)
// -------------------------------------------------------------------------

function AdminModal({
  visible, onClose, game, meta, data,
}: {
  visible: boolean; onClose: () => void;
  game: Game;
  meta: { color: string; name: string };
  data: Available;
}) {
  const isExact = data.bonus_type === 'exact_score';
  const [selectedFx, setSelectedFx] = useState<string>('');
  const [matchday, setMatchday] = useState<string>(String(data.config?.matchday || '1'));
  const [homeR, setHomeR] = useState('');
  const [awayR, setAwayR] = useState('');
  const [scorerR, setScorerR] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setMatchday(String(data.config?.matchday || '1'));
      setSelectedFx(data.config?.big_match
        ? `${data.config.big_match.home_team}|${data.config.big_match.away_team}`
        : '');
      setHomeR('');
      setAwayR('');
      setScorerR('');
    }
  }, [visible, data]);

  const createConfig = async () => {
    setBusy(true);
    try {
      const md = parseInt(matchday, 10);
      if (isNaN(md) || md < 1 || md > 38) return alert('Giornata non valida');
      const body: any = { season: SEASON, matchday: md, bonus_type: data.bonus_type };
      if (isExact) {
        if (!selectedFx) return alert('Scegli il Big Match dal calendario');
        const [home_team, away_team] = selectedFx.split('|');
        body.big_match = { home_team, away_team };
      }
      await api('/bonus/configs', { method: 'POST', body });
      onClose();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const settle = async () => {
    if (!data.config) return;
    setBusy(true);
    try {
      if (isExact) {
        const h = parseInt(homeR, 10);
        const a = parseInt(awayR, 10);
        if (isNaN(h) || isNaN(a)) return alert('Inserisci il risultato finale');
        const res = await api<any>(`/bonus/configs/${data.config.id}/settle-exact`, {
          method: 'POST', body: { home_score: h, away_score: a },
        });
        alert(`Bonus liquidato ✓\nVincitori: ${res.winners} su ${res.total_picks} pronostici`);
      } else {
        const name = scorerR.trim();
        if (!name) return alert('Inserisci il nome del primo marcatore');
        const res = await api<any>(`/bonus/configs/${data.config.id}/settle-scorer`, {
          method: 'POST', body: { player_name: name },
        });
        alert(`Bonus liquidato ✓\nVincitori: ${res.winners} su ${res.total_picks} pronostici`);
      }
      onClose();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>⚙️ Admin — {meta.name}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={theme.colors.onSurface} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            {!data.config && (
              <>
                <Text style={styles.modalSection}>1) Crea bonus per una giornata</Text>
                <Text style={styles.modalLabel}>Giornata (1-38)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={matchday} onChangeText={setMatchday}
                  keyboardType="number-pad"
                />
                {isExact && (
                  <>
                    <Text style={styles.modalLabel}>Big Match (dal calendario)</Text>
                    <ScrollView style={styles.fxList} nestedScrollEnabled>
                      {data.fixtures.map((fx) => {
                        const key = `${fx.home_team}|${fx.away_team}`;
                        const active = selectedFx === key;
                        return (
                          <Pressable
                            key={key} onPress={() => setSelectedFx(key)}
                            style={[
                              styles.fxItem,
                              active && { backgroundColor: meta.color + '33', borderColor: meta.color },
                            ]}
                          >
                            <Text style={styles.fxItemText}>{fx.home_team} vs {fx.away_team}</Text>
                            {active && <Ionicons name="checkmark-circle" size={16} color={meta.color} />}
                          </Pressable>
                        );
                      })}
                      {data.fixtures.length === 0 && (
                        <Text style={styles.modalHint}>
                          Nessuna partita in calendario per questa giornata. Carica prima il calendario in ScoreAndLive.
                        </Text>
                      )}
                    </ScrollView>
                  </>
                )}
                <Pressable
                  disabled={busy} onPress={createConfig}
                  style={[styles.modalBtn, { backgroundColor: meta.color }, busy && { opacity: 0.5 }]}
                >
                  {busy ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.modalBtnText}>Crea bonus giornata</Text>}
                </Pressable>
              </>
            )}
            {data.config && data.config.status !== 'settled' && (
              <>
                <Text style={styles.modalSection}>Liquida il bonus (giornata {data.config.matchday})</Text>
                {isExact && (
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalLabel}>Gol casa</Text>
                      <TextInput style={styles.modalInput} value={homeR} onChangeText={setHomeR} keyboardType="number-pad" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalLabel}>Gol trasferta</Text>
                      <TextInput style={styles.modalInput} value={awayR} onChangeText={setAwayR} keyboardType="number-pad" />
                    </View>
                  </View>
                )}
                {!isExact && (
                  <>
                    <Text style={styles.modalLabel}>Primo marcatore (nome esatto)</Text>
                    <TextInput
                      style={styles.modalInput} value={scorerR} onChangeText={setScorerR}
                      placeholder="Es. Lautaro Martinez"
                      placeholderTextColor={theme.colors.muted}
                      autoCapitalize="words"
                    />
                  </>
                )}
                <Pressable
                  disabled={busy} onPress={settle}
                  style={[styles.modalBtn, { backgroundColor: meta.color }, busy && { opacity: 0.5 }]}
                >
                  {busy ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.modalBtnText}>Liquida bonus e assegna premi</Text>}
                </Pressable>
              </>
            )}
            {data.config?.status === 'settled' && (
              <View style={styles.settledInfo}>
                <Ionicons name="checkmark-done" size={20} color={theme.colors.success} />
                <Text style={styles.settledText}>Bonus di questa giornata già liquidato.</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
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

  formBox: {
    backgroundColor: theme.colors.surfaceSecondary,
    padding: theme.spacing.lg, borderRadius: theme.radius.md,
    gap: theme.spacing.md,
  },
  formTitle: {
    color: theme.colors.onSurface, fontSize: 14, fontWeight: '800',
    letterSpacing: 0.4, textTransform: 'uppercase',
  },
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
    paddingVertical: 14, borderRadius: theme.radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  submitBtnText: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.3 },
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
  histPick: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 13, flex: 1 },
  histBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill,
  },
  histBadgeText: { fontSize: 11, fontWeight: '800' },

  // Admin modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000099' },
  modalCard: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.lg, borderTopRightRadius: theme.radius.lg,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center',
    padding: theme.spacing.lg,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  modalTitle: { color: theme.colors.onSurface, fontSize: 17, fontWeight: '800', flex: 1 },
  modalSection: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 14 },
  modalLabel: {
    color: theme.colors.muted, fontSize: 12, fontWeight: '700',
    letterSpacing: 0.4, textTransform: 'uppercase',
  },
  modalInput: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border,
    color: theme.colors.onSurface, fontSize: 15,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  modalHint: { color: theme.colors.muted, fontSize: 12, fontStyle: 'italic', padding: 8 },
  fxList: { maxHeight: 220, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm },
  fxItem: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: theme.spacing.sm,
    borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
    borderRadius: theme.radius.sm,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  fxItemText: { color: theme.colors.onSurface, fontSize: 13, flex: 1 },
  modalBtn: {
    paddingVertical: 14, borderRadius: theme.radius.md,
    alignItems: 'center', justifyContent: 'center',
    marginTop: theme.spacing.sm,
  },
  modalBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  settledInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.success + '22',
    borderRadius: theme.radius.md,
  },
  settledText: { color: theme.colors.success, fontWeight: '700', flex: 1 },
});
