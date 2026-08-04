/*
 * /fantagiornata/[id]/lineups — Public "everyone's lineups" viewer.
 *
 * Renders every member's lineup for a given matchday. Visibility follows the
 * global deadline rule (same logic as Survival's classifica modal):
 *   - Before the deadline: only the caller sees their own lineup; the others
 *     are shown with a "hidden until deadline" placeholder.
 *   - After the deadline: everyone's lineup is fully visible.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { MatchdayCountdown } from '@/src/components/MatchdayCountdown';

const COLOR = '#A855F7';

type Player = {
  id: string; full_name: string; team: string; role: string;
};
type MemberLineup = {
  user_id: string;
  nickname: string | null;
  has_lineup: boolean;
  hidden: boolean;
  matchday?: number;
  module?: string | null;
  starters?: (Player | null)[];
  bench?: (Player | null)[];
  updated_at?: string;
};
type Resp = {
  league_id: string;
  matchday: number;
  deadline_passed: boolean;
  members: MemberLineup[];
};

const ROLE_ORDER = ['P', 'D', 'C', 'A'] as const;

export default function AllLineups() {
  const { id, matchday: initialMd } = useLocalSearchParams<{ id: string; matchday?: string }>();
  const router = useRouter();
  const [md, setMd] = useState<string>((initialMd as string) || '1');
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const mdNum = Number(md);
    if (!Number.isFinite(mdNum) || mdNum < 1 || mdNum > 38) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<Resp>(`/fg/leagues/${id}/lineups/${mdNum}`);
      setData(r);
    } catch (e: any) {
      setErr(e.message || 'Errore');
    } finally {
      setBusy(false);
    }
  }, [id, md]);

  useEffect(() => { load(); }, [load]);

  const toggle = (uid: string) => setExpanded((s) => ({ ...s, [uid]: !s[uid] }));

  const renderRole = (players: (Player | null)[] | undefined, role: string) => {
    if (!players) return null;
    const list = players.filter((p): p is Player => !!p && p.role === role);
    if (list.length === 0) return null;
    return (
      <View key={role} style={styles.roleGroup}>
        <Text style={styles.roleLabel}>{role}</Text>
        <View style={styles.roleList}>
          {list.map((p) => (
            <View key={p.id} style={styles.playerChip}>
              <Text style={styles.playerName} numberOfLines={1}>{p.full_name}</Text>
              <Text style={styles.playerTeam}>{p.team}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="fg-lineups-back">
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Formazioni della giornata</Text>
            <Text style={styles.subtitle}>Visibili a tutti dopo la deadline</Text>
          </View>
          <Ionicons name="people" size={22} color={COLOR} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120, gap: theme.spacing.md }}>
        <MatchdayCountdown matchday={Number(md) || undefined} />

        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.cardTitle}>Giornata</Text>
            <TextInput
              style={styles.input}
              value={md}
              onChangeText={setMd}
              keyboardType="number-pad"
              placeholder="1..38"
              placeholderTextColor={theme.colors.muted}
              testID="fg-lineups-md"
            />
            <Pressable
              onPress={load}
              disabled={busy}
              style={[styles.reload, { backgroundColor: COLOR, opacity: busy ? 0.5 : 1 }]}
              testID="fg-lineups-reload"
            >
              {busy
                ? <ActivityIndicator color="#fff" size="small" />
                : <Ionicons name="refresh" size={16} color="#fff" />}
            </Pressable>
          </View>
          {data && (
            <View style={[
              styles.stateBox,
              data.deadline_passed
                ? { backgroundColor: theme.colors.success + '22' }
                : { backgroundColor: theme.colors.error + '15' },
            ]}>
              <Ionicons
                name={data.deadline_passed ? 'eye' : 'eye-off'}
                size={14}
                color={data.deadline_passed ? theme.colors.success : theme.colors.error}
              />
              <Text style={[
                styles.stateText,
                { color: data.deadline_passed ? theme.colors.success : theme.colors.error },
              ]}>
                {data.deadline_passed
                  ? 'Deadline scaduta: tutte le formazioni sono visibili'
                  : 'Deadline attiva: le formazioni degli altri sono nascoste'}
              </Text>
            </View>
          )}
        </View>

        {err && (
          <View style={[styles.stateBox, { backgroundColor: theme.colors.error + '15' }]}>
            <Ionicons name="alert-circle" size={14} color={theme.colors.error} />
            <Text style={[styles.stateText, { color: theme.colors.error }]}>{err}</Text>
          </View>
        )}

        {data && data.members.length === 0 && !busy && (
          <Text style={styles.muted}>Nessun membro nella lega.</Text>
        )}

        {data && data.members.map((m) => {
          const isOpen = !!expanded[m.user_id];
          return (
            <Pressable
              key={m.user_id}
              onPress={() => m.hidden ? undefined : toggle(m.user_id)}
              style={styles.memberCard}
              testID={`fg-member-${m.user_id}`}
            >
              <View style={styles.memberHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{m.nickname || m.user_id.slice(0, 8)}</Text>
                  <Text style={styles.memberSub}>
                    {m.hidden
                      ? 'Nascosto finché la deadline non scade'
                      : m.has_lineup
                        ? `${m.module ?? '—'}${m.updated_at ? ` · ${new Date(m.updated_at).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}`
                        : 'Nessuna formazione inserita'}
                  </Text>
                </View>
                {m.hidden
                  ? <Ionicons name="eye-off" size={16} color={theme.colors.muted} />
                  : m.has_lineup
                    ? <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={COLOR} />
                    : <Ionicons name="ellipsis-horizontal" size={16} color={theme.colors.muted} />}
              </View>
              {isOpen && !m.hidden && m.has_lineup && (
                <View style={styles.memberBody}>
                  <Text style={styles.sectionLabel}>Titolari</Text>
                  {ROLE_ORDER.map(r => renderRole(m.starters, r))}
                  <Text style={[styles.sectionLabel, { marginTop: 8 }]}>Panchina</Text>
                  {ROLE_ORDER.map(r => renderRole(m.bench, r))}
                </View>
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
    flexDirection: 'row', alignItems: 'center',
    gap: theme.spacing.md, padding: theme.spacing.lg,
  },
  title: { color: theme.colors.onSurface, fontSize: 17, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  cardTitle: { color: theme.colors.onSurface, fontSize: 14, fontWeight: '800' },
  input: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border,
    color: theme.colors.onSurface,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 13,
  },
  reload: {
    width: 40, height: 40,
    borderRadius: theme.radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  stateBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.sm,
  },
  stateText: { fontSize: 12, fontWeight: '700', flex: 1 },
  muted: { color: theme.colors.muted, fontSize: 13 },
  memberCard: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    borderWidth: 1, borderColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  memberHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  memberName: { color: theme.colors.onSurface, fontSize: 14, fontWeight: '800' },
  memberSub: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  memberBody: { gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.colors.border },
  sectionLabel: {
    color: theme.colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.2,
  },
  roleGroup: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  roleLabel: {
    minWidth: 22, textAlign: 'center',
    color: COLOR, fontSize: 12, fontWeight: '900',
  },
  roleList: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  playerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.colors.border,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  playerName: { color: theme.colors.onSurface, fontSize: 11, fontWeight: '700', maxWidth: 120 },
  playerTeam: { color: theme.colors.muted, fontSize: 10 },
});
