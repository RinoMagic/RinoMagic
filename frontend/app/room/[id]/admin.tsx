import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { confirmDialog } from '@/src/utils/confirm';

type Fixture = {
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
};

export default function AdminFixtures() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const f = await api<Fixture[]>(`/rooms/${id}/fixtures`);
      setFixtures(f);
    } catch {} finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const updateFixture = (i: number, patch: Partial<Fixture>) => {
    setFixtures((arr) => arr.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  };
  const remove = async (i: number) => {
    const fx = fixtures[i];
    const label = fx?.home_team && fx?.away_team ? `${fx.home_team} - ${fx.away_team}` : `#${i + 1}`;
    if (!await confirmDialog('Rimuovi partita', `Rimuovere "${label}" dai risultati?`, { destructive: true })) return;
    setFixtures((arr) => arr.filter((_, idx) => idx !== i));
  };
  const add = () => setFixtures((arr) => [...arr, { home_team: '', away_team: '', home_score: 0, away_score: 0 }]);

  const trySyncFromApi = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ count: number }>(`/rooms/${id}/fixtures/sync`, { method: 'POST' });
      setMsg(`Scaricate ${r.count} partite dall&apos;API`);
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (fixtures.length === 0) return setMsg('Aggiungi almeno una partita');
    setBusy(true); setMsg(null);
    try {
      await api(`/rooms/${id}/fixtures`, {
        method: 'POST',
        body: { fixtures },
      });
      setMsg('Risultati salvati. La classifica e ora calcolata.');
      setTimeout(() => router.back(), 1200);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.brand} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="admin-back">
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>Risultati partite</Text>
          <View style={{ width: 26 }} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 140 }}>
        <Pressable
          testID="sync-api"
          onPress={trySyncFromApi}
          disabled={busy}
          style={[styles.syncBtn, busy && { opacity: 0.5 }]}
        >
          <Ionicons name="cloud-download" size={18} color={theme.colors.brand} />
          <Text style={styles.syncBtnText}>Prova sync automatico API-Football</Text>
        </Pressable>
        <Text style={styles.orText}>oppure inseriscili manualmente</Text>

        {fixtures.map((f, i) => (
          <View key={i} style={styles.card}>
            <View style={styles.rowHead}>
              <Text style={styles.rowNum}>#{i + 1}</Text>
              <Pressable onPress={() => remove(i)} hitSlop={10} testID={`fx-remove-${i}`}>
                <Ionicons name="trash" size={16} color={theme.colors.error} />
              </Pressable>
            </View>
            <View style={styles.matchRow}>
              <TextInput
                testID={`fx-home-${i}`}
                placeholder="Casa"
                placeholderTextColor={theme.colors.muted}
                value={f.home_team}
                onChangeText={(t) => updateFixture(i, { home_team: t })}
                style={styles.input}
              />
              <TextInput
                testID={`fx-hs-${i}`}
                keyboardType="number-pad"
                value={String(f.home_score)}
                onChangeText={(t) => updateFixture(i, { home_score: parseInt(t || '0', 10) || 0 })}
                style={styles.scoreInput}
              />
              <Text style={styles.dash}>-</Text>
              <TextInput
                testID={`fx-as-${i}`}
                keyboardType="number-pad"
                value={String(f.away_score)}
                onChangeText={(t) => updateFixture(i, { away_score: parseInt(t || '0', 10) || 0 })}
                style={styles.scoreInput}
              />
              <TextInput
                testID={`fx-away-${i}`}
                placeholder="Trasferta"
                placeholderTextColor={theme.colors.muted}
                value={f.away_team}
                onChangeText={(t) => updateFixture(i, { away_team: t })}
                style={styles.input}
              />
            </View>
          </View>
        ))}

        <Pressable onPress={add} style={styles.addBtn} testID="fx-add">
          <Ionicons name="add-circle" size={20} color={theme.colors.brand} />
          <Text style={styles.addBtnText}>Aggiungi partita</Text>
        </Pressable>

        {msg && <Text style={styles.msg}>{msg}</Text>}

        <Pressable
          testID="fx-save"
          onPress={save}
          disabled={busy}
          style={[styles.cta, busy && { opacity: 0.5 }]}
        >
          {busy ? (
            <ActivityIndicator color={theme.colors.onBrand} />
          ) : (
            <Text style={styles.ctaText}>Salva risultati</Text>
          )}
        </Pressable>
      </ScrollView>
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
    padding: theme.spacing.lg,
  },
  title: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 18 },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.brand,
    borderRadius: theme.radius.md,
  },
  syncBtnText: { color: theme.colors.brand, fontWeight: '700' },
  orText: {
    color: theme.colors.muted,
    fontSize: 12,
    textAlign: 'center',
    marginVertical: theme.spacing.md,
  },
  card: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowNum: { color: theme.colors.brand, fontWeight: '800' },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: {
    flex: 1,
    color: theme.colors.onSurface,
    backgroundColor: theme.colors.surfaceTertiary,
    padding: theme.spacing.md,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: 13,
  },
  scoreInput: {
    width: 44,
    color: theme.colors.onSurface,
    backgroundColor: theme.colors.surfaceTertiary,
    padding: theme.spacing.md,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  dash: { color: theme.colors.muted, fontWeight: '800' },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.brand,
    borderStyle: 'dashed',
    borderRadius: theme.radius.md,
  },
  addBtnText: { color: theme.colors.brand, fontWeight: '700' },
  msg: {
    color: theme.colors.brand,
    textAlign: 'center',
    marginVertical: theme.spacing.md,
    fontSize: 13,
  },
  cta: {
    marginTop: theme.spacing.lg,
    height: 56,
    backgroundColor: theme.colors.brand,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 16 },
});
