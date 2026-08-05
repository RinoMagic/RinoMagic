/**
 * FantaGiornata — pitch-based lineup editor.
 *
 * The user picks a formation (module) and the pitch renders empty "+" slots
 * that, when tapped, open a bottom-sheet with the list of players available
 * for that specific role (P, D, C or A). Below the pitch there is a bench
 * area with 2P+2D+2C+2A slots. Everything works fully on the web preview
 * (no native-only Alerts, no gesture handlers).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as React from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput,
  Modal, Platform, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const COLOR = '#A855F7';
const PITCH_GREEN = '#0F7A3A';
const PITCH_GREEN_DARK = '#0B5C2C';
const PITCH_LINE = '#FFFFFF99';

const ROLES = ['P', 'D', 'C', 'A'] as const;
type Role = typeof ROLES[number];

type Player = { id: string; full_name: string; team: string; role: Role };

// module -> row shape for the pitch (defenders → midfielders → attackers).
// The GK row is always [1] and is not encoded here.
const MODULES: { key: string; rows: number[] }[] = [
  { key: '3-4-3', rows: [3, 4, 3] },
  { key: '3-5-2', rows: [3, 5, 2] },
  { key: '4-3-3', rows: [4, 3, 3] },
  { key: '4-4-2', rows: [4, 4, 2] },
  { key: '4-5-1', rows: [4, 5, 1] },
  { key: '5-3-2', rows: [5, 3, 2] },
  { key: '5-4-1', rows: [5, 4, 1] },
];

// A "slot" is a placeholder on the pitch or on the bench. Each starter/bench
// entry is keyed by (role, index) and holds the currently selected player id
// (or null if empty).
type SlotId = { role: Role; index: number };
type Slots = {
  starters: Record<Role, (string | null)[]>;
  bench: Record<Role, (string | null)[]>;
};

const BENCH_NEED: Record<Role, number> = { P: 2, D: 2, C: 2, A: 2 };
const ROLE_LABEL: Record<Role, string> = { P: 'Portiere', D: 'Difensore', C: 'Centrocampista', A: 'Attaccante' };
const ROLE_COLOR: Record<Role, string> = {
  P: '#F59E0B',  // yellow-orange
  D: '#22C55E',  // green
  C: '#3B82F6',  // blue
  A: '#EF4444',  // red
};

// Empty slot builder for a given module.
function emptySlots(moduleKey: string): Slots {
  const mod = MODULES.find((m) => m.key === moduleKey) || MODULES[0];
  const [d, c, a] = mod.rows;
  return {
    starters: {
      P: new Array(1).fill(null),
      D: new Array(d).fill(null),
      C: new Array(c).fill(null),
      A: new Array(a).fill(null),
    },
    bench: {
      P: new Array(BENCH_NEED.P).fill(null),
      D: new Array(BENCH_NEED.D).fill(null),
      C: new Array(BENCH_NEED.C).fill(null),
      A: new Array(BENCH_NEED.A).fill(null),
    },
  };
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
export default function LineupEditor() {
  const { id, matchday } = useLocalSearchParams<{ id: string; matchday: string }>();
  const router = useRouter();
  const md = parseInt(String(matchday || '1'), 10);

  const [module_, setModule] = useState<string>('4-3-3');
  const [slots, setSlots] = useState<Slots>(() => emptySlots('4-3-3'));
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ target: 'starters' | 'bench'; role: Role; index: number } | null>(null);

  const playerById = useMemo(() => {
    const m: Record<string, Player> = {};
    players.forEach((p) => { m[p.id] = p; });
    return m;
  }, [players]);

  // Load roster + existing lineup on focus
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api<Player[]>(`/sal/players?limit=1000`);
      setPlayers(list);
      const existing = await api<{ starters?: string[]; bench?: string[]; module?: string | null }>(
        `/fg/leagues/${id}/lineup/${md}`,
      );
      // Determine module first, then hydrate slots.
      const roleOf = (pid: string): Role | null => {
        const found = list.find((x) => x.id === pid);
        return found ? found.role : null;
      };
      const startersIds = existing.starters || [];
      const benchIds = existing.bench || [];
      let m = existing.module || null;
      if (!m && startersIds.length === 11) {
        // Infer from role counts.
        const c: Record<Role, number> = { P: 0, D: 0, C: 0, A: 0 };
        startersIds.forEach((pid) => {
          const r = roleOf(pid);
          if (r) c[r]++;
        });
        const key = `${c.D}-${c.C}-${c.A}`;
        if (MODULES.find((x) => x.key === key)) m = key;
      }
      m = m || '4-3-3';
      const s = emptySlots(m);
      // Place starters by role into positional slots.
      const byRole: Record<Role, string[]> = { P: [], D: [], C: [], A: [] };
      startersIds.forEach((pid) => {
        const r = roleOf(pid);
        if (r) byRole[r].push(pid);
      });
      (['P', 'D', 'C', 'A'] as Role[]).forEach((r) => {
        for (let i = 0; i < s.starters[r].length && i < byRole[r].length; i++) {
          s.starters[r][i] = byRole[r][i];
        }
      });
      // Bench
      const benchByRole: Record<Role, string[]> = { P: [], D: [], C: [], A: [] };
      benchIds.forEach((pid) => {
        const r = roleOf(pid);
        if (r) benchByRole[r].push(pid);
      });
      (['P', 'D', 'C', 'A'] as Role[]).forEach((r) => {
        for (let i = 0; i < s.bench[r].length && i < benchByRole[r].length; i++) {
          s.bench[r][i] = benchByRole[r][i];
        }
      });
      setModule(m);
      setSlots(s);
    } catch (e: any) {
      setError(e.message || 'Errore di caricamento');
    } finally { setLoading(false); }
  };
  useFocusEffect(useCallback(() => { load(); }, [id, md]));

  // Auto-clear success flag
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  // Changing module reshapes the D/C/A rows, trying to keep already-picked
  // players when possible. Players that don't fit go back to the roster.
  const applyModule = (key: string) => {
    if (key === module_) return;
    const next = emptySlots(key);
    // Keep GK & bench.
    next.starters.P[0] = slots.starters.P[0] || null;
    next.bench = slots.bench;
    // For D/C/A: keep first N picks that still fit.
    (['D', 'C', 'A'] as Role[]).forEach((r) => {
      const picks = (slots.starters[r] || []).filter((x): x is string => !!x);
      for (let i = 0; i < next.starters[r].length && i < picks.length; i++) {
        next.starters[r][i] = picks[i];
      }
    });
    setModule(key);
    setSlots(next);
  };

  // All picked ids (used to prevent duplicates in the picker)
  const pickedIds = useMemo(() => {
    const s = new Set<string>();
    (['P', 'D', 'C', 'A'] as Role[]).forEach((r) => {
      slots.starters[r].forEach((x) => x && s.add(x));
      slots.bench[r].forEach((x) => x && s.add(x));
    });
    return s;
  }, [slots]);

  const openPicker = (target: 'starters' | 'bench', role: Role, index: number) => {
    setPicker({ target, role, index });
  };

  const clearSlot = (target: 'starters' | 'bench', role: Role, index: number) => {
    setSlots((prev) => {
      const next = { ...prev };
      const arr = [...next[target][role]];
      arr[index] = null;
      next[target] = { ...next[target], [role]: arr };
      return next;
    });
  };

  const selectPlayer = (p: Player) => {
    if (!picker) return;
    setSlots((prev) => {
      const next = { ...prev };
      const arr = [...next[picker.target][picker.role]];
      arr[picker.index] = p.id;
      next[picker.target] = { ...next[picker.target], [picker.role]: arr };
      return next;
    });
    setPicker(null);
  };

  const flatStarters = useMemo(() => {
    const out: string[] = [];
    (['P', 'D', 'C', 'A'] as Role[]).forEach((r) => {
      slots.starters[r].forEach((x) => x && out.push(x));
    });
    return out;
  }, [slots]);

  const flatBench = useMemo(() => {
    const out: string[] = [];
    (['P', 'D', 'C', 'A'] as Role[]).forEach((r) => {
      slots.bench[r].forEach((x) => x && out.push(x));
    });
    return out;
  }, [slots]);

  const canSave = flatStarters.length === 11 && flatBench.length === 8;

  const save = async () => {
    if (!canSave) {
      setError('Completa i 11 titolari e le 8 riserve prima di salvare.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(`/fg/leagues/${id}/lineup`, {
        method: 'POST',
        body: {
          matchday: md,
          starters: flatStarters,
          bench: flatBench,
          module: module_,
        },
      });
      setSaved(true);
    } catch (e: any) {
      setError(e.message || 'Errore nel salvataggio');
    } finally { setSaving(false); }
  };

  const availableForPicker: Player[] = useMemo(() => {
    if (!picker) return [];
    // Show players matching the target role (except those already used in the
    // lineup — unless they are already sitting in this exact slot).
    // Sort: team asc, then full_name asc — so the picker shows one team's
    // players grouped together in the list.
    const currentId = slots[picker.target][picker.role][picker.index];
    return players
      .filter((p) => p.role === picker.role)
      .filter((p) => !pickedIds.has(p.id) || p.id === currentId)
      .sort((a, b) => {
        const t = a.team.localeCompare(b.team, 'it');
        if (t !== 0) return t;
        return a.full_name.localeCompare(b.full_name, 'it');
      });
  }, [picker, players, pickedIds, slots]);

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="back-button">
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Formazione · G{md}</Text>
            <Text style={styles.subtitle}>
              {flatStarters.length}/11 titolari · {flatBench.length}/8 panca
            </Text>
          </View>
          <Pressable onPress={save} hitSlop={12} disabled={saving || !canSave} testID="fg-lineup-save">
            {saving ? (
              <ActivityIndicator color={COLOR} />
            ) : (
              <View style={[styles.saveBtn, !canSave && { opacity: 0.5 }]}>
                <Ionicons name={saved ? 'checkmark-circle' : 'save'} size={18} color={saved ? theme.colors.success : '#fff'} />
                <Text style={styles.saveBtnText}>{saved ? 'Salvato' : 'Salva'}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator color={COLOR} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          {/* Module selector */}
          <View style={styles.moduleBar}>
            <Text style={styles.moduleLabel}>Modulo</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingRight: 12 }}>
              {MODULES.map((m) => {
                const active = m.key === module_;
                return (
                  <Pressable key={m.key} onPress={() => applyModule(m.key)}
                    style={[styles.moduleChip, active && { backgroundColor: COLOR, borderColor: COLOR }]}
                    testID={`fg-module-${m.key}`}>
                    <Text style={[styles.moduleText, active && { color: '#fff' }]}>{m.key}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={theme.colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Football pitch */}
          <Pitch
            slots={slots}
            playerById={playerById}
            module_={module_}
            onSlot={(role, index) => openPicker('starters', role, index)}
            onClear={(role, index) => clearSlot('starters', role, index)}
          />

          {/* Bench */}
          <Bench
            slots={slots.bench}
            playerById={playerById}
            onSlot={(role, index) => openPicker('bench', role, index)}
            onClear={(role, index) => clearSlot('bench', role, index)}
          />
        </ScrollView>
      )}

      {/* Player picker modal */}
      <PickerModal
        visible={!!picker}
        role={picker?.role || 'P'}
        target={picker?.target || 'starters'}
        players={availableForPicker}
        onSelect={selectPlayer}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pitch component
// ---------------------------------------------------------------------------
function Pitch({
  slots, playerById, module_, onSlot, onClear,
}: {
  slots: Slots;
  playerById: Record<string, Player>;
  module_: string;
  onSlot: (role: Role, index: number) => void;
  onClear: (role: Role, index: number) => void;
}) {
  const mod = MODULES.find((m) => m.key === module_) || MODULES[0];
  const [dCount, cCount, aCount] = mod.rows;

  return (
    <View style={styles.pitchWrap}>
      <View style={styles.pitch}>
        {/* Field markings */}
        <View style={styles.centerCircle} />
        <View style={styles.centerLine} />
        <View style={styles.topBox} />
        <View style={styles.bottomBox} />
        <View style={styles.topGoal} />
        <View style={styles.bottomGoal} />

        {/* Rows: A (top) -> C -> D -> P (bottom = your goal) */}
        <PitchRow role="A" count={aCount} slots={slots.starters.A} playerById={playerById} onSlot={onSlot} onClear={onClear} />
        <PitchRow role="C" count={cCount} slots={slots.starters.C} playerById={playerById} onSlot={onSlot} onClear={onClear} />
        <PitchRow role="D" count={dCount} slots={slots.starters.D} playerById={playerById} onSlot={onSlot} onClear={onClear} />
        <PitchRow role="P" count={1}      slots={slots.starters.P} playerById={playerById} onSlot={onSlot} onClear={onClear} />
      </View>
    </View>
  );
}

function PitchRow({
  role, count, slots, playerById, onSlot, onClear,
}: {
  role: Role;
  count: number;
  slots: (string | null)[];
  playerById: Record<string, Player>;
  onSlot: (role: Role, index: number) => void;
  onClear: (role: Role, index: number) => void;
}) {
  return (
    <View style={styles.pitchRow}>
      {Array.from({ length: count }).map((_, i) => {
        const pid = slots[i];
        const p = pid ? playerById[pid] : null;
        return (
          <SlotButton
            key={`${role}-${i}`}
            role={role}
            player={p}
            onPress={() => onSlot(role, i)}
            onClear={p ? () => onClear(role, i) : undefined}
            testID={`fg-slot-${role}-${i}`}
          />
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Slot button (on-pitch or bench)
// ---------------------------------------------------------------------------
function SlotButton({
  role, player, onPress, onClear, testID,
}: {
  role: Role;
  player: Player | null;
  onPress: () => void;
  onClear?: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.slotCol}>
      <Pressable onPress={onPress} style={styles.slotTouch} testID={testID}>
        {player ? (
          <View style={[styles.slotJerseyFilled, { backgroundColor: ROLE_COLOR[role] }]}>
            <Text style={styles.slotRoleBadge}>{role}</Text>
            {onClear && (
              <Pressable onPress={onClear} hitSlop={8} style={styles.slotClear}>
                <Ionicons name="close-circle" size={18} color="#fff" />
              </Pressable>
            )}
          </View>
        ) : (
          <View style={[styles.slotJerseyEmpty, { borderColor: ROLE_COLOR[role] + 'BB' }]}>
            <Ionicons name="add" size={26} color={ROLE_COLOR[role]} />
          </View>
        )}
      </Pressable>
      <View style={styles.slotLabelBox}>
        <Text style={styles.slotLabel} numberOfLines={1}>
          {player ? player.full_name : role}
        </Text>
        {player ? <Text style={styles.slotTeam} numberOfLines={1}>{player.team}</Text> : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Bench component (2P + 2D + 2C + 2A)
// ---------------------------------------------------------------------------
function Bench({
  slots, playerById, onSlot, onClear,
}: {
  slots: Record<Role, (string | null)[]>;
  playerById: Record<string, Player>;
  onSlot: (role: Role, index: number) => void;
  onClear: (role: Role, index: number) => void;
}) {
  return (
    <View style={styles.benchWrap}>
      <View style={styles.benchHeader}>
        <Ionicons name="people" size={16} color={COLOR} />
        <Text style={styles.benchTitle}>Panchina</Text>
        <Text style={styles.benchHint}>2P · 2D · 2C · 2A</Text>
      </View>
      {(['P', 'D', 'C', 'A'] as Role[]).map((r) => (
        <View key={r} style={styles.benchRow}>
          <View style={[styles.benchRoleTag, { backgroundColor: ROLE_COLOR[r] + '22', borderColor: ROLE_COLOR[r] }]}>
            <Text style={[styles.benchRoleText, { color: ROLE_COLOR[r] }]}>{r}</Text>
          </View>
          <View style={styles.benchSlots}>
            {slots[r].map((pid, i) => {
              const p = pid ? playerById[pid] : null;
              return (
                <SlotButton
                  key={`bench-${r}-${i}`}
                  role={r}
                  player={p}
                  onPress={() => onSlot(r, i)}
                  onClear={p ? () => onClear(r, i) : undefined}
                  testID={`fg-bench-${r}-${i}`}
                />
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Bottom-sheet-ish modal picker (works on web + native)
// ---------------------------------------------------------------------------
function PickerModal({
  visible, role, target, players, onSelect, onClose,
}: {
  visible: boolean;
  role: Role;
  target: 'starters' | 'bench';
  players: Player[];
  onSelect: (p: Player) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  useEffect(() => { if (!visible) setQ(''); }, [visible]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return players;
    return players.filter((p) =>
      p.full_name.toLowerCase().includes(s) || p.team.toLowerCase().includes(s),
    );
  }, [players, q]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <View style={[styles.sheetRoleDot, { backgroundColor: ROLE_COLOR[role] }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.sheetTitle}>
              {target === 'starters' ? 'Scegli titolare' : 'Scegli riserva'} · {ROLE_LABEL[role]}
            </Text>
            <Text style={styles.sheetSubtitle}>{filtered.length} disponibili</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={theme.colors.onSurface} />
          </Pressable>
        </View>
        <View style={styles.sheetSearchBox}>
          <Ionicons name="search" size={16} color={theme.colors.muted} />
          <TextInput
            style={styles.sheetSearch}
            value={q}
            onChangeText={setQ}
            placeholder="Cerca nome o squadra…"
            placeholderTextColor={theme.colors.muted}
            autoFocus
          />
          {q ? (
            <Pressable onPress={() => setQ('')} hitSlop={12}>
              <Ionicons name="close-circle" size={16} color={theme.colors.muted} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
          {filtered.length === 0 && (
            <Text style={styles.sheetEmpty}>Nessun giocatore trovato.</Text>
          )}
          {filtered.map((p, idx) => {
            const prev = idx > 0 ? filtered[idx - 1] : null;
            const isFirstOfTeam = !prev || prev.team !== p.team;
            return (
              <React.Fragment key={p.id}>
                {isFirstOfTeam && (
                  <View style={styles.sheetTeamHeader}>
                    <Text style={styles.sheetTeamHeaderText}>{p.team.toUpperCase()}</Text>
                  </View>
                )}
                <Pressable
                  onPress={() => onSelect(p)}
                  style={styles.sheetRow}
                  testID={`fg-pick-${p.id}`}
                >
                  <View style={[styles.roleBadge, { backgroundColor: ROLE_COLOR[p.role] + '33' }]}>
                    <Text style={[styles.roleBadgeText, { color: ROLE_COLOR[p.role] }]}>{p.role}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetRowName}>{p.full_name}</Text>
                    <Text style={styles.sheetRowTeam}>{p.team}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
                </Pressable>
              </React.Fragment>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const { width: SCREEN_W } = Dimensions.get('window');
const PITCH_W = Math.min(SCREEN_W - 24, 500);
const PITCH_H = Math.round(PITCH_W * 1.35);

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  loadingBox: { padding: 32, alignItems: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  title: { color: theme.colors.onSurface, fontSize: 17, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLOR,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: theme.radius.pill,
  },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  moduleBar: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
  },
  moduleLabel: { color: theme.colors.onSurfaceSecondary, fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
  moduleChip: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSecondary,
  },
  moduleText: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 13 },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: theme.spacing.md, marginBottom: 4,
    padding: 8, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.error + '18',
    borderLeftWidth: 3, borderLeftColor: theme.colors.error,
  },
  errorText: { color: theme.colors.error, fontSize: 12, fontWeight: '600', flex: 1 },

  // Pitch container
  pitchWrap: { alignItems: 'center', paddingHorizontal: 12, paddingTop: 6 },
  pitch: {
    width: PITCH_W, height: PITCH_H,
    backgroundColor: PITCH_GREEN,
    borderRadius: 12,
    borderWidth: 2, borderColor: PITCH_LINE,
    overflow: 'hidden',
    justifyContent: 'space-between',
    paddingVertical: 14,
    // subtle stripe overlay via inner shadow feel
    ...Platform.select({
      web: {
        // @ts-ignore web-only
        backgroundImage:
          `repeating-linear-gradient(0deg, ${PITCH_GREEN} 0px, ${PITCH_GREEN} 32px, ${PITCH_GREEN_DARK} 32px, ${PITCH_GREEN_DARK} 64px)`,
      },
      default: {},
    }),
  },
  centerCircle: {
    position: 'absolute', width: PITCH_W * 0.28, height: PITCH_W * 0.28,
    left: (PITCH_W - PITCH_W * 0.28) / 2, top: (PITCH_H - PITCH_W * 0.28) / 2,
    borderRadius: PITCH_W * 0.14,
    borderWidth: 1.5, borderColor: PITCH_LINE,
  },
  centerLine: {
    position: 'absolute', width: PITCH_W - 4, height: 1.5,
    left: 2, top: PITCH_H / 2,
    backgroundColor: PITCH_LINE,
  },
  topBox: {
    position: 'absolute', top: 0,
    left: (PITCH_W - PITCH_W * 0.55) / 2,
    width: PITCH_W * 0.55, height: PITCH_H * 0.13,
    borderWidth: 1.5, borderTopWidth: 0, borderColor: PITCH_LINE,
  },
  bottomBox: {
    position: 'absolute', bottom: 0,
    left: (PITCH_W - PITCH_W * 0.55) / 2,
    width: PITCH_W * 0.55, height: PITCH_H * 0.13,
    borderWidth: 1.5, borderBottomWidth: 0, borderColor: PITCH_LINE,
  },
  topGoal: {
    position: 'absolute', top: 0,
    left: (PITCH_W - PITCH_W * 0.25) / 2,
    width: PITCH_W * 0.25, height: PITCH_H * 0.05,
    borderWidth: 1.5, borderTopWidth: 0, borderColor: PITCH_LINE,
  },
  bottomGoal: {
    position: 'absolute', bottom: 0,
    left: (PITCH_W - PITCH_W * 0.25) / 2,
    width: PITCH_W * 0.25, height: PITCH_H * 0.05,
    borderWidth: 1.5, borderBottomWidth: 0, borderColor: PITCH_LINE,
  },
  pitchRow: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    width: '100%',
  },
  slotCol: { alignItems: 'center', gap: 4, width: 62 },
  slotTouch: { alignItems: 'center' },
  slotJerseyEmpty: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#ffffff22',
    borderWidth: 2, borderStyle: 'dashed',
  },
  slotJerseyFilled: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#ffffffcc',
    position: 'relative',
  },
  slotRoleBadge: { color: '#fff', fontWeight: '900', fontSize: 15, letterSpacing: 0.5 },
  slotClear: {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: '#00000099', borderRadius: 12,
  },
  slotLabelBox: { alignItems: 'center', maxWidth: 74 },
  slotLabel: { color: '#fff', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  slotTeam: { color: '#ffffffcc', fontSize: 9, fontStyle: 'italic', textAlign: 'center' },

  // Bench
  benchWrap: {
    marginTop: 16,
    marginHorizontal: 12,
    padding: 12,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.border,
    gap: 8,
  },
  benchHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  benchTitle: { color: theme.colors.onSurface, fontSize: 14, fontWeight: '800', flex: 1 },
  benchHint: { color: theme.colors.muted, fontSize: 11, fontWeight: '600' },
  benchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 4,
  },
  benchRoleTag: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  benchRoleText: { fontWeight: '900', fontSize: 13 },
  benchSlots: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },

  // Modal (bottom-sheet)
  backdrop: { flex: 1, backgroundColor: '#000000AA' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 12,
    maxHeight: '82%',
    ...Platform.select({
      web: { boxShadow: '0 -8px 24px rgba(0,0,0,0.4)' as any },
      default: {
        shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.35, shadowRadius: 12, elevation: 8,
      },
    }),
  },
  sheetHandle: {
    alignSelf: 'center', width: 44, height: 4, borderRadius: 4,
    backgroundColor: theme.colors.border, marginBottom: 10,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 8,
  },
  sheetRoleDot: { width: 12, height: 12, borderRadius: 6 },
  sheetTitle: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 15 },
  sheetSubtitle: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  sheetSearchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 12, paddingVertical: 8,
    marginBottom: 8,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  sheetSearch: { flex: 1, color: theme.colors.onSurface, fontSize: 13, padding: 0 },
  sheetEmpty: { color: theme.colors.muted, fontStyle: 'italic', padding: 16, textAlign: 'center' },
  sheetTeamHeader: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: theme.colors.surfaceSecondary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  sheetTeamHeaderText: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  sheetRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceSecondary,
    marginBottom: 6,
  },
  sheetRowName: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 14 },
  sheetRowTeam: { color: theme.colors.muted, fontSize: 11 },
  roleBadge: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  roleBadgeText: { fontWeight: '900', fontSize: 12 },
});
