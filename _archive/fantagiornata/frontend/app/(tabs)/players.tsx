import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

type Player = { id: string; name: string; team: string; role: string };

const ROLES: Array<{ code: string | null; label: string }> = [
  { code: null, label: 'Tutti' },
  { code: 'P', label: 'Portieri' },
  { code: 'D', label: 'Difensori' },
  { code: 'C', label: 'Centrocamp.' },
  { code: 'A', label: 'Attaccanti' },
];

const ROLE_COLOR: Record<string, string> = {
  P: theme.colors.brandSecondary,
  D: theme.colors.muted,
  C: theme.colors.success,
  A: theme.colors.error,
};

export default function Players() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [team, setTeam] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const loadTeams = useCallback(async () => {
    try {
      const t = await api<string[]>('/teams');
      setTeams(t);
    } catch {}
  }, []);

  const runSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await api<{ ok: boolean; players_synced: number; teams: number; season: number }>(
        '/players/sync',
        { method: 'POST' }
      );
      setSyncMsg(`Rosa aggiornata: ${res.players_synced} giocatori (stagione ${res.season})`);
      await loadTeams();
      // Trigger reload of current filter
      setQ((v) => v);
    } catch (e: any) {
      setSyncMsg(e.message || 'Errore sync');
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 5000);
    }
  };

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (role) params.append('role', role);
        if (team) params.append('team', team);
        if (q.trim()) params.append('q', q.trim());
        const p = await api<Player[]>(`/players?${params.toString()}`);
        setPlayers(p);
      } finally {
        setLoading(false);
      }
    })();
  }, [role, team, q]);

  const grouped = useMemo(() => players, [players]);

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Rosa Serie A</Text>
            <Text style={styles.subtitle}>{players.length} giocatori</Text>
          </View>
          <Pressable
            testID="sync-players-button"
            onPress={runSync}
            disabled={syncing}
            style={[styles.syncBtn, syncing && { opacity: 0.5 }]}
            hitSlop={10}
          >
            {syncing ? (
              <ActivityIndicator color={theme.colors.brand} size="small" />
            ) : (
              <Ionicons name="refresh" size={18} color={theme.colors.brand} />
            )}
            <Text style={styles.syncBtnText}>Aggiorna</Text>
          </Pressable>
        </View>
        {syncMsg && (
          <View testID="sync-message" style={styles.syncMsgBox}>
            <Text style={styles.syncMsgText}>{syncMsg}</Text>
          </View>
        )}
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={theme.colors.muted} />
          <TextInput
            testID="players-search-input"
            placeholder="Cerca giocatore..."
            placeholderTextColor={theme.colors.muted}
            value={q}
            onChangeText={setQ}
            style={styles.searchInput}
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ('')}>
              <Ionicons name="close-circle" size={18} color={theme.colors.muted} />
            </Pressable>
          )}
        </View>

        {/* Role chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={styles.chipsScroller}
        >
          {ROLES.map((r) => {
            const active = role === r.code;
            return (
              <Pressable
                key={r.label}
                testID={`role-chip-${r.code || 'all'}`}
                onPress={() => setRole(r.code)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {r.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Team chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={styles.chipsScroller}
        >
          <Pressable
            testID="team-chip-all"
            onPress={() => setTeam(null)}
            style={[styles.chipSmall, team === null && styles.chipActive]}
          >
            <Text style={[styles.chipText, team === null && styles.chipTextActive]}>
              Tutte
            </Text>
          </Pressable>
          {teams.map((t) => {
            const active = team === t;
            return (
              <Pressable
                key={t}
                testID={`team-chip-${t}`}
                onPress={() => setTeam(t)}
                style={[styles.chipSmall, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{t}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={theme.colors.brand} />
        </View>
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={{ color: theme.colors.muted }}>Nessun giocatore trovato</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View
                style={[
                  styles.roleBadge,
                  { backgroundColor: (ROLE_COLOR[item.role] || theme.colors.muted) + '22' },
                ]}
              >
                <Text style={[styles.roleText, { color: ROLE_COLOR[item.role] }]}>
                  {item.role}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.playerName}>{item.name}</Text>
                <Text style={styles.playerTeam}>{item.team}</Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.colors.surfaceSecondary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.brand,
  },
  syncBtnText: { color: theme.colors.brand, fontWeight: '700', fontSize: 12 },
  syncMsgBox: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.sm,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  syncMsgText: { color: theme.colors.onSurfaceSecondary, fontSize: 12 },
  title: { color: theme.colors.onSurface, fontSize: 26, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, fontSize: 13, marginTop: 2 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.onSurface,
    paddingVertical: 12,
    fontSize: 15,
  },
  chipsScroller: { marginTop: theme.spacing.md },
  chipsRow: {
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  chip: {
    paddingHorizontal: 16,
    height: 36,
    justifyContent: 'center',
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexShrink: 0,
  },
  chipSmall: {
    paddingHorizontal: 12,
    height: 32,
    justifyContent: 'center',
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexShrink: 0,
  },
  chipActive: {
    backgroundColor: theme.colors.brand,
    borderColor: theme.colors.brand,
  },
  chipText: { color: theme.colors.onSurface, fontWeight: '600', fontSize: 12 },
  chipTextActive: { color: theme.colors.onBrand, fontWeight: '800' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  roleBadge: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleText: { fontWeight: '800', fontSize: 14 },
  playerName: { color: theme.colors.onSurface, fontWeight: '600', fontSize: 15 },
  playerTeam: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { padding: theme.spacing.xxl, alignItems: 'center' },
});
