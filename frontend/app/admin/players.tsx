/*
 * /admin/players — Upload the "Listone Fantacalcio" (Excel or PDF).
 *
 * Populates the `sal_players` collection used by ScoreAndLive, FantaGiornata
 * and Surviva for resolving player picks and lineups.
 *
 * Admin flow:
 *   1. Pick the Listone file (XLSX primary, PDF as legacy fallback)
 *   2. Backend returns a dry-run preview (extracted count, by team, by role)
 *   3. Admin confirms → backend imports with replace_all=true (full overwrite)
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, apiUpload } from '@/src/api';
import { theme } from '@/src/theme';

const COLOR = '#8B5CF6';

type Preview = {
  extracted: number;
  by_team: Record<string, number>;
  by_role: Record<string, number>;
  sample: {
    fanta_id: number;
    first_name: string;
    last_name: string;
    team: string;
    role: string;
  }[];
  dry_run: boolean;
};

function useWebFileInput(onPick: (f: File) => void, kind: 'xlsx' | 'pdf') {
  const inputRefXlsx = useRef<HTMLInputElement | null>(null);
  const inputRefPdf = useRef<HTMLInputElement | null>(null);
  const openPicker = () => {
    if (Platform.OS !== 'web') return;
    const ref = kind === 'xlsx' ? inputRefXlsx : inputRefPdf;
    if (!ref.current) {
      const el = document.createElement('input');
      el.type = 'file';
      el.accept = kind === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx'
        : 'application/pdf,.pdf';
      el.style.display = 'none';
      el.addEventListener('change', () => {
        const f = el.files?.[0];
        if (f) onPick(f);
        el.value = '';
      });
      document.body.appendChild(el);
      ref.current = el;
    }
    ref.current.click();
  };
  return openPicker;
}

export default function AdminPlayers() {
  const router = useRouter();
  const [currentCount, setCurrentCount] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [pickedKind, setPickedKind] = useState<'xlsx' | 'pdf'>('xlsx');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadCount = async () => {
    try {
      // The list endpoint is capped at 1000 rows — enough for a Serie A listone (~600).
      const rows = await api<any[]>('/sal/players?limit=1000');
      setCurrentCount(rows.length);
    } catch {
      setCurrentCount(null);
    }
  };

  useEffect(() => { loadCount(); }, []);

  const runDryRun = async (f: File, kind: 'xlsx' | 'pdf') => {
    setBusy(true); setFlash(null); setPreview(null); setPickedFile(null);
    try {
      const endpoint = kind === 'xlsx' ? '/sal/players/import-xlsx' : '/sal/players/import-pdf';
      const mime = kind === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf';
      const p = await apiUpload<Preview>(
        endpoint,
        { name: f.name, type: f.type || mime, blob: f },
        { dry_run: true },
      );
      setPreview(p);
      setPickedFile(f);
      setPickedKind(kind);
    } catch (e: any) {
      setFlash({ type: 'err', text: e.message || `Errore lettura ${kind.toUpperCase()}` });
    } finally {
      setBusy(false);
    }
  };

  const onPickXlsx = async (f: File) => {
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      setFlash({ type: 'err', text: 'Serve un file .xlsx' });
      return;
    }
    await runDryRun(f, 'xlsx');
  };

  const onPickPdf = async (f: File) => {
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      setFlash({ type: 'err', text: 'Serve un file .pdf' });
      return;
    }
    await runDryRun(f, 'pdf');
  };

  const openPickerXlsx = useWebFileInput(onPickXlsx, 'xlsx');
  const openPickerPdf = useWebFileInput(onPickPdf, 'pdf');

  const confirm = async () => {
    if (!pickedFile) return;
    setBusy(true); setFlash(null);
    try {
      const endpoint = pickedKind === 'xlsx' ? '/sal/players/import-xlsx' : '/sal/players/import-pdf';
      const mime = pickedKind === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf';
      const r = await apiUpload<any>(
        endpoint,
        { name: pickedFile.name, type: mime, blob: pickedFile },
        { dry_run: false, replace_all: true },
      );
      setFlash({
        type: 'ok',
        text: `Listone importato da ${pickedKind.toUpperCase()}: ${r.inserted} giocatori (totale in DB: ${r.total}).`,
      });
      setPreview(null);
      setPickedFile(null);
      await loadCount();
    } catch (e: any) {
      setFlash({ type: 'err', text: e.message || 'Errore import' });
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setPreview(null);
    setPickedFile(null);
    setFlash(null);
  };

  const teamRows = preview
    ? Object.entries(preview.by_team).sort((a, b) => a[0].localeCompare(b[0]))
    : [];
  const roleRows = preview
    ? Object.entries(preview.by_role).sort((a, b) => a[0].localeCompare(b[0]))
    : [];

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="players-back">
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Lista Calciatori</Text>
            <Text style={styles.subtitle}>Carica il Listone Fantacalcio della stagione</Text>
          </View>
          <Ionicons name="people" size={22} color={COLOR} />
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: 120 }}
      >
        {/* Current DB status */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="server" size={18} color={theme.colors.muted} />
              <Text style={styles.cardTitle}>Stato database</Text>
            </View>
            <Pressable onPress={loadCount} hitSlop={10} testID="players-refresh">
              <Ionicons name="refresh" size={18} color={theme.colors.muted} />
            </Pressable>
          </View>
          {currentCount === null ? (
            <Text style={styles.muted}>Caricamento…</Text>
          ) : currentCount === 0 ? (
            <View style={styles.warnBox}>
              <Ionicons name="alert-circle" size={16} color="#F59E0B" />
              <Text style={styles.warnText}>
                Nessun giocatore in DB. Carica il Listone per abilitare picks, formazioni e settlement.
              </Text>
            </View>
          ) : (
            <Text style={styles.bigNum}>
              {currentCount}<Text style={styles.bigNumSub}> giocatori attivi</Text>
            </Text>
          )}
        </View>

        {/* Flash */}
        {flash && (
          <View style={[styles.flashBox, flash.type === 'ok' ? styles.flashOk : styles.flashErr]}>
            <Ionicons
              name={flash.type === 'ok' ? 'checkmark-circle' : 'alert-circle'}
              size={18}
              color={flash.type === 'ok' ? theme.colors.success : theme.colors.error}
            />
            <Text style={[
              styles.flashText,
              { color: flash.type === 'ok' ? theme.colors.success : theme.colors.error },
            ]}>
              {flash.text}
            </Text>
          </View>
        )}

        {/* Upload */}
        {!preview && (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="document-attach" size={18} color={COLOR} />
              <Text style={styles.cardTitle}>Carica Listone</Text>
              <View style={styles.badgePrimary}>
                <Text style={styles.badgeText}>NUOVO</Text>
              </View>
            </View>
            <Text style={styles.muted}>
              Formato consigliato: <Text style={{ fontWeight: '800' }}>Excel (.xlsx)</Text> ufficiale di
              fantacalcio.it. Parsing istantaneo, zero ambiguità OCR.
              L&apos;import sostituisce completamente l&apos;elenco esistente.
            </Text>
            <Pressable
              onPress={openPickerXlsx}
              disabled={busy}
              style={[styles.cta, { backgroundColor: COLOR, opacity: busy ? 0.5 : 1 }]}
              testID="players-pick-xlsx"
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="cloud-upload" size={18} color="#fff" />
                  <Text style={styles.ctaText}>Scegli file Excel (.xlsx)</Text>
                </>
              )}
            </Pressable>

            {/* Legacy PDF fallback */}
            <View style={styles.legacyDivider}>
              <View style={styles.legacyLine} />
              <Text style={styles.legacyLabel}>o usa il formato legacy</Text>
              <View style={styles.legacyLine} />
            </View>
            <Pressable
              onPress={openPickerPdf}
              disabled={busy}
              style={[styles.ctaLegacy, { opacity: busy ? 0.5 : 1 }]}
              testID="players-pick-pdf"
            >
              <Ionicons name="document-text-outline" size={16} color={theme.colors.muted} />
              <Text style={styles.ctaLegacyText}>Carica PDF (legacy)</Text>
            </Pressable>

            {Platform.OS !== 'web' && (
              <Text style={styles.mutedSm}>
                Nota: su mobile-nativo l&apos;upload da file system non è ancora abilitato.
                Usa l&apos;anteprima web da PC.
              </Text>
            )}
          </View>
        )}

        {/* Preview */}
        {preview && (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="document-text" size={18} color={COLOR} />
              <Text style={styles.cardTitle}>Anteprima</Text>
            </View>

            <View style={styles.okBox}>
              <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />
              <Text style={styles.okText}>
                {preview.extracted} giocatori estratti · {teamRows.length} squadre · fonte: {pickedKind.toUpperCase()}
              </Text>
            </View>

            {/* By role chips */}
            <Text style={styles.sectionLabel}>Ripartizione ruoli</Text>
            <View style={styles.chipRow}>
              {roleRows.map(([r, n]) => (
                <View key={r} style={styles.chip}>
                  <Text style={styles.chipText}>{r} · {n}</Text>
                </View>
              ))}
            </View>

            {/* By team chips */}
            <Text style={styles.sectionLabel}>Ripartizione squadre</Text>
            <View style={styles.chipRow}>
              {teamRows.map(([t, n]) => (
                <View key={t} style={styles.chipTeam}>
                  <Text style={styles.chipText}>{t} · {n}</Text>
                </View>
              ))}
            </View>

            {/* Sample rows */}
            <Text style={styles.sectionLabel}>Prime righe estratte</Text>
            <View style={styles.codeBlock}>
              {preview.sample.map((p, i) => (
                <Text key={i} style={styles.codeText}>
                  #{p.fanta_id} · {p.role} · {[p.last_name, p.first_name].filter(Boolean).join(' ')} ({p.team})
                </Text>
              ))}
            </View>

            <View style={styles.warnBox}>
              <Ionicons name="warning" size={16} color="#F59E0B" />
              <Text style={styles.warnText}>
                Confermando verrà <Text style={{ fontWeight: '800' }}>eliminato l&apos;elenco corrente</Text> e
                sostituito con questo import.
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={cancel}
                disabled={busy}
                style={[styles.cta, { flex: 1, backgroundColor: theme.colors.surfaceTertiary }]}
                testID="players-cancel"
              >
                <Ionicons name="close" size={16} color={theme.colors.onSurface} />
                <Text style={[styles.ctaText, { color: theme.colors.onSurface }]}>Annulla</Text>
              </Pressable>
              <Pressable
                onPress={confirm}
                disabled={busy}
                style={[styles.cta, { flex: 2, backgroundColor: COLOR, opacity: busy ? 0.5 : 1 }]}
                testID="players-confirm"
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                    <Text style={styles.ctaText}>Conferma e sostituisci</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardTitle: { color: theme.colors.onSurface, fontSize: 15, fontWeight: '800' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: 4,
  },
  muted: { color: theme.colors.onSurfaceSecondary, fontSize: 13, lineHeight: 20 },
  mutedSm: { color: theme.colors.muted, fontSize: 11 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },
  bigNum: { color: COLOR, fontSize: 32, fontWeight: '900' },
  bigNumSub: { color: theme.colors.muted, fontSize: 14, fontWeight: '600' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    height: 48,
    borderRadius: theme.radius.md,
  },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  chipRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: {
    backgroundColor: theme.colors.surfaceTertiary,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipTeam: {
    backgroundColor: COLOR + '22',
    borderRadius: theme.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: COLOR + '55',
  },
  chipText: { color: theme.colors.onSurface, fontSize: 12, fontWeight: '700' },
  codeBlock: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 4,
  },
  codeText: {
    color: theme.colors.onSurfaceSecondary,
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  okBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.success + '22',
  },
  okText: { color: theme.colors.success, fontSize: 13, fontWeight: '700', flex: 1 },
  warnBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    backgroundColor: '#F59E0B22',
  },
  warnText: { color: '#F59E0B', fontSize: 12, fontWeight: '700', flex: 1 },
  flashBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
  },
  flashOk: {
    backgroundColor: theme.colors.success + '15',
    borderColor: theme.colors.success + '55',
  },
  flashErr: {
    backgroundColor: theme.colors.error + '15',
    borderColor: theme.colors.error + '55',
  },
  flashText: { fontSize: 13, fontWeight: '700', flex: 1 },
  badgePrimary: {
    backgroundColor: '#10B981',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  legacyDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  legacyLine: { flex: 1, height: 1, backgroundColor: theme.colors.border },
  legacyLabel: { color: theme.colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  ctaLegacy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 38,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  ctaLegacyText: { color: theme.colors.muted, fontSize: 12, fontWeight: '700' },
});
