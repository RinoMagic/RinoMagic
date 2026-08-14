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
  const [roomMatchday, setRoomMatchday] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [f, room] = await Promise.all([
        api<Fixture[]>(`/rooms/${id}/fixtures`),
        api<{ matchday: number }>(`/rooms/${id}`).catch(() => null),
      ]);
      setFixtures(f);
      if (room?.matchday) {
        setRoomMatchday(room.matchday);
        setComputeMd((prev) => prev || String(room.matchday));
      }
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

  const [computeMd, setComputeMd] = useState<string>('');
  const [computePreview, setComputePreview] = useState<null | {
    matchday: number;
    facts_count: number;
    fixtures_settled: number;
    fixtures_unresolved: number;
    unresolved: { home_team: string; away_team: string; home_resolved: string | null; away_resolved: string | null }[];
  }>(null);

  const trySyncFromApi = async () => {
    const raw = (computeMd || '').trim();
    const md = raw ? parseInt(raw, 10) : NaN;
    if (!md || md < 1 || md > 38) {
      setMsg('Inserisci una giornata valida (1..38) per calcolare i risultati');
      return;
    }
    setBusy(true); setMsg(null); setComputePreview(null);
    try {
      const r = await api<{
        matchday: number;
        facts_count: number;
        fixtures_settled: number;
        fixtures_unresolved: number;
        unresolved: { home_team: string; away_team: string; home_resolved: string | null; away_resolved: string | null }[];
        settled: { home_team: string; away_team: string; home_score: number; away_score: number }[];
      }>(`/rooms/${id}/fixtures/compute-from-facts?matchday=${md}`, { method: 'POST' });
      setComputePreview(r);
      if (r.fixtures_settled === 0) {
        setMsg(`Nessuna partita calcolata: verifica i nomi delle squadre.`);
      } else {
        setMsg(`Calcolate ${r.fixtures_settled} partite dalla giornata ${r.matchday} (${r.facts_count} righe voti).`);
      }
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
        <View style={styles.computeBox}>
          <Text style={styles.computeTitle}>Calcola Giornata dai Voti</Text>
          <Text style={styles.computeSub}>
            {roomMatchday
              ? `Deriva automaticamente i risultati dal PDF Voti caricato dall'admin. Giornata pre-impostata: ${roomMatchday}ª.`
              : "Deriva automaticamente i risultati dal PDF Voti caricato dall'admin."}
          </Text>
          <View style={styles.computeRow}>
            <TextInput
              testID="compute-md"
              placeholder="Giornata (1..38)"
              placeholderTextColor={theme.colors.muted}
              value={computeMd}
              onChangeText={setComputeMd}
              keyboardType="number-pad"
              style={styles.computeInput}
            />
            <Pressable
              testID="compute-run"
              onPress={trySyncFromApi}
              disabled={busy}
              style={[styles.computeBtn, busy && { opacity: 0.5 }]}
            >
              {busy ? (
                <ActivityIndicator color={theme.colors.onBrand} />
              ) : (
                <>
                  <Ionicons name="calculator" size={18} color={theme.colors.onBrand} />
                  <Text style={styles.computeBtnText}>Calcola Giornata</Text>
                </>
              )}
            </Pressable>
          </View>
          {computePreview && (
            <View style={styles.computePreview}>
              <Text style={styles.previewLine}>
                Giornata <Text style={{ fontWeight: '800' }}>{computePreview.matchday}</Text>
                {' · '}
                Righe voti: <Text style={{ fontWeight: '800' }}>{computePreview.facts_count}</Text>
              </Text>
              <Text style={styles.previewLine}>
                Partite calcolate: <Text style={{ fontWeight: '800', color: theme.colors.brand }}>{computePreview.fixtures_settled}</Text>
                {computePreview.fixtures_unresolved > 0 && (
                  <>
                    {' · '}
                    Non risolte: <Text style={{ fontWeight: '800', color: theme.colors.error }}>{computePreview.fixtures_unresolved}</Text>
                  </>
                )}
              </Text>
              {computePreview.unresolved.slice(0, 5).map((u, idx) => (
                <Text key={idx} style={styles.previewWarn}>
                  ⚠ {u.home_team} vs {u.away_team} — nome squadra non trovato nel PDF Voti
                </Text>
              ))}
            </View>
          )}
        </View>
        <Text style={styles.orText}>oppure inseriscili manualmente</Text>

        {fixtures.length > 0 && (
          <View style={styles.fxHeader}>
            <Text style={styles.fxHeaderTitle}>Partite ({fixtures.length})</Text>
            <Text style={styles.fxHeaderSub}>Modifica manualmente se serve</Text>
          </View>
        )}

        {fixtures.map((f, i) => (
          <View key={i} style={styles.card}>
            <View style={styles.rowHead}>
              <Text style={styles.rowNum}>#{i + 1}</Text>
              <Pressable onPress={() => remove(i)} hitSlop={10} testID={`fx-remove-${i}`}>
                <Ionicons name="trash" size={16} color={theme.colors.error} />
              </Pressable>
            </View>
            <View style={styles.teamRow}>
              <View style={styles.teamBadge}>
                <Text style={styles.teamBadgeText}>CASA</Text>
              </View>
              <TextInput
                testID={`fx-home-${i}`}
                placeholder="Squadra di casa"
                placeholderTextColor={theme.colors.muted}
                value={f.home_team}
                onChangeText={(t) => updateFixture(i, { home_team: t })}
                style={styles.teamInput}
              />
              <TextInput
                testID={`fx-hs-${i}`}
                keyboardType="number-pad"
                value={String(f.home_score)}
                onChangeText={(t) => updateFixture(i, { home_score: parseInt(t || '0', 10) || 0 })}
                style={styles.scoreInput}
              />
            </View>
            <View style={styles.teamRow}>
              <View style={[styles.teamBadge, { backgroundColor: theme.colors.surfaceTertiary }]}>
                <Text style={[styles.teamBadgeText, { color: theme.colors.muted }]}>OSPITE</Text>
              </View>
              <TextInput
                testID={`fx-away-${i}`}
                placeholder="Squadra ospite"
                placeholderTextColor={theme.colors.muted}
                value={f.away_team}
                onChangeText={(t) => updateFixture(i, { away_team: t })}
                style={styles.teamInput}
              />
              <TextInput
                testID={`fx-as-${i}`}
                keyboardType="number-pad"
                value={String(f.away_score)}
                onChangeText={(t) => updateFixture(i, { away_score: parseInt(t || '0', 10) || 0 })}
                style={styles.scoreInput}
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
  wrap: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
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
  computeBox: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.brand,
    gap: theme.spacing.sm,
  },
  computeTitle: {
    color: theme.colors.brand,
    fontWeight: '800',
    fontSize: 15,
  },
  computeSub: {
    color: theme.colors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  computeRow: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  computeInput: {
    width: '100%',
    color: theme.colors.onSurface,
    backgroundColor: theme.colors.surfaceTertiary,
    padding: theme.spacing.md,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: 14,
  },
  computeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.brand,
    borderRadius: theme.radius.sm,
    width: '100%',
  },
  computeBtnText: {
    color: theme.colors.onBrand,
    fontWeight: '800',
    fontSize: 14,
  },
  computePreview: {
    marginTop: theme.spacing.sm,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceTertiary,
    borderRadius: theme.radius.sm,
    gap: 4,
  },
  previewLine: { color: theme.colors.onSurface, fontSize: 12 },
  previewWarn: { color: theme.colors.error, fontSize: 11, marginTop: 2 },
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
  fxHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  fxHeaderTitle: {
    color: theme.colors.onSurface,
    fontWeight: '800',
    fontSize: 15,
  },
  fxHeaderSub: {
    color: theme.colors.muted,
    fontSize: 11,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  teamBadge: {
    backgroundColor: theme.colors.brand,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 56,
    alignItems: 'center',
  },
  teamBadgeText: {
    color: theme.colors.onBrand,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  teamInput: {
    flex: 1,
    color: theme.colors.onSurface,
    backgroundColor: theme.colors.surfaceTertiary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 2,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: 14,
    minWidth: 0,
  },
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
    width: 52,
    color: theme.colors.onSurface,
    backgroundColor: theme.colors.surfaceTertiary,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: 20,
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
