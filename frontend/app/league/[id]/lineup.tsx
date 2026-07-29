import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

type Player = { id: string; name: string; team: string; role: string };
type League = { id: string; name: string; current_matchday: number };

type Module = { name: string; d: number; c: number; a: number };

const MODULES: Module[] = [
  { name: '4-3-3', d: 4, c: 3, a: 3 },
  { name: '4-4-2', d: 4, c: 4, a: 2 },
  { name: '3-5-2', d: 3, c: 5, a: 2 },
  { name: '3-4-3', d: 3, c: 4, a: 3 },
  { name: '4-5-1', d: 4, c: 5, a: 1 },
  { name: '5-3-2', d: 5, c: 3, a: 2 },
];

const ROLE_COLOR: Record<string, string> = {
  P: theme.colors.brandSecondary,
  D: theme.colors.muted,
  C: theme.colors.success,
  A: theme.colors.error,
};

type SlotRole = 'P' | 'D' | 'C' | 'A';

// Bench composition: 2P + 2D + 2C + 2A (indices 11-18 in slots array)
const BENCH_ROLES: SlotRole[] = ['P', 'P', 'D', 'D', 'C', 'C', 'A', 'A'];

export default function LineupBuilder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [league, setLeague] = useState<League | null>(null);
  const [mod, setMod] = useState<Module>(MODULES[0]);
  // 0..10 = starters (module-driven), 11..18 = bench (fixed 2P+2D+2C+2A)
  const [slots, setSlots] = useState<(Player | null)[]>(() => Array(19).fill(null));
  const [pickerRole, setPickerRole] = useState<SlotRole | null>(null);
  const [pickerIndex, setPickerIndex] = useState<number>(-1);
  const [players, setPlayers] = useState<Player[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!id) return;
      const lg = await api<League>(`/leagues/${id}`);
      setLeague(lg);
      // Try load previous lineup
      try {
        const prev = await api<any>(`/leagues/${id}/lineups/${lg.current_matchday}`);
        if (prev && prev.starters && !prev.empty) {
          const found = MODULES.find((m) => m.name === prev.module);
          if (found) setMod(found);
          const allPlayers = await api<Player[]>('/players');
          const byId = new Map(allPlayers.map((p) => [p.id, p]));
          const next: (Player | null)[] = Array(19).fill(null);
          prev.starters.forEach((pid: string, i: number) => {
            next[i] = byId.get(pid) || null;
          });
          (prev.bench || []).forEach((pid: string, i: number) => {
            next[11 + i] = byId.get(pid) || null;
          });
          setSlots(next);
        }
      } catch {}
      setLoading(false);
    })();
  }, [id]);

  const starterRoles: SlotRole[] = useMemo(() => {
    const arr: SlotRole[] = ['P'];
    for (let i = 0; i < mod.d; i++) arr.push('D');
    for (let i = 0; i < mod.c; i++) arr.push('C');
    for (let i = 0; i < mod.a; i++) arr.push('A');
    return arr;
  }, [mod]);

  // when module changes, restructure STARTER slots preserving picks (bench untouched)
  useEffect(() => {
    setSlots((prev) => {
      const byRole: Record<SlotRole, Player[]> = { P: [], D: [], C: [], A: [] };
      // only starter slots (0..10) get reshuffled
      prev.slice(0, 11).forEach((p) => { if (p) byRole[p.role as SlotRole]?.push(p); });
      const nextStarters: (Player | null)[] = starterRoles.map((r) => byRole[r].shift() || null);
      return [...nextStarters, ...prev.slice(11, 19)];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod.name]);

  const openPicker = async (idx: number, role: SlotRole) => {
    setPickerIndex(idx);
    setPickerRole(role);
    setQ('');
    setPlayers([]);
    setBusy(true);
    try {
      const data = await api<Player[]>(`/players?role=${role}`);
      setPlayers(data);
    } finally {
      setBusy(false);
    }
  };

  const searchPlayers = async (text: string) => {
    setQ(text);
    if (!pickerRole) return;
    const params = new URLSearchParams({ role: pickerRole });
    if (text.trim()) params.append('q', text.trim());
    try {
      const data = await api<Player[]>(`/players?${params.toString()}`);
      setPlayers(data);
    } catch {}
  };

  const pickPlayer = (p: Player) => {
    setSlots((prev) => {
      const copy = [...prev];
      const dupIdx = copy.findIndex((x) => x?.id === p.id);
      if (dupIdx >= 0) copy[dupIdx] = null;
      copy[pickerIndex] = p;
      return copy;
    });
    setPickerRole(null);
  };

  const clearSlot = (idx: number) => {
    setSlots((prev) => {
      const copy = [...prev];
      copy[idx] = null;
      return copy;
    });
  };

  const startersFilled = slots.slice(0, 11).filter(Boolean).length;
  const benchFilled = slots.slice(11, 19).filter(Boolean).length;
  const filledCount = startersFilled + benchFilled;

  const save = async () => {
    if (!league) return;
    if (startersFilled !== 11) {
      setSavedMsg('Devi selezionare 11 titolari');
      return;
    }
    if (benchFilled !== 8) {
      setSavedMsg('Devi selezionare 8 giocatori in panchina (2P+2D+2C+2A)');
      return;
    }
    setBusy(true);
    try {
      await api(`/leagues/${league.id}/lineups`, {
        method: 'POST',
        body: {
          matchday: league.current_matchday,
          module: mod.name,
          starters: slots.slice(0, 11).map((p) => p!.id),
          bench: slots.slice(11, 19).map((p) => p!.id),
        },
      });
      setSavedMsg('Formazione salvata!');
      setTimeout(() => setSavedMsg(null), 2000);
    } catch (e: any) {
      setSavedMsg(e.message);
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

  // Group slots by role for pitch display
  const goalie = { idx: 0, player: slots[0], role: 'P' as SlotRole };
  const defs: { idx: number; player: Player | null }[] = [];
  const mids: { idx: number; player: Player | null }[] = [];
  const atts: { idx: number; player: Player | null }[] = [];
  let cursor = 1;
  for (let i = 0; i < mod.d; i++) defs.push({ idx: cursor++, player: slots[cursor - 1] });
  for (let i = 0; i < mod.c; i++) mids.push({ idx: cursor++, player: slots[cursor - 1] });
  for (let i = 0; i < mod.a; i++) atts.push({ idx: cursor++, player: slots[cursor - 1] });

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable
            testID="lineup-back"
            onPress={() => router.back()}
            hitSlop={12}
          >
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerSmall}>{league.name}</Text>
            <Text style={styles.headerBig}>Giornata {league.current_matchday}</Text>
          </View>
          <View style={styles.counter}>
            <Text style={styles.counterText}>{startersFilled}/11 · {benchFilled}/8</Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        {/* Module chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.moduleRow}
        >
          {MODULES.map((m) => {
            const active = m.name === mod.name;
            return (
              <Pressable
                key={m.name}
                testID={`module-chip-${m.name}`}
                onPress={() => setMod(m)}
                style={[styles.moduleChip, active && styles.moduleChipActive]}
              >
                <Text
                  style={[
                    styles.moduleChipText,
                    active && { color: theme.colors.onBrand, fontWeight: '800' },
                  ]}
                >
                  {m.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Pitch */}
        <View style={styles.pitchWrap}>
          <View style={styles.pitchBg}>
            {/* Field lines */}
            <View style={styles.centerLine} />
            <View style={styles.centerCircle} />
            <View style={styles.penaltyBoxTop} />
            <View style={styles.penaltyBoxBottom} />

            {/* Rows */}
            <View style={styles.pitchRow}>
              {atts.map((s) => (
                <SlotDot key={s.idx} slot={s.player} role="A" onPress={() => openPicker(s.idx, 'A')} onLongPress={() => clearSlot(s.idx)} testID={`slot-${s.idx}`} />
              ))}
            </View>
            <View style={styles.pitchRow}>
              {mids.map((s) => (
                <SlotDot key={s.idx} slot={s.player} role="C" onPress={() => openPicker(s.idx, 'C')} onLongPress={() => clearSlot(s.idx)} testID={`slot-${s.idx}`} />
              ))}
            </View>
            <View style={styles.pitchRow}>
              {defs.map((s) => (
                <SlotDot key={s.idx} slot={s.player} role="D" onPress={() => openPicker(s.idx, 'D')} onLongPress={() => clearSlot(s.idx)} testID={`slot-${s.idx}`} />
              ))}
            </View>
            <View style={styles.pitchRow}>
              <SlotDot slot={goalie.player} role="P" onPress={() => openPicker(0, 'P')} onLongPress={() => clearSlot(0)} testID="slot-0" />
            </View>
          </View>
          <Text style={styles.hint}>Tocca per scegliere · tieni premuto per rimuovere</Text>
        </View>

        {/* Panchina */}
        <View style={styles.benchWrap}>
          <View style={styles.benchHeader}>
            <Ionicons name="people" size={16} color={theme.colors.brand} />
            <Text style={styles.benchTitle}>Panchina</Text>
            <Text style={styles.benchSub}>2P · 2D · 2C · 2A</Text>
          </View>
          <View style={styles.benchGrid}>
            {BENCH_ROLES.map((role, i) => {
              const idx = 11 + i;
              const player = slots[idx];
              return (
                <SlotDot
                  key={idx}
                  slot={player}
                  role={role}
                  onPress={() => openPicker(idx, role)}
                  onLongPress={() => clearSlot(idx)}
                  testID={`bench-slot-${idx}`}
                />
              );
            })}
          </View>
        </View>

        {/* Save */}
        <View style={{ paddingHorizontal: theme.spacing.lg, marginTop: theme.spacing.md }}>
          <Pressable
            testID="save-lineup-button"
            onPress={save}
            disabled={busy}
            style={[styles.saveBtn, busy && { opacity: 0.6 }]}
          >
            {busy ? (
              <ActivityIndicator color={theme.colors.onBrand} />
            ) : (
              <Text style={styles.saveBtnText}>Salva Formazione</Text>
            )}
          </Pressable>
          {savedMsg && <Text style={styles.savedMsg}>{savedMsg}</Text>}
        </View>
      </ScrollView>

      {/* Player Picker Modal */}
      <Modal
        visible={pickerRole !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerRole(null)}
      >
        <View style={styles.modalWrap}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setPickerRole(null)}
          />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                Scegli {pickerRole === 'P' ? 'Portiere' : pickerRole === 'D' ? 'Difensore' : pickerRole === 'C' ? 'Centrocampista' : 'Attaccante'}
              </Text>
              <Pressable onPress={() => setPickerRole(null)}>
                <Ionicons name="close" size={24} color={theme.colors.onSurface} />
              </Pressable>
            </View>
            <View style={styles.sheetSearch}>
              <Ionicons name="search" size={18} color={theme.colors.muted} />
              <TextInput
                testID="picker-search"
                value={q}
                onChangeText={searchPlayers}
                placeholder="Cerca..."
                placeholderTextColor={theme.colors.muted}
                style={styles.sheetInput}
              />
            </View>
            <FlatList
              data={players}
              keyExtractor={(i) => i.id}
              contentContainerStyle={{ paddingBottom: 40 }}
              ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
              renderItem={({ item }) => {
                const chosen = slots.some((s) => s?.id === item.id);
                return (
                  <Pressable
                    testID={`pick-${item.id}`}
                    onPress={() => pickPlayer(item)}
                    style={[
                      styles.pickRow,
                      chosen && { borderColor: theme.colors.brand, opacity: 0.5 },
                    ]}
                  >
                    <View
                      style={[
                        styles.roleBadge,
                        { backgroundColor: (ROLE_COLOR[item.role] || theme.colors.muted) + '22' },
                      ]}
                    >
                      <Text style={[styles.roleBadgeText, { color: ROLE_COLOR[item.role] }]}>
                        {item.role}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickName}>{item.name}</Text>
                      <Text style={styles.pickTeam}>{item.team}</Text>
                    </View>
                    {chosen && (
                      <Ionicons name="checkmark-circle" size={20} color={theme.colors.brand} />
                    )}
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SlotDot({
  slot,
  role,
  onPress,
  onLongPress,
  testID,
}: {
  slot: Player | null;
  role: SlotRole;
  onPress: () => void;
  onLongPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.slotWrap}
    >
      <View
        style={[
          styles.slotCircle,
          { borderColor: ROLE_COLOR[role] },
          slot && { backgroundColor: ROLE_COLOR[role] + '33' },
        ]}
      >
        {slot ? (
          <Text style={styles.slotInitial}>
            {slot.name.split(' ').slice(-1)[0].slice(0, 3).toUpperCase()}
          </Text>
        ) : (
          <Text style={[styles.slotInitial, { color: ROLE_COLOR[role] }]}>{role}</Text>
        )}
      </View>
      <Text style={styles.slotName} numberOfLines={1}>
        {slot ? slot.name.split(' ').slice(-1)[0] : '—'}
      </Text>
      {slot && <Text style={styles.slotTeam} numberOfLines={1}>{slot.team}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.md,
  },
  headerSmall: { color: theme.colors.muted, fontSize: 12 },
  headerBig: { color: theme.colors.onSurface, fontSize: 20, fontWeight: '800' },
  counter: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brandTertiary,
    borderWidth: 1,
    borderColor: theme.colors.brand,
  },
  counterText: { color: theme.colors.brand, fontWeight: '800', fontSize: 13 },
  moduleRow: {
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
  },
  moduleChip: {
    height: 36,
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexShrink: 0,
  },
  moduleChipActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  moduleChipText: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 13 },
  pitchWrap: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
  },
  pitchBg: {
    height: 460,
    borderRadius: theme.radius.lg,
    backgroundColor: '#0F2A1A',
    padding: theme.spacing.md,
    justifyContent: 'space-around',
    borderWidth: 2,
    borderColor: '#1F5A38',
    overflow: 'hidden',
  },
  centerLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    backgroundColor: '#1F5A38',
  },
  centerCircle: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 1,
    borderColor: '#1F5A38',
    marginLeft: -35,
    marginTop: -35,
  },
  penaltyBoxTop: {
    position: 'absolute',
    left: '20%',
    right: '20%',
    top: 0,
    height: 40,
    borderWidth: 1,
    borderColor: '#1F5A38',
    borderTopWidth: 0,
  },
  penaltyBoxBottom: {
    position: 'absolute',
    left: '20%',
    right: '20%',
    bottom: 0,
    height: 40,
    borderWidth: 1,
    borderColor: '#1F5A38',
    borderBottomWidth: 0,
  },
  pitchRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  slotWrap: { alignItems: 'center', maxWidth: 80 },
  slotCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  slotInitial: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 12 },
  slotName: {
    color: theme.colors.onSurface,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
    maxWidth: 74,
  },
  slotTeam: {
    color: theme.colors.muted,
    fontSize: 9,
    maxWidth: 74,
  },
  hint: { color: theme.colors.muted, fontSize: 11, textAlign: 'center', marginTop: theme.spacing.sm },
  benchWrap: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.lg,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  benchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  benchTitle: {
    color: theme.colors.onSurface,
    fontWeight: '800',
    fontSize: 14,
    flex: 1,
  },
  benchSub: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  benchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    rowGap: theme.spacing.md,
  },
  saveBtn: {
    backgroundColor: theme.colors.brand,
    height: 52,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 16 },
  savedMsg: {
    color: theme.colors.brand,
    marginTop: theme.spacing.sm,
    textAlign: 'center',
    fontWeight: '700',
  },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    height: '75%',
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
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
  },
  sheetTitle: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 18 },
  sheetSearch: {
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
  sheetInput: {
    flex: 1,
    color: theme.colors.onSurface,
    paddingVertical: 10,
    fontSize: 15,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceTertiary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.md,
  },
  roleBadge: {
    width: 34,
    height: 34,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBadgeText: { fontWeight: '800' },
  pickName: { color: theme.colors.onSurface, fontWeight: '600', fontSize: 14 },
  pickTeam: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
});
