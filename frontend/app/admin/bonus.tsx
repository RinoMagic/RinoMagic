/*
 * /admin/bonus — Admin-only dashboard to configure and settle the four
 * Bonus mini-games. Accessible from Settings (⚙️ gear icon).
 *
 * Flow:
 *  1. Pick season + matchday
 *  2. For each of the 2 bonus types (exact_score / first_scorer), see the
 *     current config for the selected matchday and either:
 *      - Create it (choose Big Match for exact_score)
 *      - Delete it (if not yet settled)
 *      - Settle it (enter final score / first scorer, auto-grants rewards)
 *  3. Recent configs list with quick jump.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session, User } from '@/src/api';
import { theme } from '@/src/theme';
import { confirmDialog } from '@/src/utils/confirm';

type BonusType = 'exact_score' | 'first_scorer';
type Config = {
  id: string;
  season: string;
  matchday: number;
  bonus_type: BonusType;
  games: string[];
  big_match: { home_team: string; away_team: string; kickoff_iso?: string } | null;
  lock_at: string | null;
  result: any;
  status: 'open' | 'locked' | 'settled';
  created_at?: string;
  settled_at?: string;
};

type Available = {
  bonus_type: BonusType;
  fixtures: { home_team: string; away_team: string; kickoff_iso?: string | null }[];
};

const COLORS: Record<BonusType, { primary: string; dot1: string; dot2: string; label: string; games: string; desc: string }> = {
  exact_score: {
    primary: '#F59E0B',
    dot1: '#FFB300', dot2: '#EF4444',
    label: 'Risultato Esatto',
    games: '🟡 Tiket + 🔴 Survival',
    desc: 'Big Match di giornata: indovina il risultato finale esatto.',
  },
  first_scorer: {
    primary: '#8B5CF6',
    dot1: '#3B82F6', dot2: '#A855F7',
    label: 'Primo Marcatore',
    games: '🔵 Score + 🟣 Fanta',
    desc: 'Primo marcatore della giornata: indovina il nome del giocatore.',
  },
};

export default function AdminBonus() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [season, setSeason] = useState('2026-27');
  const [matchday, setMatchday] = useState('1');
  const [configs, setConfigs] = useState<Config[]>([]);
  const [fixtures, setFixtures] = useState<Available['fixtures']>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await session.load();
      if (!s.user || s.user.role !== 'admin') {
        router.replace('/');
        return;
      }
      setMe(s.user);
      const [cfgs, av] = await Promise.all([
        api<Config[]>('/bonus/configs'),
        // Use the exact_score available to fetch fixtures for the current matchday
        api<Available>(`/bonus/available?game=tiket&season=${season}`).catch(() => ({
          bonus_type: 'exact_score' as BonusType, fixtures: [],
        })),
      ]);
      setConfigs(cfgs);
      setFixtures(av.fixtures || []);
    } catch (e: any) {
      alert(e.message || 'Errore caricamento');
    } finally {
      setLoading(false);
    }
  }, [season, router]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // When user changes the matchday input, reload fixtures for that matchday.
  const [fxLoading, setFxLoading] = useState(false);
  useEffect(() => {
    (async () => {
      const md = parseInt(matchday, 10);
      if (isNaN(md) || md < 1 || md > 38) return;
      setFxLoading(true);
      try {
        // Fetch fixtures directly from the SAL calendar for the target matchday.
        const cal = await api<{ fixtures: { home_team: string; away_team: string; kickoff_iso?: string }[] }>(
          `/sal/calendar?season=${season}&matchday=${md}`,
        ).catch(() => ({ fixtures: [] }));
        setFixtures(cal.fixtures || []);
      } finally {
        setFxLoading(false);
      }
    })();
  }, [matchday, season]);

  const mdInt = parseInt(matchday, 10);
  const configsForMd = useMemo(() =>
    configs.filter((c) => c.season === season && c.matchday === mdInt),
    [configs, season, mdInt]);

  const configByType = (t: BonusType) => configsForMd.find((c) => c.bonus_type === t) || null;

  const onCreated = async () => {
    await load();
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>;
  }
  if (!me) return null;

  const recent = configs.slice(0, 8);

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <View style={styles.headerIcon}>
            <Ionicons name="gift" size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Gestione Bonus</Text>
            <Text style={styles.sub}>Configura e liquida i 4 Giochi Bonus</Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.colors.brand}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {/* Selettori */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>SELEZIONE GIORNATA</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Stagione</Text>
              <TextInput
                style={styles.input} value={season} onChangeText={setSeason}
                placeholder="2026-27" placeholderTextColor={theme.colors.muted}
              />
            </View>
            <View style={{ width: 130 }}>
              <Text style={styles.fieldLabel}>Giornata (1-38)</Text>
              <TextInput
                style={styles.input} value={matchday} onChangeText={setMatchday}
                keyboardType="number-pad" maxLength={2}
                placeholder="1" placeholderTextColor={theme.colors.muted}
                testID="admin-bonus-md"
              />
            </View>
          </View>
          {fxLoading && (
            <Text style={styles.hint}>Caricamento partite in corso…</Text>
          )}
          {!fxLoading && fixtures.length === 0 && (
            <Text style={[styles.hint, { color: theme.colors.error }]}>
              ⚠️ Nessuna partita in calendario per questa giornata. Carica prima il calendario dalla sezione ScoreAndLive.
            </Text>
          )}
          {!fxLoading && fixtures.length > 0 && (
            <Text style={styles.hint}>
              {fixtures.length} partite in calendario per la giornata {matchday}.
            </Text>
          )}
        </View>

        {/* Bonus Tipo 1: exact_score */}
        <BonusSection
          type="exact_score"
          config={configByType('exact_score')}
          season={season}
          matchday={mdInt}
          fixtures={fixtures}
          onChanged={onCreated}
        />

        {/* Bonus Tipo 2: first_scorer */}
        <BonusSection
          type="first_scorer"
          config={configByType('first_scorer')}
          season={season}
          matchday={mdInt}
          fixtures={fixtures}
          onChanged={onCreated}
        />

        {/* Storico recenti */}
        {recent.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>ULTIMI BONUS CONFIGURATI</Text>
            {recent.map((c) => (
              <RecentRow key={c.id} c={c} onJump={(s, m) => { setSeason(s); setMatchday(String(m)); }} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// -------------------------------------------------------------------------
// Bonus section (per tipo)
// -------------------------------------------------------------------------
function BonusSection({
  type, config, season, matchday, fixtures, onChanged,
}: {
  type: BonusType;
  config: Config | null;
  season: string;
  matchday: number;
  fixtures: Available['fixtures'];
  onChanged: () => Promise<void>;
}) {
  const c = COLORS[type];
  const [selectedFx, setSelectedFx] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [homeR, setHomeR] = useState('');
  const [awayR, setAwayR] = useState('');
  const [scorerR, setScorerR] = useState('');

  useEffect(() => {
    setSelectedFx(config?.big_match
      ? `${config.big_match.home_team}|${config.big_match.away_team}`
      : '');
    setHomeR('');
    setAwayR('');
    setScorerR('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.id]);

  const validMd = matchday >= 1 && matchday <= 38;

  const createConfig = async () => {
    if (!validMd) return alert('Giornata non valida');
    setBusy(true);
    try {
      const body: any = { season, matchday, bonus_type: type };
      if (type === 'exact_score') {
        if (!selectedFx) return alert('Scegli il Big Match dal calendario');
        const [home_team, away_team] = selectedFx.split('|');
        body.big_match = { home_team, away_team };
      }
      await api('/bonus/configs', { method: 'POST', body });
      await onChanged();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteConfig = async () => {
    if (!config) return;
    const ok = await confirmDialog(
      'Elimina bonus',
      `Sicuro di eliminare il bonus "${c.label}" per la giornata ${matchday}? Tutti i pronostici invii saranno cancellati.`,
      { destructive: true, confirmLabel: 'Elimina' },
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/bonus/configs/${config.id}`, { method: 'DELETE' });
      await onChanged();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const settleExact = async () => {
    if (!config) return;
    const h = parseInt(homeR, 10);
    const a = parseInt(awayR, 10);
    if (isNaN(h) || h < 0 || h > 30) return alert('Gol casa non valido');
    if (isNaN(a) || a < 0 || a > 30) return alert('Gol trasferta non valido');
    setBusy(true);
    try {
      const res = await api<{ winners: number; total_picks: number }>(
        `/bonus/configs/${config.id}/settle-exact`,
        { method: 'POST', body: { home_score: h, away_score: a } },
      );
      alert(`Bonus liquidato ✓\n🏆 Vincitori: ${res.winners} / ${res.total_picks} pronostici`);
      await onChanged();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const settleScorer = async () => {
    if (!config) return;
    const name = scorerR.trim();
    if (!name) return alert('Inserisci il nome del primo marcatore');
    setBusy(true);
    try {
      const res = await api<{ winners: number; total_picks: number }>(
        `/bonus/configs/${config.id}/settle-scorer`,
        { method: 'POST', body: { player_name: name } },
      );
      alert(`Bonus liquidato ✓\n🏆 Vincitori: ${res.winners} / ${res.total_picks} pronostici`);
      await onChanged();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.card, { borderColor: c.primary, borderWidth: 1.5 }]}>
      <View style={styles.sectionHeader}>
        <View style={styles.dotsRow}>
          <View style={[styles.dot, { backgroundColor: c.dot1 }]} />
          <View style={[styles.dot, { backgroundColor: c.dot2 }]} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.sectionTitle, { color: c.primary }]}>{c.label}</Text>
          <Text style={styles.sectionSub}>{c.games}</Text>
        </View>
        {config && <StatusPill status={config.status} color={c.primary} />}
      </View>
      <Text style={styles.sectionDesc}>{c.desc}</Text>

      {/* No config → creation form */}
      {!config && (
        <>
          {type === 'exact_score' ? (
            <>
              <Text style={styles.fieldLabel}>Scegli il Big Match dal calendario</Text>
              {fixtures.length === 0 ? (
                <Text style={[styles.hint, { color: theme.colors.error }]}>
                  Nessuna partita disponibile. Carica il calendario da ScoreAndLive.
                </Text>
              ) : (
                <View style={styles.fxList}>
                  {fixtures.map((fx) => {
                    const key = `${fx.home_team}|${fx.away_team}`;
                    const active = selectedFx === key;
                    return (
                      <Pressable
                        key={key} onPress={() => setSelectedFx(key)}
                        style={[
                          styles.fxItem,
                          active && { backgroundColor: c.primary + '22', borderColor: c.primary },
                        ]}
                        testID={`admin-bonus-fx-${fx.home_team}`}
                      >
                        <Text style={styles.fxItemText}>{fx.home_team} vs {fx.away_team}</Text>
                        {active && <Ionicons name="checkmark-circle" size={18} color={c.primary} />}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </>
          ) : (
            <View style={styles.infoBox}>
              <Ionicons name="information-circle" size={16} color={c.primary} />
              <Text style={styles.infoText}>
                Nessuna selezione: i giocatori indovinano il primo marcatore della giornata.
              </Text>
            </View>
          )}
          <Pressable
            disabled={busy || !validMd || (type === 'exact_score' && !selectedFx)}
            onPress={createConfig}
            style={[
              styles.primaryBtn,
              { backgroundColor: c.primary },
              (busy || !validMd || (type === 'exact_score' && !selectedFx)) && { opacity: 0.5 },
            ]}
            testID={`admin-bonus-create-${type}`}
          >
            {busy ? <ActivityIndicator color="#fff" />
              : <Text style={styles.primaryBtnText}>Crea Bonus Giornata {matchday}</Text>}
          </Pressable>
        </>
      )}

      {/* Existing config */}
      {config && (
        <>
          {config.bonus_type === 'exact_score' && config.big_match && (
            <View style={styles.bigMatchBox}>
              <Text style={styles.bigMatchLabel}>BIG MATCH</Text>
              <Text style={styles.bigMatchTeams}>
                {config.big_match.home_team} vs {config.big_match.away_team}
              </Text>
            </View>
          )}
          {config.lock_at && config.status !== 'settled' && (
            <Text style={styles.hint}>
              🔒 Pronostici bloccati automaticamente il{' '}
              {new Date(config.lock_at).toLocaleString('it-IT')}
            </Text>
          )}
          {config.status === 'settled' && config.result && (
            <View style={[styles.resultBox, { backgroundColor: c.primary + '22' }]}>
              <Ionicons name="checkmark-done" size={18} color={c.primary} />
              <Text style={[styles.resultText, { color: c.primary }]}>
                Risultato: {type === 'exact_score'
                  ? `${config.result.home_score} - ${config.result.away_score}`
                  : config.result.player_name}
              </Text>
            </View>
          )}
          {/* Settle form */}
          {config.status !== 'settled' && (
            <>
              <Text style={[styles.fieldLabel, { marginTop: 4 }]}>Liquida ora:</Text>
              {type === 'exact_score' ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.miniLabel}>Gol casa</Text>
                    <TextInput
                      style={styles.input} value={homeR} onChangeText={setHomeR}
                      keyboardType="number-pad" maxLength={2}
                      placeholder="0" placeholderTextColor={theme.colors.muted}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.miniLabel}>Gol trasferta</Text>
                    <TextInput
                      style={styles.input} value={awayR} onChangeText={setAwayR}
                      keyboardType="number-pad" maxLength={2}
                      placeholder="0" placeholderTextColor={theme.colors.muted}
                    />
                  </View>
                </View>
              ) : (
                <TextInput
                  style={styles.input} value={scorerR} onChangeText={setScorerR}
                  placeholder="Es. Lautaro Martinez"
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="words"
                />
              )}
              <Pressable
                disabled={busy}
                onPress={type === 'exact_score' ? settleExact : settleScorer}
                style={[styles.primaryBtn, { backgroundColor: c.primary }, busy && { opacity: 0.5 }]}
                testID={`admin-bonus-settle-${type}`}
              >
                {busy ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.primaryBtnText}>Liquida e assegna premi</Text>}
              </Pressable>
            </>
          )}
          {/* Delete (only unsettled) */}
          {config.status !== 'settled' && (
            <Pressable
              disabled={busy}
              onPress={deleteConfig}
              style={styles.dangerBtn}
              testID={`admin-bonus-delete-${type}`}
            >
              <Ionicons name="trash" size={15} color={theme.colors.error} />
              <Text style={styles.dangerBtnText}>Elimina bonus giornata</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

function StatusPill({ status, color }: { status: 'open' | 'locked' | 'settled'; color: string }) {
  const map = {
    open: { bg: color + '22', fg: color, label: '⏳ Aperto', border: color + '55' },
    locked: { bg: theme.colors.muted + '22', fg: theme.colors.muted, label: '🔒 Bloccato', border: theme.colors.muted + '55' },
    settled: { bg: theme.colors.success + '22', fg: theme.colors.success, label: '✓ Liquidato', border: theme.colors.success + '55' },
  }[status];
  return (
    <View style={[styles.statusPill, { backgroundColor: map.bg, borderColor: map.border }]}>
      <Text style={[styles.statusPillText, { color: map.fg }]}>{map.label}</Text>
    </View>
  );
}

function RecentRow({ c, onJump }: { c: Config; onJump: (season: string, matchday: number) => void }) {
  const col = COLORS[c.bonus_type];
  return (
    <Pressable
      onPress={() => onJump(c.season, c.matchday)}
      style={styles.recentRow}
    >
      <View style={[styles.recentDot, { backgroundColor: col.primary }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.recentTitle}>
          Giornata {c.matchday} — {col.label}
        </Text>
        <Text style={styles.recentSub}>
          {c.big_match ? `${c.big_match.home_team} vs ${c.big_match.away_team}` : 'Primo marcatore'} · {c.season}
        </Text>
      </View>
      <StatusPill status={c.status} color={col.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  headerIcon: {
    width: 40, height: 40, borderRadius: theme.radius.md,
    backgroundColor: '#F59E0B',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: theme.colors.onSurface, fontSize: 20, fontWeight: '800' },
  sub: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  body: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 120 },

  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg, gap: theme.spacing.sm,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  cardLabel: {
    color: theme.colors.muted, fontSize: 11, fontWeight: '800',
    letterSpacing: 1.2, marginBottom: 4,
  },

  fieldLabel: {
    color: theme.colors.onSurfaceSecondary, fontSize: 12,
    fontWeight: '700', marginBottom: 4, marginTop: 4,
  },
  miniLabel: { color: theme.colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 4 },
  input: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border,
    color: theme.colors.onSurface, fontSize: 15,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  hint: { color: theme.colors.muted, fontSize: 12, fontStyle: 'italic', marginTop: 4 },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    marginBottom: 4,
  },
  dotsRow: { flexDirection: 'row', gap: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  sectionTitle: { fontSize: 16, fontWeight: '800' },
  sectionSub: { color: theme.colors.muted, fontSize: 11 },
  sectionDesc: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginBottom: 4 },

  statusPill: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  statusPillText: { fontSize: 11, fontWeight: '800' },

  fxList: {
    maxHeight: 220,
    borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.sm, backgroundColor: theme.colors.surface,
  },
  fxItem: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
    borderWidth: 1.5, borderColor: 'transparent',
    borderRadius: theme.radius.sm,
  },
  fxItemText: { color: theme.colors.onSurface, fontSize: 13, flex: 1 },
  infoBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
  },
  infoText: { color: theme.colors.onSurfaceSecondary, fontSize: 12, flex: 1 },

  bigMatchBox: {
    padding: theme.spacing.md, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    alignItems: 'center', gap: 4,
  },
  bigMatchLabel: {
    color: theme.colors.muted, fontSize: 10, fontWeight: '800',
    letterSpacing: 1.2,
  },
  bigMatchTeams: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 15 },

  resultBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
  },
  resultText: { fontWeight: '800', fontSize: 13 },

  primaryBtn: {
    paddingVertical: 12, borderRadius: theme.radius.md,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 6,
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  dangerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.error + '55',
    backgroundColor: theme.colors.error + '11',
    marginTop: 6,
  },
  dangerBtnText: { color: theme.colors.error, fontWeight: '700', fontSize: 12 },

  recentRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
  },
  recentDot: { width: 8, height: 8, borderRadius: 4 },
  recentTitle: { color: theme.colors.onSurface, fontSize: 13, fontWeight: '700' },
  recentSub: { color: theme.colors.muted, fontSize: 11, marginTop: 1 },
});
