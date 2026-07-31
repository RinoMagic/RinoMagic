/**
 * PDF Admin — Import center for the 2 weekly source files that feed
 * RinoMagic's games:
 *   1. Listone       → sal_players roster (ScoreAndLive)
 *   2. Voti          → matchday_facts (all games) — also derives match results
 *                      per team (goals scored/conceded) with no extra PDF.
 *
 * Web-first PWA screen. On native, hooks up transparently via `apiUpload`.
 */
import { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, apiUpload, session } from '@/src/api';
import { theme } from '@/src/theme';

type UploadResult = { ok: boolean; data?: any; error?: string } | null;

function useWebFileInput(onPick: (f: File) => void) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openPicker = () => {
    if (Platform.OS !== 'web') return;
    if (!inputRef.current) {
      const el = document.createElement('input');
      el.type = 'file';
      el.accept = 'application/pdf,.pdf';
      el.style.display = 'none';
      el.addEventListener('change', () => {
        const f = el.files?.[0];
        if (f) onPick(f);
        el.value = '';
      });
      document.body.appendChild(el);
      inputRef.current = el;
    }
    inputRef.current.click();
  };
  return openPicker;
}

// -----------------------------------------------------------------------
// Reusable upload card
// -----------------------------------------------------------------------

type CardProps = {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  subtitle: string;
  endpoint: string;                 // e.g. "/sal/players/import-pdf"
  params?: Record<string, string | number | boolean>;
  onSuccessMessage: (data: any) => string;
  renderPreview?: (data: any) => React.ReactNode;
  /**
   * Optional callback fired after a successful upload. If it returns a
   * value, that value is merged onto `data.__extra` so `renderPreview`
   * can access derived data (e.g. computed team results).
   */
  afterSuccess?: (data: any) => Promise<any>;
  testID?: string;
};

function UploadCard(p: CardProps) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult>(null);
  const [filename, setFilename] = useState<string | null>(null);

  const doUpload = async (file: File) => {
    setBusy(true);
    setResult(null);
    setFilename(file.name);
    try {
      const data = await apiUpload<any>(
        p.endpoint,
        { name: file.name, type: file.type || 'application/pdf', blob: file },
        p.params || {},
      );
      let extra: any = null;
      if (p.afterSuccess) {
        try { extra = await p.afterSuccess(data); } catch { /* non-fatal */ }
      }
      setResult({ ok: true, data: { ...data, __extra: extra } });
    } catch (e: any) {
      setResult({ ok: false, error: e.message || 'Errore upload' });
    } finally {
      setBusy(false);
    }
  };

  const openPicker = useWebFileInput(doUpload);

  return (
    <View style={[styles.card, { borderColor: p.color + '55' }]} testID={p.testID}>
      <View style={styles.cardHead}>
        <View style={[styles.iconWrap, { backgroundColor: p.color + '22' }]}>
          <Ionicons name={p.icon} size={22} color={p.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{p.title}</Text>
          <Text style={styles.cardSub}>{p.subtitle}</Text>
        </View>
      </View>

      <Pressable
        style={[styles.dropZone, busy && { opacity: 0.6 }]}
        onPress={openPicker}
        disabled={busy}
        testID={`${p.testID}-pick`}
      >
        {busy
          ? <ActivityIndicator color={p.color} />
          : <>
              <Ionicons name="cloud-upload-outline" size={26} color={p.color} />
              <Text style={[styles.dropText, { color: p.color }]}>
                {filename ? `Cambia file (${filename})` : 'Seleziona PDF'}
              </Text>
            </>}
      </Pressable>

      {result?.ok === true && (
        <View style={styles.okBox}>
          <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />
          <Text style={styles.okText}>{p.onSuccessMessage(result.data)}</Text>
        </View>
      )}
      {result?.ok === false && (
        <View style={styles.errBox}>
          <Ionicons name="alert-circle" size={16} color={theme.colors.error} />
          <Text style={styles.errText}>{result.error}</Text>
        </View>
      )}
      {result?.ok && p.renderPreview && (
        <View style={styles.previewWrap}>
          {p.renderPreview(result.data)}
        </View>
      )}
    </View>
  );
}

// -----------------------------------------------------------------------
// Screen
// -----------------------------------------------------------------------

export default function PdfAdmin() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useFocusEffect(useCallback(() => {
    (async () => {
      const s = await session.load();
      if (!s.user || s.user.role !== 'admin') {
        router.replace('/');
      }
      setChecking(false);
    })();
  }, [router]));

  if (checking) {
    return <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>;
  }

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="pdf-admin-back">
            <Ionicons name="chevron-back" size={22} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Import PDF</Text>
            <Text style={styles.subtitle}>Carica le 2 fonti settimanali</Text>
          </View>
          <Ionicons name="document-text" size={22} color={theme.colors.brand} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: 100 }}>
        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={18} color={theme.colors.brand} />
          <Text style={styles.infoText}>
            Bastano 2 PDF per giornata. I risultati per squadra (gol fatti/subiti) sono
            calcolati automaticamente dai Voti: Gf+Rf per squadra vs. Gs del portiere,
            con cross-check invariante Σgol_fatti = Σgol_subiti.
          </Text>
        </View>

        {/* -------- 1. Listone (roster giocatori Serie A) -------- */}
        <UploadCard
          testID="upload-listone"
          icon="people"
          color={theme.colors.accent}
          title="1. Listone giocatori"
          subtitle="Rosa completa Serie A · usata da ScoreAndLive per la lista marcatori"
          endpoint="/sal/players/import-pdf"
          params={{ dry_run: false, replace_all: true }}
          onSuccessMessage={(d) =>
            `Importati ${d.inserted ?? d.extracted} giocatori (${Object.keys(d.by_team || {}).length} squadre).`
          }
          renderPreview={(d) => (
            <View>
              <Text style={styles.previewTitle}>Distribuzione per squadra</Text>
              <View style={styles.chipsWrap}>
                {Object.entries(d.by_team || {}).map(([team, count]) => (
                  <View key={team} style={styles.chip}>
                    <Text style={styles.chipText}>{team} · {String(count)}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.previewTitle}>Per ruolo</Text>
              <View style={styles.chipsWrap}>
                {Object.entries(d.by_role || {}).map(([role, count]) => (
                  <View key={role} style={styles.chip}>
                    <Text style={styles.chipText}>{role} · {String(count)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        />

        {/* -------- 2. Voti (fantavoto + marcatori + risultati per squadra) -------- */}
        <UploadCard
          testID="upload-voti"
          icon="star"
          color={theme.colors.warning}
          title="2. Voti giornata"
          subtitle="Fantacalcio · voti, gol (Gf+Rf), amm/esp/assist · marcatori + risultati derivati"
          endpoint="/admin/voti/upload-pdf"
          params={{ dry_run: false, replace: true }}
          afterSuccess={async (d) => {
            try {
              return await api(`/admin/voti/${d.matchday}/team-results`);
            } catch { return null; }
          }}
          onSuccessMessage={(d) =>
            `Giornata ${d.matchday}: ${d.stored_total} giocatori · ${d.scorers_count} marcatori (${d.total_goals} gol).`
          }
          renderPreview={(d) => {
            const teamRes = d.__extra;
            return (
              <View>
                <Text style={styles.previewTitle}>Marcatori</Text>
                <View style={styles.chipsWrap}>
                  {(d.scorers || []).map((s: any, i: number) => (
                    <View key={i} style={[styles.chip, { borderColor: theme.colors.warning + '55' }]}>
                      <Text style={styles.chipText}>
                        {s.player_name} ({s.team}) · {s.goals}⚽ · voto {s.voto}
                      </Text>
                    </View>
                  ))}
                  {(!d.scorers || d.scorers.length === 0) && (
                    <Text style={styles.muted}>Nessun marcatore in questa giornata.</Text>
                  )}
                </View>

                {teamRes && (
                  <>
                    <View style={styles.divider} />
                    <Text style={styles.previewTitle}>Risultati per squadra (calcolati)</Text>
                    <View style={styles.teamsGrid}>
                      {(teamRes.teams || []).map((t: any) => (
                        <View key={t.team} style={styles.teamRow}>
                          <Text style={styles.teamName}>{t.team}</Text>
                          <View style={styles.teamScores}>
                            <View style={[styles.scoreBadge, { backgroundColor: theme.colors.accent + '22' }]}>
                              <Text style={[styles.scoreText, { color: theme.colors.accent }]}>
                                {t.goals_scored_openplay}⚽
                              </Text>
                            </View>
                            <Text style={styles.teamDash}>·</Text>
                            <View style={[styles.scoreBadge, { backgroundColor: theme.colors.error + '22' }]}>
                              <Text style={[styles.scoreText, { color: theme.colors.error }]}>
                                {t.goals_conceded}🥅
                              </Text>
                            </View>
                            {t.red_cards > 0 && (
                              <View style={[styles.scoreBadge, { backgroundColor: theme.colors.error + '22' }]}>
                                <Text style={[styles.scoreText, { color: theme.colors.error }]}>
                                  {t.red_cards}🟥
                                </Text>
                              </View>
                            )}
                          </View>
                        </View>
                      ))}
                    </View>
                    <View style={[styles.sanityBox, teamRes.sanity?.consistent ? styles.sanityOk : styles.sanityWarn]}>
                      <Ionicons
                        name={teamRes.sanity?.consistent ? 'shield-checkmark' : 'warning'}
                        size={14}
                        color={teamRes.sanity?.consistent ? theme.colors.success : theme.colors.warning}
                      />
                      <Text style={styles.sanityText}>
                        {teamRes.sanity?.consistent
                          ? `Cross-check OK: ${teamRes.sanity.implied_total_goals} gol fatti = ${teamRes.sanity.gk_goals_conceded} gol subiti`
                          : `Attenzione: ${teamRes.sanity?.implied_total_goals} gol fatti ≠ ${teamRes.sanity?.gk_goals_conceded} gol subiti (posticipi o portiere non pervenuto)`
                        }
                      </Text>
                    </View>
                  </>
                )}
              </View>
            );
          }}
        />
      </ScrollView>
    </View>
  );
}

// -----------------------------------------------------------------------
// Styles
// -----------------------------------------------------------------------

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  infoBox: {
    flexDirection: 'row', gap: theme.spacing.sm,
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.brandTertiary, borderWidth: 1,
    borderColor: theme.colors.brand + '55',
  },
  infoText: { flex: 1, color: theme.colors.onSurfaceSecondary, fontSize: 12, lineHeight: 18 },
  card: {
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.border,
    gap: theme.spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  iconWrap: {
    width: 40, height: 40, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { color: theme.colors.onSurface, fontSize: 15, fontWeight: '800' },
  cardSub: { color: theme.colors.muted, fontSize: 11, marginTop: 2, lineHeight: 16 },
  dropZone: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: theme.spacing.sm, minHeight: 60,
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  dropText: { fontWeight: '700', fontSize: 14 },
  okBox: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.success + '18',
  },
  okText: { color: theme.colors.success, fontSize: 13, flex: 1, fontWeight: '600' },
  errBox: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.error + '18',
  },
  errText: { color: theme.colors.error, fontSize: 13, flex: 1 },
  previewWrap: {
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  previewTitle: {
    color: theme.colors.onSurfaceSecondary, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', marginBottom: theme.spacing.sm,
    letterSpacing: 0.5,
  },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: theme.spacing.md },
  chip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceTertiary,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  chipText: { color: theme.colors.onSurfaceSecondary, fontSize: 11, fontWeight: '600' },
  previewBlock: {
    maxHeight: 240, gap: 2,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceTertiary,
  },
  previewLine: {
    color: theme.colors.onSurfaceSecondary, fontSize: 11,
    fontFamily: Platform.select({ web: 'ui-monospace, monospace', default: 'monospace' }) as any,
  },
  muted: { color: theme.colors.muted, fontSize: 12, fontStyle: 'italic', lineHeight: 18 },
  divider: {
    height: 1, backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.md,
  },
  teamsGrid: { gap: 4, marginBottom: theme.spacing.md },
  teamRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 6, paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceTertiary,
  },
  teamName: { color: theme.colors.onSurface, fontSize: 13, fontWeight: '700', flex: 1 },
  teamScores: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  teamDash: { color: theme.colors.muted, fontSize: 12 },
  scoreBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.sm,
    minWidth: 34, alignItems: 'center',
  },
  scoreText: { fontSize: 12, fontWeight: '800' },
  sanityBox: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    borderWidth: 1,
  },
  sanityOk: {
    backgroundColor: theme.colors.success + '18',
    borderColor: theme.colors.success + '55',
  },
  sanityWarn: {
    backgroundColor: theme.colors.warning + '18',
    borderColor: theme.colors.warning + '55',
  },
  sanityText: { color: theme.colors.onSurfaceSecondary, fontSize: 11, flex: 1, fontWeight: '600' },
});
