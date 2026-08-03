/*
 * Surviva 2.0 v2 — tournament detail page.
 *
 * NEW RULES (v2):
 *   • The player selects **3 picks** per matchday, each on a different fixture.
 *   • A CORRECT pick with sign "1" or "2" locks the winning team → cannot be
 *     re-used in later matchdays.
 *   • A CORRECT pick with sign "X" (draw) does NOT lock any team (exception).
 *   • Concession: a fixture where BOTH teams are already locked is playable
 *     with any sign.
 *   • Lives: -1 for every wrong pick (max -3 in a matchday).
 *
 * Tabs:
 *   • Giornata — the 3-picks selection UI (this page's main content)
 *   • Classifica — participants leaderboard (lives + status)
 *   • Riassunto — aggregated picks (private pre-kickoff, detailed after)
 */
import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { confirmDialog } from '@/src/utils/confirm';

const COLOR = '#EF4444';
const REQUIRED_PICKS = 3;

type Fixture = { home_team: string; away_team: string; kickoff_iso?: string | null; postponed_before?: boolean };
type Matchday = {
  id: string; matchday: number; status: string;
  kickoff_first: string | null; fixtures: Fixture[];
  locked: boolean; settled: boolean; my_picks_count: number;
  picks_required?: number;
};
type Tournament = {
  id: string; name: string; season: string; status: string;
  initial_lives: number; current_matchday: number;
  start_matchday: number;
  is_admin: boolean; joined: boolean;
  players_total: number; players_alive: number;
  invite_code: string;
};
type MyPick = { home_team: string; away_team: string; pick: '1' | 'X' | '2'; correct?: boolean | null; concession?: boolean };
type LeaderboardRow = {
  user_id: string; nickname: string; lives_left: number;
  locked_teams_count?: number;
  blocked_signs_count?: number; // legacy — kept for read compat
  eliminated: boolean; rank: number;
};
type SummaryFixture = {
  home_team: string; away_team: string;
  counts: { '1': number; X: number; '2': number };
  picks: { nickname: string; pick: string }[] | null;
};
type SvInvite = {
  id: string; code: string;
  used_by_user_id: string | null; used_by_nickname: string | null;
  revoked_at: string | null;
};
type BonusCfg = {
  id: string; season: string; matchday: number; bonus_type: string;
  big_match: { home_team: string; away_team: string } | null;
  status: 'open' | 'locked' | 'settled';
};

export default function SurvivaTournament() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<'play' | 'leaderboard' | 'summary' | 'admin'>('play');
  const [t, setT] = useState<Tournament | null>(null);
  const [md, setMd] = useState<Matchday | null>(null);
  // Server-confirmed picks for the current matchday (0..3)
  const [myPicks, setMyPicks] = useState<MyPick[]>([]);
  // Local pending selection the player is building — becomes myPicks after
  // "Conferma" is tapped. Empty on load if the matchday is unsubmitted.
  const [pending, setPending] = useState<MyPick[]>([]);
  const [lockedTeams, setLockedTeams] = useState<string[]>([]);
  const [livesLeft, setLivesLeft] = useState<number>(0);
  const [lb, setLb] = useState<LeaderboardRow[]>([]);
  const [summary, setSummary] = useState<{ locked: boolean; fixtures: SummaryFixture[] } | null>(null);
  const [invites, setInvites] = useState<SvInvite[]>([]);
  const [bonusCfg, setBonusCfg] = useState<BonusCfg | null>(null);
  const [busyInvite, setBusyInvite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const detail = await api<Tournament>(`/sv/tournaments/${id}`);
      setT(detail);
      // Load in parallel to keep the UI snappy
      const [cur, lt, board] = await Promise.all([
        api<Matchday>(`/sv/tournaments/${id}/matchdays/current`).catch(() => null),
        detail.joined
          ? api<{ locked_teams: string[]; lives_left: number }>(`/sv/tournaments/${id}/locked-teams`)
              .catch(() => ({ locked_teams: [], lives_left: 0 }))
          : Promise.resolve({ locked_teams: [], lives_left: 0 }),
        api<LeaderboardRow[]>(`/sv/tournaments/${id}/leaderboard`),
      ]);
      setMd(cur);
      setLockedTeams(lt.locked_teams || []);
      setLivesLeft(lt.lives_left);
      setLb(board);
      if (cur && detail.joined) {
        const r = await api<{ picks: MyPick[]; required: number }>(
          `/sv/tournaments/${id}/matchdays/${cur.id}/my-picks`,
        ).catch(() => ({ picks: [] as MyPick[], required: REQUIRED_PICKS }));
        const submitted = r.picks || [];
        setMyPicks(submitted);
        // Preload pending with the server-confirmed picks so users can edit
        // them before locking the matchday.
        setPending(submitted.map(p => ({
          home_team: p.home_team, away_team: p.away_team, pick: p.pick,
        })));
      } else {
        setMyPicks([]);
        setPending([]);
      }
      if (detail.is_admin) {
        try {
          setInvites(await api<SvInvite[]>(`/sv/tournaments/${id}/invites`));
        } catch { /* ignore */ }
        try {
          // Load the exact_score bonus config for the tournament's current
          // matchday (auto-created as a draft when the tournament was
          // created). If not found, offer a shortcut to configure one.
          const configs = await api<BonusCfg[]>(`/bonus/configs`);
          const cfg = configs.find(c =>
            c.season === detail.season
            && c.matchday === detail.current_matchday
            && c.bonus_type === 'exact_score',
          );
          setBonusCfg(cfg || null);
        } catch { /* ignore */ }
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };
  useFocusEffect(useCallback(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]));

  const genInvite = async () => {
    setBusyInvite(true);
    try {
      await api<SvInvite>(`/sv/tournaments/${id}/invites`, { method: 'POST' });
      const list = await api<SvInvite[]>(`/sv/tournaments/${id}/invites`);
      setInvites(list);
    } catch (e: any) {
      alert(e.message || 'Errore');
    } finally {
      setBusyInvite(false);
    }
  };

  const revokeInvite = async (inv: SvInvite) => {
    const ok = await confirmDialog(
      'Revoca invito',
      `Sicuro di revocare il codice ${inv.code}? Non potrà più essere utilizzato.`,
      { destructive: true, confirmLabel: 'Revoca' },
    );
    if (!ok) return;
    try {
      await api(`/sv/tournaments/${id}/invites/${inv.id}`, { method: 'DELETE' });
      const list = await api<SvInvite[]>(`/sv/tournaments/${id}/invites`);
      setInvites(list);
    } catch (e: any) {
      alert(e.message || 'Errore');
    }
  };

  const loadSummary = async () => {
    if (!md) return;
    try {
      const s = await api<{ locked: boolean; fixtures: SummaryFixture[] }>(
        `/sv/tournaments/${id}/matchdays/${md.id}/summary`,
      );
      setSummary(s);
    } catch (e: any) { alert(e.message); }
  };

  // Concession helper: a fixture with both teams already locked is
  // exempt from the team-lock check.
  const isConcession = (fx: Fixture): boolean =>
    lockedTeams.includes(fx.home_team) && lockedTeams.includes(fx.away_team);

  // Return the offending team if the sign would re-use a locked team,
  // ELSE null. Under concession, always returns null.
  const pickBlockedTeam = (sign: '1' | 'X' | '2', fx: Fixture): string | null => {
    if (isConcession(fx)) return null;
    if (sign === '1' && lockedTeams.includes(fx.home_team)) return fx.home_team;
    if (sign === '2' && lockedTeams.includes(fx.away_team)) return fx.away_team;
    return null;
  };

  // How many pending picks the player has selected on THIS specific fixture
  // (0 or 1 — a fixture can only be used once).
  const pendingOnFixture = (fx: Fixture): MyPick | null =>
    pending.find(p => p.home_team === fx.home_team && p.away_team === fx.away_team) || null;

  // Toggle a pick locally. Rules:
  //   • Only 3 fixtures max in the pending list.
  //   • Tapping the SAME sign on the SAME fixture → remove.
  //   • Tapping a DIFFERENT sign on the SAME fixture → replace.
  //   • Tapping a NEW fixture when we already have 3 picks → alert.
  const togglePick = (fx: Fixture, sign: '1' | 'X' | '2') => {
    if (!md || md.locked) return;
    if (fx.postponed_before) return;
    if (pickBlockedTeam(sign, fx)) {
      const team = pickBlockedTeam(sign, fx)!;
      alert(`${team} è già stata usata correttamente. Scegli un'altra squadra o cambia segno.`);
      return;
    }
    const existing = pending.find(p => p.home_team === fx.home_team && p.away_team === fx.away_team);
    if (existing && existing.pick === sign) {
      // Deselect
      setPending(pending.filter(p => p !== existing));
      return;
    }
    if (existing) {
      // Replace sign for same fixture
      setPending(pending.map(p => p === existing ? { ...existing, pick: sign } : p));
      return;
    }
    if (pending.length >= REQUIRED_PICKS) {
      alert(`Hai già selezionato ${REQUIRED_PICKS} pronostici. Deseleziona uno per cambiare.`);
      return;
    }
    setPending([...pending, {
      home_team: fx.home_team, away_team: fx.away_team, pick: sign,
    }]);
  };

  const submitAllPicks = async () => {
    if (!md || !t) return;
    if (pending.length !== REQUIRED_PICKS) {
      alert(`Devi selezionare esattamente ${REQUIRED_PICKS} pronostici.`);
      return;
    }
    setSubmitting(true);
    try {
      await api(`/sv/tournaments/${id}/matchdays/${md.id}/picks`, {
        method: 'POST',
        body: { picks: pending },
      });
      // Refresh from server to reflect the confirmed picks
      const r = await api<{ picks: MyPick[]; required: number }>(
        `/sv/tournaments/${id}/matchdays/${md.id}/my-picks`,
      );
      setMyPicks(r.picks || []);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSubmitting(false);
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
          {((t.is_admin
            ? ['play', 'leaderboard', 'summary', 'admin']
            : ['play', 'leaderboard', 'summary']) as ('play' | 'leaderboard' | 'summary' | 'admin')[]
          ).map((k) => (
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
                {k === 'play' ? 'Giornata'
                  : k === 'leaderboard' ? 'Classifica'
                  : k === 'summary' ? 'Riassunto'
                  : 'Admin'}
              </Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.body}>
        {tab === 'play' && (
          <PlayTab
            t={t} md={md}
            pending={pending} myPicks={myPicks}
            lockedTeams={lockedTeams} livesLeft={livesLeft}
            canPlay={!!canPlay}
            pickBlockedTeam={pickBlockedTeam}
            isConcession={isConcession}
            onTogglePick={togglePick}
            onSubmitAll={submitAllPicks}
            submitting={submitting}
            onRemoveFixture={removeFixture}
            onTogglePostponed={togglePostponed}
          />
        )}
        {tab === 'leaderboard' && <LeaderboardTab rows={lb} />}
        {tab === 'summary' && (
          <SummaryTab
            md={md} summary={summary}
            hasPicked={myPicks.length > 0} joined={!!t.joined}
          />
        )}
        {tab === 'admin' && t.is_admin && (
          <AdminTab
            t={t}
            invites={invites}
            busy={busyInvite}
            onGenerate={genInvite}
            onRevoke={revokeInvite}
            bonusCfg={bonusCfg}
            onConfigureBonus={() => router.push(
              `/admin/bonus?season=${encodeURIComponent(t.season)}&matchday=${t.current_matchday}&bonus_type=exact_score`,
            )}
          />
        )}
      </ScrollView>
    </View>
  );
}

function PlayTab({
  t, md, pending, myPicks, lockedTeams, livesLeft, canPlay,
  pickBlockedTeam, isConcession, onTogglePick, onSubmitAll, submitting,
  onRemoveFixture, onTogglePostponed,
}: {
  t: Tournament; md: Matchday | null;
  pending: MyPick[]; myPicks: MyPick[];
  lockedTeams: string[]; livesLeft: number; canPlay: boolean;
  pickBlockedTeam: (s: '1' | 'X' | '2', fx: Fixture) => string | null;
  isConcession: (fx: Fixture) => boolean;
  onTogglePick: (fx: Fixture, s: '1' | 'X' | '2') => void;
  onSubmitAll: () => void;
  submitting: boolean;
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

  // Has the player already submitted picks equal to the pending selection?
  const submittedMatches = myPicks.length === REQUIRED_PICKS
    && myPicks.every(mp => pending.some(
      p => p.home_team === mp.home_team
        && p.away_team === mp.away_team
        && p.pick === mp.pick,
    ));
  const submitEnabled = !md.locked && canPlay
    && pending.length === REQUIRED_PICKS
    && !submittedMatches;

  return (
    <>
      <View style={styles.notice}>
        <Ionicons name="information-circle" size={18} color={COLOR} />
        <Text style={styles.noticeText}>
          {md.locked
            ? 'Giornata bloccata: le partite sono iniziate.'
            : t.is_admin && !t.joined
              ? 'Vista admin: puoi gestire le partite di questa giornata (rinvii).'
              : `Scegli ${REQUIRED_PICKS} partite diverse e per ognuna il segno 1 / X / 2. Puoi cambiare i pronostici finché la giornata non si blocca.`}
        </Text>
      </View>

      {/* Progress + Submit CTA */}
      {t.joined && !md.locked && (
        <View style={styles.progressBar}>
          <Text style={styles.progressText}>
            Pronostici selezionati: <Text style={{ fontWeight: '800', color: COLOR }}>{pending.length}</Text> / {REQUIRED_PICKS}
          </Text>
          <Pressable
            onPress={onSubmitAll}
            disabled={!submitEnabled || submitting}
            style={[
              styles.submitBtn,
              (!submitEnabled || submitting) && { opacity: 0.4 },
            ]}
            testID="sv-submit-picks"
          >
            {submitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.submitBtnText}>
                {myPicks.length > 0 ? 'Aggiorna pronostici' : 'Conferma pronostici'}
              </Text>
            )}
          </Pressable>
        </View>
      )}

      {t.is_admin && !md.locked && (
        <View style={styles.adminHint}>
          <Ionicons name="construct" size={14} color={COLOR} />
          <Text style={styles.adminHintText}>
            Modalità admin: tocca il cestino per rimuovere una partita rinviata.
          </Text>
        </View>
      )}

      {lockedTeams.length > 0 && (
        <View style={styles.blockedList}>
          <Text style={styles.blockedTitle}>Squadre bloccate ({lockedTeams.length})</Text>
          <Text style={styles.blockedSubtitle}>
            Hai già usato queste squadre correttamente — non puoi rigiocarle (a meno di concessione).
          </Text>
          <View style={styles.blockedRow}>
            {lockedTeams.map((team, i) => (
              <View key={i} style={styles.blockedChip}>
                <Ionicons name="lock-closed" size={12} color={theme.colors.muted} />
                <Text style={styles.blockedText}>{team}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {md.fixtures.length === 0 && (
        <Text style={styles.muted}>Nessuna partita in calendario per questa giornata.</Text>
      )}

      {md.fixtures.map((fx, i) => {
        const pendingPick = pending.find(
          p => p.home_team === fx.home_team && p.away_team === fx.away_team,
        );
        const isSelected = !!pendingPick;
        const postponed = !!fx.postponed_before;
        const concession = isConcession(fx);
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
              <View style={styles.fxTeamCol}>
                <Text style={[styles.fxTeam, postponed && { color: theme.colors.muted, textDecorationLine: 'line-through' }]}>
                  {fx.home_team}
                </Text>
                {lockedTeams.includes(fx.home_team) && !concession && (
                  <Ionicons name="lock-closed" size={12} color={theme.colors.muted} />
                )}
              </View>
              <Text style={styles.fxVs}>vs</Text>
              <View style={styles.fxTeamCol}>
                <Text style={[styles.fxTeam, postponed && { color: theme.colors.muted, textDecorationLine: 'line-through' }]}>
                  {fx.away_team}
                </Text>
                {lockedTeams.includes(fx.away_team) && !concession && (
                  <Ionicons name="lock-closed" size={12} color={theme.colors.muted} />
                )}
              </View>
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

            {concession && (
              <View style={styles.concessionBadge}>
                <Ionicons name="star" size={12} color="#B45309" />
                <Text style={styles.concessionText}>
                  Concessione: entrambe le squadre sono bloccate, puoi giocare comunque.
                </Text>
              </View>
            )}

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
                  const blockedTeam = pickBlockedTeam(sign, fx);
                  const selected = pendingPick && pendingPick.pick === sign;
                  const disabled = !canPlay || !!blockedTeam;
                  return (
                    <Pressable
                      key={sign}
                      disabled={disabled || submitting}
                      onPress={() => onTogglePick(fx, sign)}
                      style={[
                        styles.signBtn,
                        selected && { backgroundColor: COLOR, borderColor: COLOR },
                        !selected && blockedTeam && styles.signBtnBlocked,
                        !selected && !blockedTeam && disabled && { opacity: 0.4 },
                      ]}
                      testID={`sv-pick-${fx.home_team}-${sign}`}
                    >
                      <Text
                        style={[
                          styles.signText,
                          selected && { color: '#fff' },
                          !selected && blockedTeam && { color: theme.colors.muted, textDecorationLine: 'line-through' },
                        ]}
                      >
                        {sign}
                      </Text>
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

function AdminTab({
  t, invites, busy, onGenerate, onRevoke,
  bonusCfg, onConfigureBonus,
}: {
  t: Tournament;
  invites: SvInvite[];
  busy: boolean;
  onGenerate: () => void;
  onRevoke: (inv: SvInvite) => void;
  bonusCfg: BonusCfg | null;
  onConfigureBonus: () => void;
}) {
  const available = invites.filter((i) => !i.revoked_at && !i.used_by_user_id).length;
  const bigMatch = bonusCfg?.big_match;
  return (
    <>
      <View style={styles.notice}>
        <Ionicons name="shield-checkmark" size={18} color={COLOR} />
        <Text style={styles.noticeText}>
          Ogni codice invito è univoco e utilizzabile da un solo giocatore.
          Attualmente {available} disponibile{available === 1 ? '' : 'i'}.
        </Text>
      </View>

      {/* Bonus config card (Survival = exact_score = Big Match) */}
      <View style={styles.adminCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="gift" size={18} color={COLOR} />
          <Text style={[styles.adminCardTitle, { flex: 1 }]}>
            Bonus Giornata {t.current_matchday}
          </Text>
          <View style={[
            styles.bonusChip,
            !bonusCfg && { backgroundColor: theme.colors.muted + '25' },
            bonusCfg && !bigMatch && { backgroundColor: '#FEF3C7' },
            bonusCfg && bigMatch && bonusCfg.status === 'open' && { backgroundColor: '#DCFCE7' },
            bonusCfg && bonusCfg.status === 'locked' && { backgroundColor: '#E0E7FF' },
            bonusCfg && bonusCfg.status === 'settled' && { backgroundColor: '#E5E7EB' },
          ]}>
            <Text style={styles.bonusChipText}>
              {!bonusCfg
                ? 'Non attivo'
                : !bigMatch
                  ? 'Draft: manca Big Match'
                  : bonusCfg.status === 'open'
                    ? 'Attivo'
                    : bonusCfg.status === 'locked'
                      ? 'Bloccato'
                      : 'Liquidato'}
            </Text>
          </View>
        </View>
        {bigMatch ? (
          <Text style={styles.bonusInfo}>
            <Text style={{ fontWeight: '700' }}>
              {bigMatch.home_team} vs {bigMatch.away_team}
            </Text>
            {' '}— i giocatori pronosticano il risultato esatto.
          </Text>
        ) : (
          <Text style={styles.bonusInfo}>
            {bonusCfg
              ? 'È stato creato uno slot bonus per questa giornata ma manca la Big Match. Configurala per attivarlo per i giocatori.'
              : 'Nessun bonus attivo per questa giornata.'}
          </Text>
        )}
        {bonusCfg?.status !== 'settled' && (
          <Pressable
            style={[styles.genBtn, { alignSelf: 'flex-start', marginTop: 4 }]}
            onPress={onConfigureBonus}
            testID="sv-configure-bonus"
          >
            <Ionicons name="settings" size={14} color="#fff" />
            <Text style={styles.genBtnText}>
              {bigMatch ? 'Modifica Big Match' : 'Configura Big Match'}
            </Text>
          </Pressable>
        )}
      </View>

      <View style={styles.adminCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[styles.adminCardTitle, { flex: 1 }]}>
            Codici invito ({invites.length})
          </Text>
          <Pressable
            style={[styles.genBtn, { opacity: busy ? 0.5 : 1 }]}
            onPress={onGenerate}
            disabled={busy}
            testID="sv-gen-invite"
          >
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.genBtnText}>Genera</Text>
              </>
            )}
          </Pressable>
        </View>
        {invites.length === 0 && (
          <Text style={styles.muted}>
            Nessun codice ancora generato. Premi &quot;Genera&quot; per crearne uno.
          </Text>
        )}
        {invites.map((inv) => {
          const st = inv.revoked_at
            ? 'revoked'
            : inv.used_by_user_id
              ? 'used'
              : 'available';
          return (
            <View key={inv.id} style={styles.inviteRow}>
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.inviteCode,
                    st !== 'available' && { textDecorationLine: 'line-through', color: theme.colors.muted },
                  ]}
                >
                  {inv.code}
                </Text>
                <Text style={styles.gameTag}>Survival 2.0</Text>
              </View>
              <Text
                style={[
                  styles.inviteMeta,
                  st === 'available' && { color: COLOR },
                  st === 'used' && { color: theme.colors.accent },
                  st === 'revoked' && { color: theme.colors.muted },
                ]}
              >
                {st === 'revoked'
                  ? '❌ revocato'
                  : st === 'used'
                    ? `✅ ${inv.used_by_nickname || 'usato'}`
                    : '⏳ disponibile'}
              </Text>
              {st === 'available' && (
                <Pressable
                  onPress={() => onRevoke(inv)}
                  hitSlop={8}
                  style={styles.trashBtn}
                  testID={`sv-revoke-${inv.code}`}
                >
                  <Ionicons name="close" size={16} color={theme.colors.error} />
                </Pressable>
              )}
            </View>
          );
        })}
      </View>

      <View style={styles.adminCard}>
        <Text style={styles.adminCardTitle}>Info torneo</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Stagione</Text>
          <Text style={styles.infoValue}>{t.season}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Giornata di partenza</Text>
          <Text style={styles.infoValue}>{t.start_matchday}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Giornata corrente</Text>
          <Text style={styles.infoValue}>{t.current_matchday}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Vite iniziali</Text>
          <Text style={styles.infoValue}>{t.initial_lives}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Giocatori</Text>
          <Text style={styles.infoValue}>{t.players_alive}/{t.players_total} vivi</Text>
        </View>
      </View>
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
            {!r.eliminated && (r.locked_teams_count ?? 0) > 0 && (
              <Text style={styles.lbBlockedInfo}>
                {r.locked_teams_count} squadr{r.locked_teams_count === 1 ? 'a' : 'e'} bloccat{r.locked_teams_count === 1 ? 'a' : 'e'}
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
  const { width } = useWindowDimensions();
  // Compact layout on phones (≤ 480 px viewport)
  const compact = width < 480;
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
        const maxCount = Math.max(fx.counts['1'], fx.counts['X'], fx.counts['2'], 1);
        // Group individual picks by sign for the locked (post-kickoff) view
        const picksBySign: Record<'1' | 'X' | '2', string[]> = { '1': [], 'X': [], '2': [] };
        if (summary.locked && fx.picks) {
          fx.picks.forEach(p => {
            const s = (p.pick as '1' | 'X' | '2');
            if (picksBySign[s]) picksBySign[s].push(p.nickname);
          });
        }
        const labelFor = (s: '1' | 'X' | '2'): string =>
          s === '1' ? fx.home_team : s === '2' ? fx.away_team : 'Pareggio';
        const winner = ['1', 'X', '2'].reduce<'1' | 'X' | '2'>(
          (best, cur) => fx.counts[cur as '1' | 'X' | '2']
            > fx.counts[best] ? (cur as '1' | 'X' | '2') : best,
          '1',
        );
        return (
          <View key={i} style={styles.fxCard}>
            {/* Match header — small, unobtrusive */}
            <View style={styles.smHeader}>
              <Text style={styles.smHeaderText}>
                {fx.home_team} — {fx.away_team}
              </Text>
              <Text style={styles.smHeaderTotal}>
                {total} pronostic{total === 1 ? 'o' : 'i'}
              </Text>
            </View>
            {/* Three aligned columns: home / draw / away */}
            <View style={[styles.summaryGrid, compact && styles.summaryGridCompact]}>
              {(['1', 'X', '2'] as const).map((s) => {
                const count = fx.counts[s];
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                const barPct = maxCount > 0 ? (count / maxCount) * 100 : 0;
                const isWinner = total > 0 && count > 0 && s === winner;
                return (
                  <View
                    key={s}
                    style={[
                      styles.summaryCol,
                      compact && styles.summaryColCompact,
                      isWinner && styles.summaryColLead,
                    ]}
                  >
                    <View style={[styles.summarySignPill, compact && styles.summarySignPillCompact]}>
                      <Text style={[styles.summarySignPillText, compact && { fontSize: 12 }]}>{s}</Text>
                    </View>
                    <Text
                      style={[styles.summaryColTeam, compact && styles.summaryColTeamCompact]}
                      numberOfLines={2}
                      adjustsFontSizeToFit={compact}
                      minimumFontScale={0.75}
                    >
                      {labelFor(s)}
                    </Text>
                    <Text style={[styles.summaryColCount, compact && styles.summaryColCountCompact]}>
                      {count}
                    </Text>
                    <View style={styles.summaryBarTrack}>
                      <View
                        style={[
                          styles.summaryBarFill,
                          { width: `${barPct}%` },
                          isWinner && { backgroundColor: COLOR },
                        ]}
                      />
                    </View>
                    <Text style={styles.summaryColPct}>{total > 0 ? `${pct}%` : '—'}</Text>
                  </View>
                );
              })}
            </View>
            {/* After kickoff: show who picked what, grouped by sign */}
            {summary.locked && total > 0 && (
              <View style={styles.picksGrouped}>
                {(['1', 'X', '2'] as const).map((s) => {
                  const list = picksBySign[s];
                  if (list.length === 0) return null;
                  return (
                    <View key={s} style={styles.picksGroupRow}>
                      <Text style={styles.picksGroupLabel}>
                        {labelFor(s)}:
                      </Text>
                      <View style={styles.picksGroupNames}>
                        {list.map((n, k) => (
                          <View key={k} style={styles.pickChip}>
                            <Text style={styles.pickChipName}>{n}</Text>
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
  blockedSubtitle: {
    color: theme.colors.muted, fontSize: 11, marginBottom: 6,
    fontStyle: 'italic',
  },
  blockedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  blockedChip: {
    backgroundColor: theme.colors.error + '15',
    borderWidth: 1, borderColor: theme.colors.error + '55',
    borderRadius: theme.radius.pill,
    paddingHorizontal: 8, paddingVertical: 3,
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  blockedText: { color: theme.colors.error, fontSize: 11, fontWeight: '700' },

  // 3-picks submission progress + CTA
  progressBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md, borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  progressText: { color: theme.colors.text, fontSize: 13, flex: 1 },
  submitBtn: {
    backgroundColor: COLOR, borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md, paddingVertical: 10,
    minWidth: 130, alignItems: 'center', justifyContent: 'center',
  },
  submitBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  fxTeamCol: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  concessionBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEF3C7', borderRadius: theme.radius.sm,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  concessionText: {
    color: '#92400E', fontSize: 11, fontWeight: '700', flex: 1,
  },

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

  adminCard: {
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary, gap: theme.spacing.sm,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  adminCardTitle: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 15 },
  bonusChip: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: theme.radius.pill,
  },
  bonusChipText: { fontSize: 11, fontWeight: '800', color: '#111827' },
  bonusInfo: { color: theme.colors.muted, fontSize: 13, marginTop: 4 },
  genBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: theme.radius.pill, backgroundColor: COLOR,
  },
  genBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
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
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 4,
  },
  infoLabel: { color: theme.colors.muted, fontSize: 13 },
  infoValue: { color: theme.colors.onSurface, fontSize: 13, fontWeight: '700' },
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

  // Improved summary layout — 3 columns with team name UNDER each sign so
  // there's no ambiguity between "1/X/2" and which team it represents.
  smHeader: {
    flexDirection: 'row', alignItems: 'baseline',
    justifyContent: 'space-between', gap: theme.spacing.sm,
    marginBottom: 4,
  },
  smHeaderText: {
    color: theme.colors.muted, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5, flex: 1,
  },
  smHeaderTotal: {
    color: theme.colors.muted, fontSize: 11, fontStyle: 'italic',
  },
  summaryGrid: {
    flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'stretch',
  },
  summaryGridCompact: { gap: 4 },
  summaryCol: {
    flex: 1, alignItems: 'center', gap: 4,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
    minHeight: 130, justifyContent: 'flex-start',
  },
  summaryColCompact: {
    padding: 6, minHeight: 108, gap: 3,
  },
  summaryColLead: {
    borderColor: COLOR, backgroundColor: COLOR + '10',
  },
  summarySignPill: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: COLOR + '22',
    alignItems: 'center', justifyContent: 'center',
  },
  summarySignPillCompact: { width: 22, height: 22, borderRadius: 11 },
  summarySignPillText: { color: COLOR, fontWeight: '900', fontSize: 14 },
  summaryColTeam: {
    color: theme.colors.onSurface,
    fontSize: 12, fontWeight: '700',
    textAlign: 'center',
    minHeight: 30,
  },
  summaryColTeamCompact: {
    fontSize: 11, minHeight: 26, lineHeight: 13,
  },
  summaryColCount: {
    color: theme.colors.onSurface, fontWeight: '900',
    fontSize: 22, lineHeight: 24,
  },
  summaryColCountCompact: { fontSize: 18, lineHeight: 20 },
  summaryBarTrack: {
    width: '100%', height: 4, borderRadius: 2,
    backgroundColor: theme.colors.border,
    overflow: 'hidden',
  },
  summaryBarFill: {
    height: '100%', backgroundColor: theme.colors.muted,
  },
  summaryColPct: { color: theme.colors.muted, fontSize: 11 },

  // Post-kickoff detailed picks, grouped by sign
  picksGrouped: {
    marginTop: 6, gap: 6,
    paddingTop: 6,
    borderTopWidth: 1, borderTopColor: theme.colors.border,
  },
  picksGroupRow: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6,
  },
  picksGroupLabel: {
    color: theme.colors.muted, fontSize: 11, fontWeight: '800',
    minWidth: 80,
  },
  picksGroupNames: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 },
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
