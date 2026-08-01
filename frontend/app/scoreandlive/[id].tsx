/**
 * ScoreAndLive tournament detail: matchdays list, participants, admin actions.
 */
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

const COLOR = '#10B981';

type Participant = { user_id: string; nickname: string; lives_remaining: number; eliminated_at_matchday: number | null; is_me?: boolean };
type Matchday = { id: string; matchday_number: number; status: string; fixtures_count: number };
type Detail = {
  id: string; name: string; status: string; initial_lives: number; is_admin: boolean;
  invite_code: string; participants: Participant[]; matchdays: Matchday[];
  my_blocked_teams: string[]; invites_available: number;
};

export default function TournamentPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [t, setT] = useState<Detail | null>(null);
  const [mdInput, setMdInput] = useState('1');
  const [fixInput, setFixInput] = useState('');
  const [useCalendar, setUseCalendar] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setT(await api<Detail>(`/sal/tournaments/${id}`));
    } catch (e: any) { alert(e.message); }
  };
  useFocusEffect(useCallback(() => { load(); }, [id]));

  const createMatchday = async () => {
    const n = parseInt(mdInput, 10);
    if (!(n >= 1 && n <= 38)) return alert('Giornata 1-38');
    let fixtures: { home_team: string; away_team: string }[] | undefined = undefined;
    if (!useCalendar) {
      const parsed = fixInput.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const parts = l.split(/\s+vs?\s+|\s*-\s*/i);
        return parts.length >= 2 ? { home_team: parts[0].trim(), away_team: parts[1].trim() } : null;
      }).filter(Boolean) as { home_team: string; away_team: string }[];
      if (!parsed.length) return alert('Inserisci partite tipo "Inter vs Milan"');
      fixtures = parsed;
    }
    setBusy(true);
    try {
      const body: any = { matchday_number: n };
      if (fixtures) body.fixtures = fixtures;
      await api(`/sal/tournaments/${id}/matchdays`, { method: 'POST', body });
      setFixInput('');
      await load();
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  };

  const genInvite = async () => {
    try {
      const inv = await api<{ code: string }>(`/sal/tournaments/${id}/invites`, { method: 'POST' });
      alert(`Nuovo codice: ${inv.code}`);
      await load();
    } catch (e: any) { alert(e.message); }
  };

  if (!t) return <View style={styles.center}><ActivityIndicator color={COLOR} /></View>;

  const me = t.participants.find((p) => p.is_me);

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{t.name}</Text>
          {t.is_admin ? <Ionicons name="shield-checkmark" size={22} color={COLOR} /> : <View style={{ width: 22 }} />}
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: 60 }}>
        {me && (
          <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: COLOR }]}>
            <Text style={styles.cardTitle}>Le tue vite: {me.lives_remaining}/{t.initial_lives}</Text>
            {t.my_blocked_teams.length > 0 && (
              <Text style={styles.muted}>Bloccate: {t.my_blocked_teams.join(', ')}</Text>
            )}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Giornate ({t.matchdays.length})</Text>
          {t.matchdays.length === 0 && <Text style={styles.muted}>Ancora nessuna giornata creata.</Text>}
          {t.matchdays.map((m) => (
            <Pressable key={m.id} style={styles.mdRow}
              onPress={() => router.push(`/scoreandlive/${id}/pick?matchday_id=${m.id}`)}
              testID={`sal-md-${m.matchday_number}`}>
              <Text style={styles.mdNum}>G{m.matchday_number}</Text>
              <Text style={styles.mdMeta}>{m.fixtures_count} partite · {m.status}</Text>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
            </Pressable>
          ))}
        </View>

        {t.is_admin && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Crea nuova giornata</Text>
            <TextInput style={styles.input} placeholder="Numero giornata" keyboardType="number-pad"
              placeholderTextColor={theme.colors.muted} value={mdInput} onChangeText={setMdInput} />
            <Pressable
              onPress={() => setUseCalendar(!useCalendar)}
              style={[styles.toggle, { borderColor: useCalendar ? COLOR : theme.colors.border }]}
              testID="sal-toggle-calendar"
            >
              <Ionicons name={useCalendar ? 'checkbox' : 'square-outline'} size={20} color={useCalendar ? COLOR : theme.colors.muted} />
              <Text style={[styles.toggleText, useCalendar && { color: COLOR }]}>
                Usa calendario Serie A (10 partite auto)
              </Text>
            </Pressable>
            {!useCalendar && (
              <TextInput style={[styles.input, { minHeight: 100 }]} placeholder="Partite (una per riga: Inter vs Milan)"
                placeholderTextColor={theme.colors.muted} value={fixInput} onChangeText={setFixInput} multiline />
            )}
            <Pressable style={[styles.cta, { backgroundColor: COLOR, opacity: busy ? 0.5 : 1 }]} onPress={createMatchday} disabled={busy}>
              <Ionicons name="add-circle" size={18} color="#fff" />
              <Text style={styles.ctaText}>Crea giornata</Text>
            </Pressable>
            <Pressable style={[styles.ctaOutline, { borderColor: COLOR }]} onPress={genInvite}>
              <Ionicons name="link" size={16} color={COLOR} />
              <Text style={[styles.ctaTextOutline, { color: COLOR }]}>Genera codice invito ({t.invites_available} liberi)</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Partecipanti</Text>
          {t.participants.map((p) => (
            <View key={p.user_id} style={styles.row}>
              <Text style={[styles.nick, p.is_me && { color: COLOR, fontWeight: '800' }]}>{p.nickname}{p.is_me ? ' (tu)' : ''}</Text>
              <Text style={styles.lives}>
                {p.eliminated_at_matchday !== null
                  ? `💀 elim G${p.eliminated_at_matchday}`
                  : `❤️ ${p.lives_remaining}`}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.lg },
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800', flex: 1 },
  card: {
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary, gap: theme.spacing.sm,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  cardTitle: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 15 },
  muted: { color: theme.colors.muted, fontSize: 12, fontStyle: 'italic' },
  input: {
    color: theme.colors.onSurface, backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border, fontSize: 13,
  },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, paddingVertical: 10, borderRadius: theme.radius.pill },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  ctaOutline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: theme.radius.pill, borderWidth: 1 },
  ctaTextOutline: { fontWeight: '700', fontSize: 13 },
  mdRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.sm, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surface },
  mdNum: { color: COLOR, fontWeight: '800', fontSize: 15, width: 40 },
  mdMeta: { color: theme.colors.onSurface, fontSize: 13, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  nick: { color: theme.colors.onSurface, fontSize: 14, flex: 1 },
  lives: { color: theme.colors.onSurfaceSecondary, fontSize: 13, fontWeight: '600' },
  toggle: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm, borderWidth: 1,
    backgroundColor: theme.colors.surface,
  },
  toggleText: { color: theme.colors.onSurfaceSecondary, fontSize: 13, fontWeight: '600', flex: 1 },
});
