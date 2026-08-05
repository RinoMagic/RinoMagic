/**
 * ScoreAndLive — pick a scorer for each fixture of a matchday.
 * Enforces:
 *  - selected player's team must be one of the fixture teams
 *  - blocked teams flagged (with deadlock override info)
 */
import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

const COLOR = '#3B82F6';

type Fixture = { idx: number; home_team: string; away_team: string; postponed_before?: boolean };
type Matchday = { id: string; matchday_number: number; status: string; fixtures: Fixture[]; my_picks?: { picks: { fixture_idx: number; player_id: string; player_name: string; team: string }[] } };
type Player = { id: string; full_name: string; team: string; role: string };
type BlockedPlayer = { player_id: string; full_name: string; team: string };

export default function PickPage() {
  const { id, matchday_id } = useLocalSearchParams<{ id: string; matchday_id: string }>();
  const router = useRouter();
  const [md, setMd] = useState<Matchday | null>(null);
  const [players, setPlayers] = useState<Record<string, Player[]>>({});
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [q, setQ] = useState<Record<number, string>>({});
  const [blockedPlayers, setBlockedPlayers] = useState<BlockedPlayer[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = async () => {
    try {
      const t = await api<any>(`/sal/tournaments/${id}`);
      setBlockedPlayers(t.my_blocked_players || []);
      const m = await api<Matchday>(`/sal/tournaments/${id}/matchdays/${matchday_id}`);
      setMd(m);
      // Preload picks
      const existing: Record<number, string> = {};
      m.my_picks?.picks?.forEach((p) => { existing[p.fixture_idx] = p.player_id; });
      setPicks(existing);
      // Preload players from all teams involved in the matchday
      const teams = new Set<string>();
      m.fixtures.forEach((f) => { teams.add(f.home_team); teams.add(f.away_team); });
      const map: Record<string, Player[]> = {};
      await Promise.all(Array.from(teams).map(async (team) => {
        const list = await api<Player[]>(`/sal/players?team=${encodeURIComponent(team)}&limit=200`);
        map[team.toLowerCase()] = list;
      }));
      setPlayers(map);
    } catch (e: any) { alert(e.message); }
  };
  useFocusEffect(useCallback(() => { load(); }, [id, matchday_id]));

  const blockedPlayerIds = useMemo(
    () => new Set(blockedPlayers.map((b) => b.player_id)),
    [blockedPlayers],
  );

  const submit = async () => {
    if (!md) return;
    const playable = md.fixtures.filter((f) => !f.postponed_before);
    const missing = playable.filter((f) => !picks[f.idx]);
    if (missing.length) return alert(`Manca il pick per ${missing.length} partita/e`);
    setSaving(true);
    try {
      await api(`/sal/tournaments/${id}/matchdays/${matchday_id}/picks`, {
        method: 'POST',
        body: { picks: playable.map((f) => ({ fixture_idx: f.idx, player_id: picks[f.idx] })) },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) { alert(e.message); } finally { setSaving(false); }
  };

  if (!md) return <View style={styles.center}><ActivityIndicator color={COLOR} /></View>;

  const playable = md.fixtures.filter((f) => !f.postponed_before);

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Marcatori · G{md.matchday_number}</Text>
            <Text style={styles.subtitle}>{Object.keys(picks).length}/{playable.length} scelti</Text>
          </View>
          <Pressable onPress={submit} hitSlop={12} disabled={saving} testID="sal-pick-submit">
            <Ionicons name={saved ? 'checkmark-circle' : 'send'} size={26} color={saved ? theme.colors.success : COLOR} />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.md, gap: theme.spacing.lg, paddingBottom: 80 }}>
        {blockedPlayers.length > 0 && (
          <View style={styles.blockedBanner}>
            <Ionicons name="lock-closed" size={14} color={theme.colors.muted} />
            <Text style={styles.blockedBannerText}>
              Giocatori bloccati ({blockedPlayers.length}): {blockedPlayers.slice(0, 5).map(b => b.full_name).join(', ')}
              {blockedPlayers.length > 5 ? ` +${blockedPlayers.length - 5}` : ''}
            </Text>
          </View>
        )}
        {playable.map((f) => {
          const teamPool = [
            ...(players[f.home_team.toLowerCase()] || []),
            ...(players[f.away_team.toLowerCase()] || []),
          ];
          const query = (q[f.idx] || '').toLowerCase();
          const filtered = teamPool.filter((p) =>
            !query || p.full_name.toLowerCase().includes(query)
          );
          const selectedId = picks[f.idx];
          return (
            <View key={f.idx} style={styles.card}>
              <View style={styles.fixHeader}>
                <Text style={styles.team}>{f.home_team}</Text>
                <Text style={styles.vs}>vs</Text>
                <Text style={styles.team}>{f.away_team}</Text>
              </View>
              <TextInput
                style={styles.input}
                placeholder="Cerca calciatore..."
                placeholderTextColor={theme.colors.muted}
                value={q[f.idx] || ''}
                onChangeText={(v) => setQ((s) => ({ ...s, [f.idx]: v }))}
              />
              <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                {filtered.slice(0, 100).map((p) => {
                  const isSelected = selectedId === p.id;
                  const isBlocked = blockedPlayerIds.has(p.id);
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => setPicks((s) => ({ ...s, [f.idx]: p.id }))}
                      style={[
                        styles.playerRow,
                        isSelected && { backgroundColor: COLOR + '22', borderColor: COLOR },
                        isBlocked && { opacity: 0.4 },
                      ]}
                      disabled={isBlocked}
                    >
                      <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{p.role}</Text></View>
                      <Text style={styles.playerName} numberOfLines={1}>{p.full_name}</Text>
                      <Text style={styles.playerTeam}>{p.team}</Text>
                      {isSelected && <Ionicons name="checkmark-circle" size={18} color={COLOR} />}
                      {isBlocked && <Ionicons name="lock-closed" size={14} color={theme.colors.error} />}
                    </Pressable>
                  );
                })}
                {filtered.length === 0 && <Text style={styles.muted}>Nessun giocatore.</Text>}
              </ScrollView>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.lg },
  title: { color: theme.colors.onSurface, fontSize: 17, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  card: {
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary, gap: theme.spacing.sm,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  fixHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md },
  team: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 15, flex: 1, textAlign: 'center' },
  vs: { color: theme.colors.muted, fontSize: 12 },
  blockedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  blockedBannerText: {
    color: theme.colors.muted, fontSize: 11, flex: 1, fontStyle: 'italic',
  },
  input: {
    color: theme.colors.onSurface, backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border, fontSize: 13,
  },
  playerRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm, marginBottom: 4,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  roleBadge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: COLOR + '33' },
  roleBadgeText: { color: COLOR, fontWeight: '800', fontSize: 12 },
  playerName: { color: theme.colors.onSurface, fontSize: 13, flex: 1, fontWeight: '600' },
  playerTeam: { color: theme.colors.muted, fontSize: 11 },
  muted: { color: theme.colors.muted, fontSize: 12, fontStyle: 'italic' },
});
