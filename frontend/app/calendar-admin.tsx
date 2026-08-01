/**
 * ScoreAndLive — Season calendar admin.
 * Bulk-upload the whole Serie A season fixtures once. The admin can paste
 * the schedule as text; each matchday auto-populates during creation.
 *
 * Expected text format (paste-friendly):
 *   G1
 *   Inter - Milan
 *   Juventus - Roma
 *   ...
 *   G2
 *   Milan - Juventus
 *   ...
 */
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

const COLOR = '#10B981';

type Fixture = { season: string; matchday: number; home_team: string; away_team: string };

function parseCalendarText(txt: string): { matchday: number; home_team: string; away_team: string }[] {
  const out: { matchday: number; home_team: string; away_team: string }[] = [];
  let md: number | null = null;
  for (const raw of txt.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // Matchday header: "G1", "Giornata 1", "1", "1a giornata"
    const mdMatch = line.match(/^(?:G|Giornata\s*)?(\d{1,2})(?:[a\u00AA]?\s*giornata)?\s*[:\-]?\s*$/i);
    if (mdMatch) {
      md = parseInt(mdMatch[1], 10);
      continue;
    }
    if (md === null) continue;
    // Fixture line: "TeamA - TeamB" or "TeamA vs TeamB" or "TeamA — TeamB"
    const parts = line.split(/\s*(?:-|vs\.?|—|–)\s*/i);
    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
      out.push({ matchday: md, home_team: parts[0].trim(), away_team: parts[1].trim() });
    }
  }
  return out;
}

export default function CalendarAdmin() {
  const router = useRouter();
  const [season, setSeason] = useState('2025-26');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [current, setCurrent] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api<{ fixtures: Fixture[] }>(`/sal/calendar?season=${encodeURIComponent(season)}`);
      setCurrent(r.fixtures);
    } catch {} finally { setLoading(false); }
  };
  useFocusEffect(useCallback(() => { load(); }, [season]));

  const preview = parseCalendarText(text);
  const byMd = preview.reduce<Record<number, number>>((acc, f) => {
    acc[f.matchday] = (acc[f.matchday] || 0) + 1;
    return acc;
  }, {});

  const submit = async () => {
    if (!preview.length) return alert('Nessuna partita rilevata nel testo');
    setSaving(true);
    try {
      const r = await api<{ inserted: number; matchdays: number[] }>(`/sal/calendar/import`, {
        method: 'POST',
        body: { season, fixtures: preview, replace: true },
      });
      setFlash(`Salvate ${r.inserted} partite su ${r.matchdays.length} giornate`);
      setText('');
      await load();
    } catch (e: any) { alert(e.message); } finally { setSaving(false); }
  };

  const clearAll = async () => {
    if (!confirm(`Cancellare TUTTO il calendario ${season}?`)) return;
    try {
      await api(`/sal/calendar?season=${encodeURIComponent(season)}`, { method: 'DELETE' });
      setFlash('Calendario cancellato');
      await load();
    } catch (e: any) { alert(e.message); }
  };

  const byMdCurrent = current.reduce<Record<number, Fixture[]>>((acc, f) => {
    (acc[f.matchday] = acc[f.matchday] || []).push(f);
    return acc;
  }, {});
  const mdsPresent = Object.keys(byMdCurrent).map(Number).sort((a, b) => a - b);

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Calendario Serie A</Text>
            <Text style={styles.subtitle}>Carica tutta la stagione una volta sola</Text>
          </View>
          <Ionicons name="calendar" size={22} color={COLOR} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: 100 }}>
        {flash && (
          <View style={styles.okBox}>
            <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />
            <Text style={styles.okText}>{flash}</Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Formato accettato</Text>
          <Text style={styles.muted}>
            Incolla la stagione in questo formato (una giornata per volta):
          </Text>
          <View style={styles.codeBlock}>
            <Text style={styles.codeText}>{`G1
Inter - Milan
Juventus - Roma
Napoli - Lazio
...

G2
Milan - Juventus
...`}</Text>
          </View>
          <Text style={styles.muted}>
            Separatori accettati: &quot;-&quot;, &quot;vs&quot;, &quot;—&quot;. Le intestazioni possono essere &quot;G1&quot;, &quot;Giornata 1&quot;, o solo &quot;1&quot;.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Stagione</Text>
          <TextInput
            style={styles.input} value={season} onChangeText={setSeason}
            placeholder="es. 2025-26" placeholderTextColor={theme.colors.muted}
            maxLength={10}
          />
          <TextInput
            style={[styles.input, { minHeight: 220, textAlignVertical: 'top' }]}
            multiline value={text} onChangeText={setText}
            placeholder="Incolla qui il calendario..."
            placeholderTextColor={theme.colors.muted}
            testID="cal-textarea"
          />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(byMd).sort((a, b) => Number(a[0]) - Number(b[0])).map(([md, n]) => (
              <View key={md} style={styles.chip}>
                <Text style={styles.chipText}>G{md} · {n}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.muted}>
            Anteprima: {preview.length} partite su {Object.keys(byMd).length} giornate.
          </Text>
          <Pressable
            style={[styles.cta, { backgroundColor: COLOR, opacity: saving ? 0.5 : 1 }]}
            onPress={submit} disabled={saving}
            testID="cal-submit"
          >
            <Ionicons name="cloud-upload" size={18} color="#fff" />
            <Text style={styles.ctaText}>Salva calendario (sovrascrive esistente)</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.cardTitle}>Calendario attuale · {season}</Text>
            {current.length > 0 && (
              <Pressable onPress={clearAll} hitSlop={10}>
                <Ionicons name="trash" size={20} color={theme.colors.error} />
              </Pressable>
            )}
          </View>
          {loading && <ActivityIndicator color={COLOR} />}
          {!loading && current.length === 0 && (
            <Text style={styles.muted}>Nessun calendario caricato.</Text>
          )}
          {mdsPresent.map((md) => (
            <View key={md} style={styles.mdBlock}>
              <Text style={styles.mdHeader}>G{md} ({byMdCurrent[md].length} partite)</Text>
              {byMdCurrent[md].map((f, i) => (
                <Text key={i} style={styles.fixLine}>
                  · {f.home_team} - {f.away_team}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.lg },
  title: { color: theme.colors.onSurface, fontSize: 17, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  card: {
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary, gap: theme.spacing.sm,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  cardTitle: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 15 },
  muted: { color: theme.colors.muted, fontSize: 12 },
  input: {
    color: theme.colors.onSurface, backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border, fontSize: 13,
    fontFamily: 'monospace' as any,
  },
  codeBlock: {
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  codeText: { color: theme.colors.onSurfaceSecondary, fontSize: 11, fontFamily: 'monospace' as any },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: theme.spacing.sm, paddingVertical: 12, borderRadius: theme.radius.pill,
  },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: theme.radius.pill,
    backgroundColor: COLOR + '22', borderWidth: 1, borderColor: COLOR + '55',
  },
  chipText: { color: COLOR, fontSize: 11, fontWeight: '700' },
  okBox: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.success + '22',
  },
  okText: { color: theme.colors.success, fontSize: 13, flex: 1, fontWeight: '600' },
  mdBlock: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: theme.colors.border },
  mdHeader: { color: COLOR, fontWeight: '800', fontSize: 13, marginBottom: 4 },
  fixLine: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginLeft: theme.spacing.sm },
});
