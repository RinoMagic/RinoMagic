/**
 * FantaGiornata — lineup editor: pick 11 starters + 8 bench (2P+2D+2C+2A).
 * Uses the /sal/players roster (shared with ScoreAndLive).
 */
import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

const COLOR = '#A855F7';
const ROLES = ['P', 'D', 'C', 'A'] as const;
type Role = typeof ROLES[number];

type Player = { id: string; full_name: string; team: string; role: Role };

const BENCH_NEED: Record<Role, number> = { P: 2, D: 2, C: 2, A: 2 };
const STARTER_LIMIT: Record<Role, [number, number]> = { P: [1, 1], D: [0, 5], C: [0, 5], A: [0, 5] };

export default function LineupEditor() {
  const { id, matchday } = useLocalSearchParams<{ id: string; matchday: string }>();
  const router = useRouter();
  const md = parseInt(String(matchday || '1'), 10);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [starters, setStarters] = useState<string[]>([]);
  const [bench, setBench] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'starters' | 'bench'>('starters');
  const [roleFilter, setRoleFilter] = useState<Role | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const list = await api<Player[]>(`/sal/players?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      setPlayers(list);
      const existing = await api<{ starters: string[]; bench: string[] }>(`/fg/leagues/${id}/lineup/${md}`);
      setStarters(existing.starters || []);
      setBench(existing.bench || []);
    } catch (e: any) { alert(e.message); } finally { setLoading(false); }
  };
  useFocusEffect(useCallback(() => { load(); }, [id, md]));

  const filteredPlayers = useMemo(() => {
    return players.filter((p) => !roleFilter || p.role === roleFilter);
  }, [players, roleFilter]);

  const roleCountsStarter = useMemo(() => {
    const c: Record<Role, number> = { P: 0, D: 0, C: 0, A: 0 };
    starters.forEach((id) => {
      const p = players.find((x) => x.id === id);
      if (p) c[p.role]++;
    });
    return c;
  }, [starters, players]);

  const roleCountsBench = useMemo(() => {
    const c: Record<Role, number> = { P: 0, D: 0, C: 0, A: 0 };
    bench.forEach((id) => {
      const p = players.find((x) => x.id === id);
      if (p) c[p.role]++;
    });
    return c;
  }, [bench, players]);

  const toggleStarter = (p: Player) => {
    if (starters.includes(p.id)) {
      setStarters(starters.filter((x) => x !== p.id));
      return;
    }
    if (bench.includes(p.id)) return; // already on bench
    if (starters.length >= 11) return alert('Max 11 titolari');
    const [, max] = STARTER_LIMIT[p.role];
    if (roleCountsStarter[p.role] >= max) return alert(`Max ${max} ${p.role} in formazione`);
    setStarters([...starters, p.id]);
  };

  const toggleBench = (p: Player) => {
    if (bench.includes(p.id)) {
      setBench(bench.filter((x) => x !== p.id));
      return;
    }
    if (starters.includes(p.id)) return;
    const need = BENCH_NEED[p.role];
    if (roleCountsBench[p.role] >= need) return alert(`Max ${need} ${p.role} in panchina`);
    setBench([...bench, p.id]);
  };

  const save = async () => {
    if (starters.length !== 11) return alert(`Servono 11 titolari (hai ${starters.length})`);
    if (bench.length !== 8) return alert(`Servono 8 riserve (hai ${bench.length})`);
    if (roleCountsStarter.P !== 1) return alert('Serve esattamente 1 portiere titolare');
    for (const r of ROLES) {
      if (roleCountsBench[r] !== BENCH_NEED[r]) return alert(`Panchina: servono ${BENCH_NEED[r]} ${r}`);
    }
    setSaving(true);
    try {
      await api(`/fg/leagues/${id}/lineup`, {
        method: 'POST',
        body: { matchday: md, starters, bench },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) { alert(e.message); } finally { setSaving(false); }
  };

  const renderList = (list: string[]) => {
    if (!list.length) return <Text style={styles.muted}>Nessuno selezionato.</Text>;
    return list.map((pid) => {
      const p = players.find((x) => x.id === pid);
      if (!p) return null;
      return (
        <View key={pid} style={styles.selRow}>
          <View style={[styles.roleBadge, { backgroundColor: COLOR + '33' }]}><Text style={styles.roleBadgeText}>{p.role}</Text></View>
          <Text style={styles.selName} numberOfLines={1}>{p.full_name}</Text>
          <Text style={styles.selTeam}>{p.team}</Text>
          <Pressable onPress={() => (tab === 'starters' ? toggleStarter(p) : toggleBench(p))} hitSlop={8}>
            <Ionicons name="close-circle" size={20} color={theme.colors.error} />
          </Pressable>
        </View>
      );
    });
  };

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Formazione · G{md}</Text>
            <Text style={styles.subtitle}>{starters.length}/11 titolari · {bench.length}/8 panca</Text>
          </View>
          <Pressable onPress={save} hitSlop={12} disabled={saving} testID="fg-lineup-save">
            <Ionicons name={saved ? 'checkmark-circle' : 'save'} size={26} color={saved ? theme.colors.success : COLOR} />
          </Pressable>
        </View>
      </SafeAreaView>

      <View style={styles.tabs}>
        {(['starters', 'bench'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)}
            style={[styles.tab, tab === t && { borderBottomColor: COLOR }]}>
            <Text style={[styles.tabText, tab === t && { color: COLOR }]}>
              {t === 'starters' ? `Titolari (${starters.length})` : `Panchina (${bench.length})`}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.selectionBox}>
        <ScrollView horizontal contentContainerStyle={{ gap: 6, alignItems: 'center' }} showsHorizontalScrollIndicator={false}>
          <Pressable onPress={() => setRoleFilter(null)}
            style={[styles.filterChip, !roleFilter && { backgroundColor: COLOR }]}>
            <Text style={[styles.filterText, !roleFilter && { color: '#fff' }]}>Tutti</Text>
          </Pressable>
          {ROLES.map((r) => (
            <Pressable key={r} onPress={() => setRoleFilter(r)}
              style={[styles.filterChip, roleFilter === r && { backgroundColor: COLOR }]}>
              <Text style={[styles.filterText, roleFilter === r && { color: '#fff' }]}>
                {r} {tab === 'starters' ? `${roleCountsStarter[r]}` : `${roleCountsBench[r]}/${BENCH_NEED[r]}`}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <TextInput
          style={[styles.input, { marginTop: 8 }]}
          placeholder="Cerca giocatore..." placeholderTextColor={theme.colors.muted}
          value={q} onChangeText={setQ} onSubmitEditing={load}
        />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: theme.spacing.md, gap: theme.spacing.sm, paddingBottom: 80 }}>
        <Text style={styles.section}>Selezionati ({tab === 'starters' ? starters.length : bench.length})</Text>
        {renderList(tab === 'starters' ? starters : bench)}

        <View style={styles.divider} />
        <Text style={styles.section}>Scegli dai giocatori disponibili</Text>
        {loading && <ActivityIndicator color={COLOR} />}
        {filteredPlayers.map((p) => {
          const inStart = starters.includes(p.id);
          const inBench = bench.includes(p.id);
          const selected = tab === 'starters' ? inStart : inBench;
          return (
            <Pressable
              key={p.id}
              onPress={() => (tab === 'starters' ? toggleStarter(p) : toggleBench(p))}
              style={[styles.playerRow, selected && { backgroundColor: COLOR + '22', borderColor: COLOR }]}
              disabled={tab === 'starters' ? inBench : inStart}
            >
              <View style={[styles.roleBadge, { backgroundColor: COLOR + '33' }]}>
                <Text style={styles.roleBadgeText}>{p.role}</Text>
              </View>
              <Text style={[styles.selName, { color: selected ? COLOR : theme.colors.onSurface }]} numberOfLines={1}>
                {p.full_name}
              </Text>
              <Text style={styles.selTeam}>{p.team}</Text>
              {selected && <Ionicons name="checkmark-circle" size={18} color={COLOR} />}
              {!selected && (tab === 'starters' ? inBench : inStart) && (
                <Text style={styles.tag}>{tab === 'starters' ? 'in panca' : 'titolare'}</Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  title: { color: theme.colors.onSurface, fontSize: 17, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  tab: {
    flex: 1, paddingVertical: 12, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabText: { color: theme.colors.muted, fontWeight: '700', fontSize: 13 },
  selectionBox: { padding: theme.spacing.md, gap: 6, backgroundColor: theme.colors.surfaceSecondary },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  filterText: { color: theme.colors.onSurface, fontSize: 12, fontWeight: '700' },
  input: {
    color: theme.colors.onSurface, backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border, fontSize: 13,
  },
  section: { color: theme.colors.onSurfaceSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  muted: { color: theme.colors.muted, fontSize: 12, fontStyle: 'italic' },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: 8 },
  selRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceSecondary,
  },
  playerRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  roleBadge: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  roleBadgeText: { color: COLOR, fontWeight: '800', fontSize: 12 },
  selName: { color: theme.colors.onSurface, fontSize: 14, flex: 1, fontWeight: '600' },
  selTeam: { color: theme.colors.muted, fontSize: 11 },
  tag: { color: theme.colors.warning, fontSize: 10, fontWeight: '700', fontStyle: 'italic' },
});
