/**
 * FantaGiornata — landing page: list of user's leagues + admin create.
 */
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session } from '@/src/api';
import { theme } from '@/src/theme';

type League = {
  id: string; name: string; status: string; invite_code: string;
  admin_user_id: string; current_matchday: number | null;
  members_count: number; invites_total: number; invites_available: number;
  is_admin: boolean;
};

const COLOR = '#A855F7';

export default function FantaGiornata() {
  const router = useRouter();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<'admin' | 'player' | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  const load = async () => {
    const s = await session.load();
    setRole(s.user?.role === 'admin' ? 'admin' : 'player');
    try {
      const data = await api<League[]>('/fg/leagues');
      setLeagues(data);
    } catch (e: any) {
      // If auth issue etc., ignore silently
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const createLeague = async () => {
    if (!newName.trim() || newName.trim().length < 2) return;
    setCreating(true);
    try {
      await api('/fg/leagues', { method: 'POST', body: { name: newName.trim() } });
      setNewName('');
      await load();
    } catch (e: any) {
      alert(e.message || 'Errore creazione lega');
    } finally { setCreating(false); }
  };

  const doJoin = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    try {
      const preview = await api<{ id: string }>(`/fg/leagues/by-code/${code}`, { auth: false });
      await api(`/fg/leagues/${preview.id}/join`, { method: 'POST', body: { invite_code: code } });
      setJoinCode('');
      await load();
    } catch (e: any) {
      alert(e.message || 'Codice non valido');
    }
  };

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>FantaGiornata</Text>
          <Ionicons name="football" size={22} color={COLOR} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: 60 }}>
        {loading ? (
          <ActivityIndicator color={COLOR} />
        ) : (
          <>
            {role === 'admin' && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Crea nuova lega</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Nome lega (min 2 char)"
                  placeholderTextColor={theme.colors.muted}
                  value={newName} onChangeText={setNewName}
                  testID="fg-new-name"
                />
                <Pressable
                  style={[styles.cta, { backgroundColor: COLOR, opacity: creating ? 0.5 : 1 }]}
                  onPress={createLeague} disabled={creating}
                  testID="fg-create-league"
                >
                  <Ionicons name="add-circle" size={18} color="#fff" />
                  <Text style={styles.ctaText}>Crea lega</Text>
                </Pressable>
              </View>
            )}

            {role === 'player' && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Iscriviti con codice</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Codice invito"
                  placeholderTextColor={theme.colors.muted}
                  value={joinCode} onChangeText={setJoinCode}
                  autoCapitalize="characters"
                  testID="fg-join-code"
                />
                <Pressable
                  style={[styles.cta, { backgroundColor: COLOR }]}
                  onPress={doJoin} testID="fg-join-btn"
                >
                  <Ionicons name="log-in" size={18} color="#fff" />
                  <Text style={styles.ctaText}>Entra</Text>
                </Pressable>
              </View>
            )}

            <Text style={styles.section}>Le tue leghe ({leagues.length})</Text>
            {leagues.length === 0 && <Text style={styles.muted}>Nessuna lega ancora. {role === 'admin' ? 'Creane una qui sopra.' : 'Chiedi un codice invito al tuo admin.'}</Text>}
            {leagues.map((lg) => (
              <Pressable
                key={lg.id}
                style={[styles.leagueCard, { borderColor: COLOR + '55' }]}
                onPress={() => router.push(`/fantagiornata/${lg.id}`)}
                testID={`fg-league-${lg.id}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.leagueName}>{lg.name}</Text>
                  <Text style={styles.leagueMeta}>
                    {lg.members_count} membri · {lg.current_matchday ? `giornata ${lg.current_matchday}` : 'nessuna giornata'}
                    {lg.is_admin ? ' · admin' : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: theme.spacing.lg,
  },
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  card: {
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary, gap: theme.spacing.sm,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  cardTitle: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 15 },
  input: {
    color: theme.colors.onSurface, backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border, fontSize: 14,
  },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: theme.spacing.sm, paddingVertical: 10, borderRadius: theme.radius.pill,
  },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  section: { color: theme.colors.onSurfaceSecondary, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  muted: { color: theme.colors.muted, fontSize: 13, fontStyle: 'italic' },
  leagueCard: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary, borderWidth: 1,
  },
  leagueName: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 15 },
  leagueMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
});
