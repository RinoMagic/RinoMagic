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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { confirmDialog } from '@/src/utils/confirm';
import { MatchdayCountdown } from '@/src/components/MatchdayCountdown';
import { SurvivaPicksModal } from '@/src/components/SurvivaPicksModal';

const COLOR = '#EF4444';
// Surviva 2.1 — picks required per matchday is DYNAMIC (equal to the
// player's remaining lives). This is only kept as an upper-bound safety
// net for the very unlikely case the server has not yet returned the
// matchday details (backend field ``picks_required``).
const MAX_PICKS_UI = 10;

type Fixture = { home_team: string; away_team: string; kickoff_iso?: string | null; postponed_before?: boolean };
type Matchday = {
  id: string; matchday: number; status: string;
  kickoff_first: string | null; fixtures: Fixture[];
  locked: boolean; settled: boolean; my_picks_count: number;
  picks_required?: number;
  tie_break?: boolean;
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
  has_submitted_current?: boolean;
  bonus_wins?: number;
  pick_lives?: number;
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
  const [summary, setSummary] = useState<{
    locked: boolean;
    fixtures: SummaryFixture[];
    counts_hidden?: boolean;
    alive_count?: number;
    privacy_threshold?: number;
  } | null>(null);
  const [invites, setInvites] = useState<SvInvite[]>([]);
  const [bonusCfg, setBonusCfg] = useState<BonusCfg | null>(null);
  const [busyInvite, setBusyInvite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedLbRow, setSelectedLbRow] = useState<LeaderboardRow | null>(null);

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
        ).catch(() => ({ picks: [] as MyPick[], required: MAX_PICKS_UI }));
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
      const s = await api<{
        locked: boolean;
        fixtures: SummaryFixture[];
        counts_hidden?: boolean;
        alive_count?: number;
        privacy_threshold?: number;
      }>(
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
  //   • Only up to ``requiredPicks`` fixtures in the pending list
  //     (v2.1: requiredPicks = player's remaining lives).
  //   • Tapping the SAME sign on the SAME fixture → remove.
  //   • Tapping a DIFFERENT sign on the SAME fixture → replace.
  //   • Tapping a NEW fixture when we already have N picks → alert.
  const togglePick = (fx: Fixture, sign: '1' | 'X' | '2') => {
    if (!md || md.locked) return;
    if (fx.postponed_before) return;
    const requiredPicks = md.picks_required ?? livesLeft;
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
    if (pending.length >= requiredPicks) {
      alert(`Hai già selezionato ${requiredPicks} pronostic${requiredPicks === 1 ? 'o' : 'i'}. Deseleziona uno per cambiare.`);
      return;
    }
    setPending([...pending, {
      home_team: fx.home_team, away_team: fx.away_team, pick: sign,
    }]);
  };

  const submitAllPicks = async () => {
    if (!md || !t) return;
    const req = md.picks_required ?? livesLeft;
    if (pending.length !== req) {
      alert(`Devi selezionare esattamente ${req} pronostic${req === 1 ? 'o' : 'i'} (uno per ogni vita rimasta).`);
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
        {md && (
          <MatchdayCountdown matchday={md.matchday} season={t.season} />
        )}
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
        {tab === 'leaderboard' && (
          <LeaderboardTab rows={lb} onSelect={setSelectedLbRow} isAdmin={t.is_admin} tournamentId={t.id} onReload={load} />
        )}
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

      <SurvivaPicksModal
        tid={id!}
        row={selectedLbRow}
        onClose={() => setSelectedLbRow(null)}
      />
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
  const requiredPicks = md.picks_required ?? livesLeft;
  const submittedMatches = myPicks.length === requiredPicks
    && myPicks.every(mp => pending.some(
      p => p.home_team === mp.home_team
        && p.away_team === mp.away_team
        && p.pick === mp.pick,
    ));
  const submitEnabled = !md.locked && canPlay
    && pending.length === requiredPicks
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
              : requiredPicks === 1
                ? `Hai 1 vita rimasta: scegli 1 partita e il segno (1 / X / 2). Puoi cambiare il pronostico finché la giornata non si blocca.`
                : `Hai ${requiredPicks} vite rimaste: scegli ${requiredPicks} partite diverse e per ognuna il segno (1 / X / 2) — 1 pronostico per ogni vita. Puoi cambiare i pronostici finché la giornata non si blocca.`}
        </Text>
      </View>

      {/* Progress + Submit CTA */}
      {t.joined && !md.locked && (
        <View style={styles.progressBar}>
          <Text style={styles.progressText}>
            Pronostici selezionati: <Text style={{ fontWeight: '800', color: COLOR }}>{pending.length}</Text> / {requiredPicks}
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

function LeaderboardTab({
  rows, onSelect, isAdmin, tournamentId, onReload,
}: {
  rows: LeaderboardRow[];
  onSelect: (row: LeaderboardRow) => void;
  isAdmin: boolean;
  tournamentId: string;
  onReload: () => Promise<void> | void;
}) {
  if (rows.length === 0) return <Text style={styles.muted}>Nessun partecipante.</Text>;
  const doKick = async (r: LeaderboardRow) => {
    const ok = await confirmDialog(
      'Escludi giocatore',
      `Vuoi escludere "${r.nickname}" da questo torneo?\n\nVerrà rimosso dalla classifica e tutti i suoi pronostici saranno eliminati.\n\nL'azione è IRREVERSIBILE.`,
      { destructive: true, confirmLabel: 'Escludi' },
    );
    if (!ok) return;
    try {
      await api(`/sv/tournaments/${tournamentId}/kick/${r.user_id}`, { method: 'POST' });
      await onReload();
    } catch (e: any) {
      if (typeof window !== 'undefined' && (window as any).alert) {
        (window as any).alert(e?.message || 'Errore durante l\'esclusione');
      }
    }
  };
  return (
    <>
      {rows.map((r) => (
        <Pressable
          key={r.user_id}
          onPress={() => onSelect(r)}
          testID={`sv-lb-row-${r.user_id}`}
          style={({ pressed }) => [
            styles.lbRow,
            r.eliminated && { opacity: 0.5 },
            pressed && { backgroundColor: theme.colors.surfaceTertiary },
          ]}
        >
          <Text style={styles.lbRank}>#{r.rank}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.lbName}>{r.nickname}</Text>
            {r.eliminated && (
              <Text style={styles.lbEliminated}>Eliminato</Text>
            )}
            {!r.eliminated && (
              <View style={styles.lbStatusRow}>
                {r.has_submitted_current ? (
                  <>
                    <Ionicons name="checkmark-circle" size={11} color={theme.colors.success} />
                    <Text style={[styles.lbStatusText, { color: theme.colors.success }]}>
                      Giocata inserita
                    </Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="ellipse-outline" size={11} color={theme.colors.warning} />
                    <Text style={[styles.lbStatusText, { color: theme.colors.warning }]}>
                      In attesa di giocata
                    </Text>
                  </>
                )}
              </View>
            )}
            {!r.eliminated && (r.locked_teams_count ?? 0) > 0 && (
              <Text style={styles.lbBlockedInfo}>
                {r.locked_teams_count} squadr{r.locked_teams_count === 1 ? 'a' : 'e'} bloccat{r.locked_teams_count === 1 ? 'a' : 'e'}
              </Text>
            )}
          </View>
          <View style={styles.lbBadgesCol}>
            {/* Pick-only lives (may be negative if the player was already eliminated) */}
            <View style={[styles.livesBadge, styles.livesBadgeSmall]}>
              <Ionicons name="heart-outline" size={11} color={theme.colors.muted} />
              <Text style={styles.livesBadgeSmallText}>
                {(r.pick_lives ?? 0) >= 0 ? (r.pick_lives ?? 0) : `${r.pick_lives}`}
              </Text>
            </View>
            {/* Bonus wins */}
            <View style={styles.bonusBadge} testID={`sv-lb-bonus-${r.user_id}`}>
              <Ionicons name="gift" size={11} color="#F59E0B" />
              <Text style={styles.bonusBadgeText}>+{r.bonus_wins ?? 0}</Text>
            </View>
            {/* Total (actual) lives */}
            <View style={[styles.livesBadge, styles.livesBadgeTotal]}>
              <Ionicons name="heart" size={14} color={COLOR} />
              <Text style={styles.livesBadgeText}>{r.lives_left}</Text>
            </View>
          </View>
          {isAdmin && (
            <Pressable
              testID={`sv-kick-${r.user_id}`}
              onPress={(e) => {
                e.stopPropagation();
                doKick(r);
              }}
              hitSlop={6}
              style={styles.lbKickBtn}
            >
              <Ionicons name="person-remove" size={14} color={theme.colors.error} />
            </Pressable>
          )}
          <Ionicons
            name="chevron-forward"
            size={16}
            color={theme.colors.muted}
            style={{ marginLeft: 4 }}
          />
        </Pressable>
      ))}
    </>
  );
}

// --- Summary tab ---------------------------------------------------------

function SummaryTab({
  md, summary, hasPicked, joined,
}: {
  md: Matchday | null;
  summary: {
    locked: boolean;
    fixtures: SummaryFixture[];
    counts_hidden?: boolean;
    alive_count?: number;
    privacy_threshold?: number;
  } | null;
  hasPicked: boolean;
  joined: boolean;
}) {
  if (!md) return <Text style={styles.muted}>Nessuna giornata in corso.</Text>;
  if (!summary) return <ActivityIndicator color={COLOR} />;

  const badgeLabel = summary.locked
    ? (md.settled ? 'Calcolata' : 'Chiusa')
    : 'Aperta';
  const countsHidden = !!summary.counts_hidden;

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
      {countsHidden && (
        <View style={[styles.notice, { borderColor: '#F59E0B55' }]}>
          <Ionicons name="eye-off" size={18} color="#F59E0B" />
          <Text style={[styles.noticeText, { color: '#F59E0B' }]}>
            🔒 Privacy: siete rimasti in {summary.alive_count ?? '?'}. I conteggi
            per partita sono nascosti fino al calcio d'inizio per non
            rivelare chi ha giocato cosa.
          </Text>
        </View>
      )}
      {joined && !hasPicked && !summary.locked && (
        <View style={[styles.notice, { borderColor: COLOR + '55' }]}>
          <Ionicons name="warning" size={18} color={COLOR} />
          <Text style={[styles.noticeText, { color: COLOR }]}>
            Non hai ancora inviato il tuo pronostico per questa giornata.
          </Text>
        </View>
      )}

      {summary.fixtures.length === 0 && (
        <Text style={styles.muted}>Nessuna partita in questa giornata.</Text>
      )}

      {summary.fixtures.length > 0 && (
        <View style={styles.mdBlock}>
          <View style={styles.mdBlockHeader}>
            <Text style={styles.mdBlockTitle}>Giornata {md.matchday}</Text>
            <View style={[
              styles.mdBlockBadge,
              md.settled && { backgroundColor: theme.colors.success + '22' },
            ]}>
              <Text style={[
                styles.mdBlockBadgeText,
                md.settled && { color: theme.colors.success },
              ]}>
                {badgeLabel}
              </Text>
            </View>
          </View>

          {summary.fixtures.map((fx, i) => {
            const total = fx.counts['1'] + fx.counts['X'] + fx.counts['2'];
            const picksBySign: Record<'1' | 'X' | '2', string[]> = { '1': [], 'X': [], '2': [] };
            if (summary.locked && fx.picks) {
              fx.picks.forEach(p => {
                const s = (p.pick as '1' | 'X' | '2');
                if (picksBySign[s]) picksBySign[s].push(p.nickname);
              });
            }
            const winner = ['1', 'X', '2'].reduce<'1' | 'X' | '2'>(
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
                  {countsHidden ? (
                    <View style={styles.summaryHiddenPill}>
                      <Ionicons name="eye-off" size={11} color={theme.colors.muted} />
                      <Text style={styles.summaryHiddenPillText}>nascosto</Text>
                    </View>
                  ) : (
                    <View style={styles.summaryCountsRow}>
                      {(['1', 'X', '2'] as const).map((s) => {
                        const isWinner = total > 0 && fx.counts[s] > 0 && s === winner;
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
                            ]}>
                              {s}
                            </Text>
                            <Text style={[
                              styles.summaryCountValue,
                              isWinner && { color: COLOR },
                            ]}>
                              {fx.counts[s]}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>

                {summary.locked && total > 0 && (
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
        </View>
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
  lbStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  lbStatusText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  lbBlockedInfo: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
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
  lbBadgesCol: {
    alignItems: 'flex-end', gap: 4,
  },
  bonusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: theme.radius.pill,
    backgroundColor: '#F59E0B18',
    borderWidth: 1, borderColor: '#F59E0B55',
  },
  bonusBadgeText: {
    color: '#F59E0B', fontWeight: '900', fontSize: 11,
  },
  lbKickBtn: {
    marginLeft: 6,
    padding: 6,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.error + '18',
    borderWidth: 1,
    borderColor: theme.colors.error + '55',
  },

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

  // Summary tab — testbigmach-style aggregated view
  summaryFxWrap: {
    paddingVertical: 6,
    borderTopWidth: 1, borderTopColor: theme.colors.border,
  },
  summaryFxRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  summaryCountsRow: {
    flexDirection: 'row', gap: 4,
  },
  summaryCountPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    minWidth: 44,
    paddingHorizontal: 6, paddingVertical: 3,
    borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    justifyContent: 'center',
  },
  summaryCountSign: {
    color: theme.colors.muted, fontWeight: '900', fontSize: 11,
  },
  summaryCountValue: {
    color: theme.colors.onSurface, fontWeight: '800', fontSize: 12,
  },
  summaryHiddenPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceTertiary,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  summaryHiddenPillText: {
    color: theme.colors.muted, fontWeight: '700', fontSize: 10,
    fontStyle: 'italic',
  },
  picksGroupSign: {
    minWidth: 22, paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  picksGroupSignText: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 11 },

  // Participant picks modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    maxHeight: '85%' as any,
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  modalTitle: { color: theme.colors.onSurface, fontSize: 17, fontWeight: '800' },
  modalSub: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  mdBlock: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 6,
  },
  mdBlockHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  mdBlockTitle: { color: theme.colors.onSurface, fontSize: 13, fontWeight: '800' },
  mdBlockBadge: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceTertiary,
  },
  mdBlockBadgeText: { color: theme.colors.muted, fontSize: 10, fontWeight: '800' },
  hiddenBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: 8,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceTertiary,
  },
  hiddenText: { color: theme.colors.muted, fontSize: 11, fontStyle: 'italic' },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 4,
  },
  pickTeams: { flex: 1, color: theme.colors.onSurface, fontSize: 12 },
  pickSign: {
    minWidth: 26, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border,
    alignItems: 'center',
  },
  pickSignText: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 12 },
});
