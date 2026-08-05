/*
 * /admin/deadlines — Global matchday deadlines console.
 *
 * Admin configures ONE deadline per Serie A giornata (1..38). The chosen
 * datetime is interpreted as Europe/Rome local time and stored as UTC.
 *
 * Once the deadline passes:
 *   - Every game (Survival, ScoreAndLive, FantaGiornata, Tiket, Bonus)
 *     blocks further submissions for that matchday.
 *   - Every player's picks / lineups become publicly visible.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { confirmDialog } from '@/src/utils/confirm';

const COLOR = '#F97316';
const SEASON = '2026-27';

type Row = {
  season: string;
  matchday: number;
  deadline_at: string | null;
  locked: boolean;
};
type ListResp = {
  season: string;
  server_now: string;
  deadlines: Row[];
};

function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    // Convert to Europe/Rome then format as "YYYY-MM-DD HH:mm"
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Rome',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
  } catch {
    return '';
  }
}

function fmtItalian(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('it-IT', {
      timeZone: 'Europe/Rome',
      weekday: 'short', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

export default function AdminDeadlines() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<ListResp>(`/deadlines?season=${SEASON}`);
      setRows(r.deadlines);
      const d: Record<number, string> = {};
      r.deadlines.forEach((row) => {
        d[row.matchday] = isoToLocalInput(row.deadline_at);
      });
      setDrafts(d);
    } catch (e: any) {
      setFlash({ type: 'err', text: e.message || 'Errore caricamento' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveOne = async (md: number, override?: string | null) => {
    setSaving((s) => ({ ...s, [md]: true }));
    setFlash(null);
    const raw = (override !== undefined ? (override ?? '') : (drafts[md] || '')).trim();
    try {
      const body = { deadline_at: raw || null };
      const r = await api<Row>(
        `/deadlines/${md}?season=${SEASON}`,
        { method: 'PUT', body },
      );
      setRows((rs) => rs.map((x) => x.matchday === md ? { ...x, ...r } : x));
      setDrafts((d) => ({ ...d, [md]: isoToLocalInput(r.deadline_at) }));
      setFlash({
        type: 'ok',
        text: raw ? `Giornata ${md} aggiornata` : `Timer G${md} cancellato`,
      });
    } catch (e: any) {
      setFlash({ type: 'err', text: `G${md}: ${e.message}` });
    } finally {
      setSaving((s) => ({ ...s, [md]: false }));
    }
  };

  const bulkSave = async () => {
    setFlash(null);
    const payload = {
      season: SEASON,
      deadlines: Object.entries(drafts).map(([md, v]) => ({
        matchday: Number(md),
        deadline_at: v.trim() || null,
      })).filter((d) => d.matchday >= 1 && d.matchday <= 38),
    };
    try {
      const r = await api<any>('/deadlines/bulk', { method: 'POST', body: payload });
      setFlash({
        type: r.errors?.length ? 'err' : 'ok',
        text: `Salvate ${r.applied}, cancellate ${r.cleared}${r.errors?.length ? `, errori ${r.errors.length}` : ''}`,
      });
      await load();
    } catch (e: any) {
      setFlash({ type: 'err', text: e.message });
    }
  };

  const clearOne = async (md: number) => {
    const ok = await confirmDialog(
      `Cancella timer G${md}`,
      `Rimuovere completamente la deadline della giornata ${md}?\n\nLe sottomissioni saranno di nuovo aperte per tutti i giochi.`,
      { destructive: true, confirmLabel: 'Cancella' },
    );
    if (!ok) return;
    setDrafts((d) => ({ ...d, [md]: '' }));
    await saveOne(md, null);
  };

  const openCount = rows.filter((r) => r.deadline_at && !r.locked).length;
  const lockedCount = rows.filter((r) => r.deadline_at && r.locked).length;
  const unsetCount = rows.filter((r) => !r.deadline_at).length;

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="dl-back">
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Deadline Giornate</Text>
            <Text style={styles.subtitle}>Timer di chiusura pronostici · stagione {SEASON}</Text>
          </View>
          <Ionicons name="time" size={22} color={COLOR} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120, gap: theme.spacing.md }}>
        <View style={styles.summary}>
          <View style={[styles.stat, { borderColor: theme.colors.brand + '55' }]}>
            <Text style={[styles.statNum, { color: theme.colors.brand }]}>{openCount}</Text>
            <Text style={styles.statLbl}>Aperte</Text>
          </View>
          <View style={[styles.stat, { borderColor: theme.colors.error + '55' }]}>
            <Text style={[styles.statNum, { color: theme.colors.error }]}>{lockedCount}</Text>
            <Text style={styles.statLbl}>Chiuse</Text>
          </View>
          <View style={[styles.stat, { borderColor: theme.colors.border }]}>
            <Text style={[styles.statNum, { color: theme.colors.muted }]}>{unsetCount}</Text>
            <Text style={styles.statLbl}>Non impostate</Text>
          </View>
        </View>

        {flash && (
          <View style={[styles.flash, flash.type === 'ok' ? styles.flashOk : styles.flashErr]}>
            <Ionicons name={flash.type === 'ok' ? 'checkmark-circle' : 'alert-circle'} size={16} color={flash.type === 'ok' ? theme.colors.success : theme.colors.error} />
            <Text style={[styles.flashText, { color: flash.type === 'ok' ? theme.colors.success : theme.colors.error }]}>
              {flash.text}
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.helpText}>
            Formato: <Text style={styles.mono}>YYYY-MM-DD HH:MM</Text> (orario italiano).
            Esempio: <Text style={styles.mono}>2026-08-24 18:00</Text> chiude i pronostici della G1 il sabato alle 18:00.
            Lascia vuoto per rimuovere la deadline.
          </Text>
          <Pressable onPress={bulkSave} style={[styles.cta, { backgroundColor: COLOR }]} testID="dl-bulk-save">
            <Ionicons name="save" size={16} color="#fff" />
            <Text style={styles.ctaText}>Salva tutte le modifiche</Text>
          </Pressable>
        </View>

        {loading && <ActivityIndicator color={COLOR} />}

        {rows.map((r) => {
          const isLocked = r.locked && !!r.deadline_at;
          const draft = drafts[r.matchday] ?? '';
          const dirty = draft !== isoToLocalInput(r.deadline_at);
          return (
            <View
              key={r.matchday}
              style={[
                styles.row,
                isLocked && { borderColor: theme.colors.error + '55', backgroundColor: theme.colors.error + '08' },
              ]}
            >
              <View style={styles.rowHeader}>
                <View style={styles.mdBadge}>
                  <Text style={styles.mdText}>G{r.matchday}</Text>
                </View>
                <Text style={styles.rowStatus}>
                  {r.deadline_at
                    ? isLocked ? '🔒 Chiusa' : '⏱ Aperta'
                    : '— non impostata'}
                </Text>
                {r.deadline_at && (
                  <Text style={styles.rowStatusSub} numberOfLines={1}>
                    {fmtItalian(r.deadline_at)}
                  </Text>
                )}
              </View>
              <View style={styles.rowInputRow}>
                <TextInput
                  style={styles.input}
                  value={draft}
                  onChangeText={(v) => setDrafts((d) => ({ ...d, [r.matchday]: v }))}
                  placeholder="YYYY-MM-DD HH:MM"
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID={`dl-input-${r.matchday}`}
                />
                <Pressable
                  onPress={() => saveOne(r.matchday)}
                  disabled={saving[r.matchday] || !dirty}
                  style={[
                    styles.rowBtn,
                    { backgroundColor: dirty ? COLOR : theme.colors.surfaceTertiary },
                    saving[r.matchday] && { opacity: 0.5 },
                  ]}
                  testID={`dl-save-${r.matchday}`}
                >
                  {saving[r.matchday] ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Ionicons name="checkmark" size={16} color={dirty ? '#fff' : theme.colors.muted} />
                  )}
                </Pressable>
                {r.deadline_at && (
                  <Pressable
                    onPress={() => clearOne(r.matchday)}
                    hitSlop={6}
                    style={styles.rowBtn}
                    testID={`dl-clear-${r.matchday}`}
                  >
                    <Ionicons name="trash-outline" size={16} color={theme.colors.error} />
                  </Pressable>
                )}
              </View>
            </View>
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
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  summary: { flexDirection: 'row', gap: 8 },
  stat: {
    flex: 1, alignItems: 'center', padding: theme.spacing.md,
    borderRadius: theme.radius.md, borderWidth: 1,
    backgroundColor: theme.colors.surfaceSecondary,
  },
  statNum: { fontSize: 22, fontWeight: '900' },
  statLbl: { color: theme.colors.muted, fontSize: 11, fontWeight: '700', marginTop: 2 },
  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  helpText: { color: theme.colors.onSurfaceSecondary, fontSize: 12, lineHeight: 18 },
  mono: { fontFamily: 'monospace' as any, color: theme.colors.onSurface },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: theme.spacing.sm, height: 40, borderRadius: theme.radius.md,
  },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  row: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  mdBadge: {
    minWidth: 40,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.brand + '22',
  },
  mdText: { color: theme.colors.brand, fontWeight: '800', fontSize: 12, textAlign: 'center' },
  rowStatus: { color: theme.colors.onSurface, fontSize: 12, fontWeight: '700' },
  rowStatusSub: { color: theme.colors.muted, fontSize: 11, flex: 1, textAlign: 'right' },
  rowInputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.onSurface,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 13,
    fontFamily: 'monospace' as any,
  },
  rowBtn: {
    width: 36, height: 36,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceTertiary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: theme.colors.border,
  },
  flash: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
  },
  flashOk: { backgroundColor: theme.colors.success + '22' },
  flashErr: { backgroundColor: theme.colors.error + '22' },
  flashText: { flex: 1, fontSize: 12, fontWeight: '700' },
});
