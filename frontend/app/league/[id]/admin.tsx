import { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Modal,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

type Player = { id: string; name: string; team: string; role: string };
type League = { id: string; name: string; current_matchday: number; is_owner: boolean };
type Vote = {
  player_id: string;
  voto: number;
  gol: number;
  assist: number;
  ammoniz: boolean;
  espuls: boolean;
  autogol: number;
  gol_subiti: number;
  rigore_segnato: number;
  rigore_sbagliato: number;
  fantavoto: number;
};

const emptyVote = (pid: string): Vote => ({
  player_id: pid,
  voto: 6.0,
  gol: 0,
  assist: 0,
  ammoniz: false,
  espuls: false,
  autogol: 0,
  gol_subiti: 0,
  rigore_segnato: 0,
  rigore_sbagliato: 0,
  fantavoto: 6.0,
});

export default function AdminVotes() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [league, setLeague] = useState<League | null>(null);
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [votes, setVotes] = useState<Record<string, Vote>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [q, setQ] = useState('');
  const [playersList, setPlayersList] = useState<Player[]>([]);
  const [matchday, setMatchday] = useState(1);

  useEffect(() => {
    (async () => {
      if (!id) return;
      const lg = await api<League>(`/leagues/${id}`);
      setLeague(lg);
      setMatchday(lg.current_matchday);
      // Load ALL players for lookup
      const all = await api<Player[]>('/players');
      setPlayersList(all);
      const map: Record<string, Player> = {};
      all.forEach((p) => { map[p.id] = p; });
      setPlayers(map);
      // Load existing votes
      try {
        const existing = await api<Vote[]>(`/leagues/${id}/votes/${lg.current_matchday}`);
        const vm: Record<string, Vote> = {};
        existing.forEach((v) => { vm[v.player_id] = v; });
        setVotes(vm);
      } catch {}
      setLoading(false);
    })();
  }, [id]);

  const loadVotesForMatchday = async (md: number) => {
    if (!id) return;
    try {
      const existing = await api<Vote[]>(`/leagues/${id}/votes/${md}`);
      const vm: Record<string, Vote> = {};
      existing.forEach((v) => { vm[v.player_id] = v; });
      setVotes(vm);
    } catch {
      setVotes({});
    }
  };

  const changeMatchday = async (delta: number) => {
    const next = Math.max(1, matchday + delta);
    setMatchday(next);
    await loadVotesForMatchday(next);
  };

  const filteredPlayers = useMemo(() => {
    if (!q.trim()) return playersList;
    return playersList.filter((p) =>
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      p.team.toLowerCase().includes(q.toLowerCase())
    );
  }, [q, playersList]);

  const addPlayer = (p: Player) => {
    setVotes((v) => ({ ...v, [p.id]: emptyVote(p.id) }));
    setPickerOpen(false);
    setQ('');
  };

  const updateVote = (pid: string, patch: Partial<Vote>) => {
    setVotes((v) => ({ ...v, [pid]: { ...v[pid], ...patch } as Vote }));
  };

  const removeVote = (pid: string) => {
    setVotes((v) => {
      const c = { ...v };
      delete c[pid];
      return c;
    });
  };

  const save = async () => {
    if (!league) return;
    setBusy(true);
    setMsg(null);
    try {
      const items = Object.values(votes);
      await api(`/leagues/${league.id}/votes`, {
        method: 'POST',
        body: { matchday, votes: items },
      });
      setMsg(`Salvati ${items.length} voti per giornata ${matchday}`);
      setTimeout(() => setMsg(null), 2500);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const advanceMatchday = async () => {
    if (!league) return;
    setBusy(true);
    try {
      const upd = await api<League>(`/leagues/${league.id}/advance`, { method: 'POST' });
      setLeague(upd);
      setMatchday(upd.current_matchday);
      await loadVotesForMatchday(upd.current_matchday);
      setMsg(`Nuova giornata: ${upd.current_matchday}`);
      setTimeout(() => setMsg(null), 2500);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !league) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.brand} />
      </View>
    );
  }

  if (!league.is_owner) {
    return (
      <View style={styles.center}>
        <Text style={{ color: theme.colors.muted }}>Accesso admin richiesto</Text>
      </View>
    );
  }

  const voteEntries = Object.values(votes);

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="admin-back">
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>Gestione Voti</Text>
          <View style={{ width: 26 }} />
        </View>
      </SafeAreaView>

      <View style={styles.mdSelector}>
        <Pressable
          testID="md-prev"
          onPress={() => changeMatchday(-1)}
          style={styles.mdBtn}
        >
          <Ionicons name="chevron-back" size={20} color={theme.colors.onSurface} />
        </Pressable>
        <View style={styles.mdInfo}>
          <Text style={styles.mdLabel}>GIORNATA</Text>
          <Text style={styles.mdValue}>{matchday}</Text>
        </View>
        <Pressable
          testID="md-next"
          onPress={() => changeMatchday(1)}
          style={styles.mdBtn}
        >
          <Ionicons name="chevron-forward" size={20} color={theme.colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 160 }}>
        <Pressable
          testID="add-player-vote"
          onPress={() => setPickerOpen(true)}
          style={styles.addBtn}
        >
          <Ionicons name="add-circle" size={20} color={theme.colors.brand} />
          <Text style={styles.addBtnText}>Aggiungi giocatore</Text>
        </Pressable>

        {voteEntries.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Aggiungi i giocatori che hanno giocato e inserisci voti + bonus/malus.
            </Text>
          </View>
        )}

        {voteEntries.map((v) => {
          const p = players[v.player_id];
          if (!p) return null;
          return (
            <View key={v.player_id} style={styles.voteCard}>
              <View style={styles.voteHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.voteName}>{p.name}</Text>
                  <Text style={styles.voteMeta}>{p.team} · {p.role}</Text>
                </View>
                <Pressable
                  testID={`remove-vote-${p.id}`}
                  onPress={() => removeVote(p.id)}
                  hitSlop={10}
                >
                  <Ionicons name="trash" size={18} color={theme.colors.error} />
                </Pressable>
              </View>

              <View style={styles.voteRow}>
                <Text style={styles.voteLabel}>Voto</Text>
                <TextInput
                  testID={`voto-${p.id}`}
                  keyboardType="decimal-pad"
                  value={String(v.voto)}
                  onChangeText={(t) => {
                    const n = parseFloat(t.replace(',', '.'));
                    updateVote(p.id, { voto: isNaN(n) ? 0 : n });
                  }}
                  style={styles.voteInput}
                />
              </View>

              <NumRow label="Gol" value={v.gol} onChange={(n) => updateVote(p.id, { gol: n })} testID={`gol-${p.id}`} />
              <NumRow label="Assist" value={v.assist} onChange={(n) => updateVote(p.id, { assist: n })} testID={`assist-${p.id}`} />
              <NumRow label="Rig. segnati" value={v.rigore_segnato} onChange={(n) => updateVote(p.id, { rigore_segnato: n })} testID={`rigseg-${p.id}`} />
              <NumRow label="Rig. sbagliati" value={v.rigore_sbagliato} onChange={(n) => updateVote(p.id, { rigore_sbagliato: n })} testID={`rigsba-${p.id}`} />
              <NumRow label="Autogol" value={v.autogol} onChange={(n) => updateVote(p.id, { autogol: n })} testID={`autog-${p.id}`} />
              {p.role === 'P' && (
                <NumRow label="Gol subiti" value={v.gol_subiti} onChange={(n) => updateVote(p.id, { gol_subiti: n })} testID={`golsub-${p.id}`} />
              )}
              <View style={styles.toggleRow}>
                <Pressable
                  testID={`ammon-${p.id}`}
                  onPress={() => updateVote(p.id, { ammoniz: !v.ammoniz })}
                  style={[styles.toggle, v.ammoniz && styles.toggleOn]}
                >
                  <Text style={[styles.toggleText, v.ammoniz && { color: '#000' }]}>Amm.</Text>
                </Pressable>
                <Pressable
                  testID={`esp-${p.id}`}
                  onPress={() => updateVote(p.id, { espuls: !v.espuls })}
                  style={[styles.toggle, v.espuls && styles.toggleOnRed]}
                >
                  <Text style={[styles.toggleText, v.espuls && { color: '#fff' }]}>Esp.</Text>
                </Pressable>
              </View>
            </View>
          );
        })}

        {league.is_owner && (
          <Pressable
            testID="advance-matchday"
            onPress={advanceMatchday}
            style={styles.advanceBtn}
          >
            <Ionicons name="play-forward" size={16} color={theme.colors.brandSecondary} />
            <Text style={styles.advanceText}>Passa alla giornata successiva</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Footer save */}
      <View style={styles.footer}>
        {msg && <Text style={styles.msg}>{msg}</Text>}
        <Pressable
          testID="save-votes"
          onPress={save}
          disabled={busy || voteEntries.length === 0}
          style={[styles.saveBtn, (busy || voteEntries.length === 0) && { opacity: 0.5 }]}
        >
          {busy ? (
            <ActivityIndicator color={theme.colors.onBrand} />
          ) : (
            <Text style={styles.saveBtnText}>Salva Voti ({voteEntries.length})</Text>
          )}
        </Pressable>
      </View>

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalWrap}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPickerOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Aggiungi giocatore</Text>
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={18} color={theme.colors.muted} />
              <TextInput
                testID="admin-search"
                value={q}
                onChangeText={setQ}
                placeholder="Cerca..."
                placeholderTextColor={theme.colors.muted}
                style={styles.searchInput}
                autoFocus
              />
            </View>
            <FlatList
              data={filteredPlayers.slice(0, 100)}
              keyExtractor={(i) => i.id}
              ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
              renderItem={({ item }) => (
                <Pressable
                  testID={`admin-pick-${item.id}`}
                  onPress={() => addPlayer(item)}
                  style={styles.pickRow}
                >
                  <Text style={styles.pickRole}>{item.role}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickName}>{item.name}</Text>
                    <Text style={styles.pickTeam}>{item.team}</Text>
                  </View>
                  {votes[item.id] && (
                    <Ionicons name="checkmark-circle" size={20} color={theme.colors.brand} />
                  )}
                </Pressable>
              )}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function NumRow({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  testID?: string;
}) {
  return (
    <View style={styles.numRow}>
      <Text style={styles.numLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          onPress={() => onChange(Math.max(0, value - 1))}
          style={styles.stepBtn}
          testID={`${testID}-minus`}
        >
          <Ionicons name="remove" size={16} color={theme.colors.onSurface} />
        </Pressable>
        <Text testID={testID} style={styles.stepValue}>{value}</Text>
        <Pressable
          onPress={() => onChange(value + 1)}
          style={styles.stepBtn}
          testID={`${testID}-plus`}
        >
          <Ionicons name="add" size={16} color={theme.colors.onSurface} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  headerTitle: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 18 },
  mdSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.lg,
    marginHorizontal: theme.spacing.lg,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  mdBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.surfaceTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mdInfo: { alignItems: 'center', minWidth: 90 },
  mdLabel: { color: theme.colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  mdValue: { color: theme.colors.onSurface, fontSize: 26, fontWeight: '800' },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.brand,
    borderStyle: 'dashed',
    borderRadius: theme.radius.md,
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
  },
  addBtnText: { color: theme.colors.brand, fontWeight: '700' },
  empty: {
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  emptyText: { color: theme.colors.muted, textAlign: 'center' },
  voteCard: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  voteHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  voteName: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 15 },
  voteMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  voteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.spacing.xs,
  },
  voteLabel: { color: theme.colors.onSurface, fontWeight: '700' },
  voteInput: {
    backgroundColor: theme.colors.surfaceTertiary,
    color: theme.colors.onSurface,
    fontWeight: '800',
    fontSize: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.sm,
    minWidth: 80,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  numRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  numLabel: { color: theme.colors.onSurfaceSecondary, fontSize: 13 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.colors.surfaceTertiary,
    borderRadius: theme.radius.pill,
    padding: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    color: theme.colors.onSurface,
    fontWeight: '800',
    minWidth: 20,
    textAlign: 'center',
  },
  toggleRow: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.xs },
  toggle: {
    flex: 1,
    padding: 8,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceTertiary,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  toggleOn: { backgroundColor: theme.colors.warning, borderColor: theme.colors.warning },
  toggleOnRed: { backgroundColor: theme.colors.error, borderColor: theme.colors.error },
  toggleText: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 12 },
  advanceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    marginTop: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.brandSecondary,
  },
  advanceText: { color: theme.colors.brandSecondary, fontWeight: '800' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  msg: { color: theme.colors.brand, textAlign: 'center', marginBottom: theme.spacing.sm },
  saveBtn: {
    backgroundColor: theme.colors.brand,
    height: 52,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 16 },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    height: '80%',
    backgroundColor: theme.colors.surfaceSecondary,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    padding: theme.spacing.lg,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: theme.colors.borderStrong,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: theme.spacing.md,
  },
  sheetTitle: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 18, marginBottom: theme.spacing.md },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceTertiary,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  searchInput: { flex: 1, color: theme.colors.onSurface, paddingVertical: 10 },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceTertiary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pickRole: {
    color: theme.colors.brand,
    fontWeight: '800',
    width: 24,
    textAlign: 'center',
  },
  pickName: { color: theme.colors.onSurface, fontWeight: '600' },
  pickTeam: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
});
