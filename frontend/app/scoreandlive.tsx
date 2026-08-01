/**
 * ScoreAndLive — landing: tournaments list + create/join.
 */
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session } from '@/src/api';
import { theme } from '@/src/theme';

const COLOR = '#10B981';

type T = {
  id: string; name: string; status: string; invite_code: string;
  initial_lives: number; participants_total: number; participants_alive: number;
  is_admin: boolean; current_matchday_number: number | null;
};

export default function ScoreAndLive() {
  const router = useRouter();
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<'admin' | 'player' | null>(null);
  const [name, setName] = useState('');
  const [lives, setLives] = useState('10');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const s = await session.load();
    setRole(s.user?.role === 'admin' ? 'admin' : 'player');
    try {
      setItems(await api<T[]>('/sal/tournaments'));
    } catch {} finally { setLoading(false); }
  };
  useFocusEffect(useCallback(() => { load(); }, []));

  const create = async () => {
    if (name.trim().length < 2) return;
    const iv = parseInt(lives, 10);
    if (!(iv >= 1 && iv <= 20)) return alert('Vite 1-20');
    setBusy(true);
    try {
      await api('/sal/tournaments', { method: 'POST', body: { name: name.trim(), initial_lives: iv } });
      setName(''); await load();
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  };

  const doJoin = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    try {
      const preview = await api<{ id: string }>(`/sal/tournaments/by-code/${code}`, { auth: false });
      await api(`/sal/tournaments/${preview.id}/join`, { method: 'POST', body: { invite_code: code } });
      setJoinCode(''); await load();
    } catch (e: any) { alert(e.message); }
  };

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>ScoreAndLive</Text>
          <Ionicons name="flame" size={22} color={COLOR} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: 60 }}>
        {loading ? <ActivityIndicator color={COLOR} /> : (
          <>
            {role === 'admin' && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Crea nuovo torneo</Text>
                <TextInput style={styles.input} placeholder="Nome torneo" placeholderTextColor={theme.colors.muted}
                  value={name} onChangeText={setName} testID="sal-new-name" />
                <TextInput style={styles.input} placeholder="Vite iniziali (default 10)" placeholderTextColor={theme.colors.muted}
                  keyboardType="number-pad" value={lives} onChangeText={setLives} />
                <Pressable style={[styles.cta, { backgroundColor: COLOR }]} onPress={create} disabled={busy} testID="sal-create">
                  <Ionicons name="add-circle" size={18} color="#fff" />
                  <Text style={styles.ctaText}>Crea torneo</Text>
                </Pressable>
              </View>
            )}
            {role === 'player' && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Iscriviti con codice</Text>
                <TextInput style={styles.input} placeholder="Codice invito" placeholderTextColor={theme.colors.muted}
                  autoCapitalize="characters" value={joinCode} onChangeText={setJoinCode} />
                <Pressable style={[styles.cta, { backgroundColor: COLOR }]} onPress={doJoin}>
                  <Ionicons name="log-in" size={18} color="#fff" />
                  <Text style={styles.ctaText}>Entra</Text>
                </Pressable>
              </View>
            )}

            <Text style={styles.section}>I tuoi tornei ({items.length})</Text>
            {items.length === 0 && <Text style={styles.muted}>Nessun torneo.</Text>}
            {items.map((t) => (
              <Pressable key={t.id} style={[styles.tCard, { borderColor: COLOR + '55' }]}
                onPress={() => router.push(`/scoreandlive/${t.id}`)}
                testID={`sal-t-${t.id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.tName}>{t.name}</Text>
                  <Text style={styles.tMeta}>
                    {t.participants_alive}/{t.participants_total} vivi · {t.initial_lives} vite iniziali
                    {t.is_admin ? ' · admin' : ''}
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: theme.spacing.lg },
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
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, paddingVertical: 10, borderRadius: theme.radius.pill },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  section: { color: theme.colors.onSurfaceSecondary, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  muted: { color: theme.colors.muted, fontSize: 13, fontStyle: 'italic' },
  tCard: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary, borderWidth: 1,
  },
  tName: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 15 },
  tMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
});
