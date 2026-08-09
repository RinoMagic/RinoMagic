/*
 * /admin/settle-matchday — Unified matchday settlement console.
 *
 * Admin flow:
 *   1. Pick a matchday number (defaults to the earliest open one)
 *   2. Upload the "voti giornata N.pdf" (Fantacalcio) — this populates
 *      matchday_facts and we then derive per-fixture scores + scorers
 *   3. Pick the "primo marcatore" of the day (dropdown from PDF scorers)
 *   4. Tap "Calcola" → shows a full dry-run preview
 *   5. Tap "Salva" to commit OR "Annulla" to discard and re-calculate
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  TextInput, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, apiUpload } from '@/src/api';
import { theme } from '@/src/theme';

const COLOR = '#10B981';

type Scorer = {
  player_code: number | null;
  player_name: string;
  team: string;
  role: string;
  goals: number;
  voto: number;
};
type Fixture = {
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  played: boolean;
  postponed?: boolean;
  excluded?: boolean;
};
type Affected = {
  survival_tournaments: number;
  score_tournaments: number;
  tiket_rooms: number;
  fanta_leagues: number;
  bonus_configs_open: number;
};
type State = {
  matchday: number; season: string;
  voti_loaded: boolean; voti_rows: number; affected: Affected;
};
type Preview = {
  matchday: number; season: string;
  fixtures: { total: number; played: number; postponed: number; list: Fixture[] };
  scorers: Scorer[];
  big_match: { home_team: string; away_team: string; home_score: number | null; away_score: number | null; played: boolean } | null;
  big_match_bonus_open: boolean;
  first_scorer_bonus_open: boolean;
  first_scorer_input: { player_name: string | null; team: string | null };
  affected: Affected;
  warnings: string[];
};

// Reuse the pattern from pdf-admin.tsx for web file picker
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

export default function SettleMatchday() {
  const router = useRouter();
  const [matchday, setMatchday] = useState('1');
  const [state, setState] = useState<State | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState<string | null>(null);
  // Ref that ALWAYS holds the latest matchday value. Guards against
  // React-closure staleness — if the admin re-uploads a PDF right after
  // changing the matchday, we still submit under the *current* value,
  // never a captured/stale one from a previous render.
  const matchdayRef = useRef<string>(matchday);
  useEffect(() => { matchdayRef.current = matchday; }, [matchday]);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [firstScorer, setFirstScorer] = useState<Scorer | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveLog, setSaveLog] = useState<any | null>(null);
  // Manual overrides: keyed by "Home||Away" → {home_score, away_score}
  const [overrides, setOverrides] = useState<Record<string, { home_score: string; away_score: string }>>({});
  // Postponed matches keyed by "Home||Away" — applied at settle time.
  const [postponed, setPostponed] = useState<Record<string, boolean>>({});

  const loadState = async (md: number) => {
    try {
      const s = await api<State>(`/admin/settle-matchday/state?matchday=${md}&season=2026-27`);
      setState(s);
    } catch (e: any) { alert(e.message); }
  };
  useEffect(() => {
    const md = parseInt(matchday, 10) || 1;
    // Changing the matchday number invalidates any pending preview /
    // save log — otherwise the admin sees stale fixtures from a
    // previously-selected matchday. We also wipe the last-upload chip
    // so the admin gets an unambiguous "fresh state" signal.
    setPreview(null);
    setSaveLog(null);
    setOverrides({});
    setPostponed({});
    setUploadResult(null);
    setUploadName(null);
    loadState(md);
  }, [matchday]);

  const doUploadPdf = async (file: File) => {
    setUploading(true); setUploadResult(null);
    setUploadName(file.name);
    try {
      // ALWAYS read the CURRENT matchday from the ref — the admin's top
      // input is the single source of truth. This guards against React
      // closure staleness and against the PDF header overriding the
      // admin's selection.
      const targetMd = parseInt(matchdayRef.current, 10) || 1;
      const d = await apiUpload<any>(
        '/admin/voti/upload-pdf',
        { name: file.name, type: file.type || 'application/pdf', blob: file },
        { dry_run: false, replace: true, matchday_override: targetMd },
      );
      const detected = d.matchday;
      const note = detected && detected !== targetMd
        ? ` ⚠️ (il PDF diceva G${detected}, salvato come G${targetMd} come da tuo campo in alto)`
        : '';
      setUploadResult(
        `Giornata ${d.matchday}: ${d.stored_total} giocatori · ${d.scorers_count} marcatori (${d.total_goals} gol).${note}`,
      );
      // Do NOT overwrite the matchday input — respect admin's choice.
      await loadState(targetMd);
      // Auto-generate the preview immediately so the admin can see all
      // fixtures + toggle postponed matches BEFORE confirming the settle.
      await doCalculate(targetMd);
    } catch (e: any) {
      setUploadResult(`❌ ${e.message}`);
    } finally {
      setUploading(false);
    }
  };
  const openPicker = useWebFileInput(doUploadPdf);

  const _buildOverrides = () => {
    return Object.entries(overrides)
      .filter(([, v]) => v.home_score !== '' && v.away_score !== ''
        && !Number.isNaN(parseInt(v.home_score, 10))
        && !Number.isNaN(parseInt(v.away_score, 10)))
      .map(([k, v]) => {
        const [home_team, away_team] = k.split('||');
        return {
          home_team, away_team,
          home_score: parseInt(v.home_score, 10),
          away_score: parseInt(v.away_score, 10),
        };
      });
  };

  const _buildPostponed = () =>
    Object.entries(postponed)
      .filter(([, v]) => v)
      .map(([k]) => {
        const [home_team, away_team] = k.split('||');
        return { home_team, away_team };
      });

  const doCalculate = async (forceMatchday?: number) => {
    setCalculating(true); setPreview(null); setSaveLog(null);
    try {
      // Always use the ref value — the admin's top input — as the
      // definitive matchday to calculate. Optionally an explicit value
      // can be passed by ``doUploadPdf`` right after storing the PDF.
      const md = forceMatchday ?? (parseInt(matchdayRef.current, 10) || 1);
      const p = await api<Preview>(`/admin/settle-matchday/preview`, {
        method: 'POST',
        body: {
          matchday: md, season: '2026-27',
          first_scorer_player_name: firstScorer?.player_name,
          first_scorer_team: firstScorer?.team,
          fixture_overrides: _buildOverrides(),
          postponed_matches: _buildPostponed(),
        },
      });
      setPreview(p);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setCalculating(false);
    }
  };

  const doCommit = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      const md = parseInt(matchday, 10);
      const r = await api<any>(`/admin/settle-matchday/commit`, {
        method: 'POST',
        body: {
          matchday: md, season: '2026-27',
          first_scorer_player_name: firstScorer?.player_name,
          first_scorer_team: firstScorer?.team,
          fixture_overrides: _buildOverrides(),
          postponed_matches: _buildPostponed(),
        },
      });
      setSaveLog(r);
      setPreview(null);
      await loadState(md);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const doCancel = () => {
    setPreview(null); setSaveLog(null);
  };

  // Prefill the overrides state with the auto-derived scores of played
  // fixtures so the admin can freely edit ANY match (not just postponed).
  useEffect(() => {
    if (preview) {
      const next: Record<string, { home_score: string; away_score: string }> = { ...overrides };
      preview.fixtures.list.forEach(f => {
        const k = `${f.home_team}||${f.away_team}`;
        if (!(k in next)) {
          next[k] = {
            home_score: f.home_score !== null ? String(f.home_score) : '',
            away_score: f.away_score !== null ? String(f.away_score) : '',
          };
        }
      });
      setOverrides(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.title}>Calcola Giornata</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 80 }}>
        {/* Always-visible sticky banner showing the currently selected
            matchday — the admin's single source of truth. */}
        <View style={styles.stickyMdBanner}>
          <Ionicons name="calendar" size={24} color="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={styles.stickyMdLabel}>STAI CALCOLANDO</Text>
            <Text style={styles.stickyMdValue}>GIORNATA {parseInt(matchday, 10) || 1}</Text>
          </View>
          <Text style={styles.stickyMdBadge}>G{parseInt(matchday, 10) || 1}</Text>
        </View>

        {/* Step 1 — matchday number */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>1 · GIORNATA</Text>
          <TextInput
            testID="mds-matchday"
            style={styles.input}
            keyboardType="numeric"
            value={matchday}
            onChangeText={setMatchday}
            placeholder="1"
            placeholderTextColor={theme.colors.muted}
          />
          {state && (
            <View style={styles.stateGrid}>
              <StateChip icon="document-text" label="Voti PDF"
                value={state.voti_loaded ? `${state.voti_rows} righe` : 'da caricare'}
                good={state.voti_loaded} />
              <StateChip icon="trophy" label="Survival"
                value={`${state.affected.survival_tournaments}`} />
              <StateChip icon="football" label="Score"
                value={`${state.affected.score_tournaments}`} />
              <StateChip icon="receipt" label="Tiket"
                value={`${state.affected.tiket_rooms}`} />
              <StateChip icon="star" label="Fanta"
                value={`${state.affected.fanta_leagues}`} />
              <StateChip icon="gift" label="Bonus"
                value={`${state.affected.bonus_configs_open}`} />
            </View>
          )}
        </View>

        {/* Step 2 — PDF upload */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>2 · PDF VOTI GIORNATA</Text>
          <Text style={styles.help}>
            Carica il PDF di Fantacalcio (voti calciatori). Da questo ricaviamo
            automaticamente risultati partite, marcatori, gol subiti/fatti per squadra.
          </Text>
          <Pressable
            testID="mds-upload"
            style={[styles.dropZone, uploading && { opacity: 0.6 }]}
            onPress={openPicker}
            disabled={uploading}
          >
            {uploading
              ? <ActivityIndicator color={COLOR} />
              : <>
                  <Ionicons name="cloud-upload-outline" size={26} color={COLOR} />
                  <Text style={[styles.dropText, { color: COLOR }]}>
                    {uploadName ? `Cambia file (${uploadName})` : 'Seleziona PDF Voti'}
                  </Text>
                </>}
          </Pressable>
          {uploadResult && <Text style={styles.uploadResult}>{uploadResult}</Text>}
        </View>

        {/* Step 3 — first scorer picker (visible after voti loaded) */}
        {state?.voti_loaded && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>3 · PRIMO MARCATORE DELLA GIORNATA</Text>
            <Text style={styles.help}>
              Serve per liquidare il bonus «Primo Marcatore» (Score + Fanta).
              Scegli dalla lista dei marcatori estratti dal PDF.
            </Text>
            <FirstScorerPicker
              matchday={parseInt(matchday, 10) || 1}
              value={firstScorer}
              onChange={setFirstScorer}
            />
          </View>
        )}

        {/* Step 4 — Calcola */}
        {state?.voti_loaded && !preview && !saveLog && (
          <Pressable
            testID="mds-calculate"
            onPress={doCalculate}
            disabled={calculating}
            style={[styles.mainBtn, { backgroundColor: COLOR }, calculating && { opacity: 0.5 }]}
          >
            {calculating
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Ionicons name="calculator" size={18} color="#fff" />
                  <Text style={styles.mainBtnText}>CALCOLA</Text>
                </>}
          </Pressable>
        )}

        {/* Step 5 — Preview + Salva/Annulla */}
        {preview && !saveLog && (
          <PreviewBlock
            preview={preview}
            overrides={overrides}
            setOverride={(k, side, val) => setOverrides(o => ({
              ...o, [k]: { ...(o[k] || { home_score: '', away_score: '' }), [side]: val },
            }))}
            postponed={postponed}
            togglePostponed={(k) => setPostponed(p => ({ ...p, [k]: !p[k] }))}
            onRecalc={doCalculate}
            recalculating={calculating}
            onSave={doCommit}
            onCancel={doCancel}
            saving={saving}
          />
        )}

        {/* Step 6 — Save log */}
        {saveLog && <SaveLogBlock log={saveLog} />}
      </ScrollView>
    </SafeAreaView>
  );
}


function StateChip({ icon, label, value, good }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; value: string; good?: boolean;
}) {
  return (
    <View style={[styles.chip, good && { backgroundColor: COLOR + '15', borderColor: COLOR }]}>
      <Ionicons name={icon} size={14} color={good ? COLOR : theme.colors.muted} />
      <Text style={styles.chipLabel}>{label}</Text>
      <Text style={[styles.chipValue, good && { color: COLOR }]}>{value}</Text>
    </View>
  );
}


function FirstScorerPicker({ matchday, value, onChange }: {
  matchday: number; value: Scorer | null; onChange: (s: Scorer | null) => void;
}) {
  const [q, setQ] = useState('');
  const [scorers, setScorers] = useState<Scorer[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const resp = await api<any>(`/admin/voti/${matchday}/scorers`);
        // Endpoint returns {matchday, count, total_goals, scorers: [...]}
        const list: Scorer[] = Array.isArray(resp) ? resp : (resp?.scorers || []);
        // Normalise field names (total_goals → goals)
        const normalised = list.map((s: any) => ({
          player_code: s.player_code ?? null,
          player_name: s.player_name || '',
          team: s.team || '',
          role: s.role || '',
          goals: s.goals ?? s.total_goals ?? 0,
          voto: s.voto ?? 0,
        }));
        setScorers(normalised);
      } catch { setScorers([]); }
    })();
  }, [matchday]);
  const filtered = q.trim()
    ? scorers.filter(s =>
        (s.player_name || '').toLowerCase().includes(q.toLowerCase())
        || (s.team || '').toLowerCase().includes(q.toLowerCase()))
    : scorers;
  return (
    <View style={{ gap: 8 }}>
      <TextInput
        style={styles.input}
        placeholder="Cerca marcatore..."
        placeholderTextColor={theme.colors.muted}
        value={q}
        onChangeText={setQ}
      />
      <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
        {filtered.length === 0 && <Text style={styles.muted}>Nessun marcatore trovato.</Text>}
        {filtered.map((s) => {
          const isSelected = value?.player_name === s.player_name && value?.team === s.team;
          return (
            <Pressable
              key={`${s.player_name}-${s.team}`}
              onPress={() => onChange(isSelected ? null : s)}
              style={[styles.scorerRow, isSelected && { backgroundColor: COLOR + '22', borderColor: COLOR }]}
            >
              <Text style={styles.scorerName}>{s.player_name}</Text>
              <Text style={styles.scorerMeta}>{s.team} · {s.goals} gol · voto {s.voto}</Text>
              {isSelected && <Ionicons name="checkmark-circle" size={18} color={COLOR} />}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}


function PreviewBlock({
  preview, overrides, setOverride, postponed, togglePostponed,
  onRecalc, recalculating, onSave, onCancel, saving,
}: {
  preview: Preview;
  overrides: Record<string, { home_score: string; away_score: string }>;
  setOverride: (key: string, side: 'home_score' | 'away_score', val: string) => void;
  postponed: Record<string, boolean>;
  togglePostponed: (key: string) => void;
  onRecalc: () => void;
  recalculating: boolean;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <View style={styles.card}>
      {/* Prominent header — always visible so the admin instantly
          knows WHICH matchday the current preview refers to. */}
      <View style={styles.previewMdBanner}>
        <Ionicons name="calendar" size={22} color="#fff" />
        <View style={{ flex: 1 }}>
          <Text style={styles.previewMdBannerLabel}>STAI CALCOLANDO</Text>
          <Text style={styles.previewMdBannerValue}>GIORNATA {preview.matchday}</Text>
        </View>
        <Text style={styles.previewMdBannerBadge}>G{preview.matchday}</Text>
      </View>

      <Text style={styles.previewTitle}>ANTEPRIMA GIORNATA {preview.matchday}</Text>

      {/* Privacy banner — clarifies nothing is public yet */}
      <View style={styles.privacyBanner}>
        <Ionicons name="lock-closed" size={16} color="#3B82F6" />
        <View style={{ flex: 1 }}>
          <Text style={styles.privacyTitle}>Anteprima privata</Text>
          <Text style={styles.privacyText}>
            Solo tu vedi questi risultati. Nulla è visibile agli utenti finché non premi &laquo;Conferma e Pubblica&raquo;.
          </Text>
        </View>
      </View>

      {preview.warnings.length > 0 && (
        <View style={styles.warnBox}>
          {preview.warnings.map((w, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 6 }}>
              <Ionicons name="warning" size={14} color="#B45309" />
              <Text style={styles.warnText}>{w}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.sectionH}>Partite (segna rinviate ✕ o correggi risultato)</Text>
      <View style={{ gap: 4 }}>
        {preview.fixtures.list.map((f, i) => {
          const k = `${f.home_team}||${f.away_team}`;
          const ov = overrides[k] || {
            home_score: f.home_score !== null ? String(f.home_score) : '',
            away_score: f.away_score !== null ? String(f.away_score) : '',
          };
          const isManual = (f as any).manual || (!f.played && (ov.home_score !== '' || ov.away_score !== ''));
          const isPost = !!postponed[k];
          return (
            <View
              key={i}
              style={[
                styles.fxRow,
                !f.played && !isPost && { borderWidth: 1, borderColor: '#F59E0B55' },
                isManual && !isPost && { borderWidth: 1, borderColor: '#3B82F655' },
                isPost && { borderWidth: 1, borderColor: '#EF4444AA', backgroundColor: '#FEE2E230' },
              ]}
            >
              <Pressable
                onPress={() => togglePostponed(k)}
                style={[styles.postToggle, isPost && { backgroundColor: '#EF4444', borderColor: '#EF4444' }]}
                testID={`mds-postpone-${i}`}
              >
                <Ionicons
                  name={isPost ? 'close-circle' : 'close-circle-outline'}
                  size={16}
                  color={isPost ? '#fff' : theme.colors.muted}
                />
              </Pressable>
              <Text style={[styles.fxTeam, isPost && { color: theme.colors.muted, textDecorationLine: 'line-through' }]}>{f.home_team}</Text>
              {isPost ? (
                <Text style={styles.fxPostLabel}>RINVIATA</Text>
              ) : (
                <View style={styles.scoreInputRow}>
                  <TextInput
                    style={styles.scoreInput}
                    keyboardType="numeric"
                    value={ov.home_score}
                    onChangeText={(v) => setOverride(k, 'home_score', v.replace(/[^0-9]/g, ''))}
                    placeholder="-"
                    placeholderTextColor={theme.colors.muted}
                    maxLength={2}
                  />
                  <Text style={styles.scoreDash}>–</Text>
                  <TextInput
                    style={styles.scoreInput}
                    keyboardType="numeric"
                    value={ov.away_score}
                    onChangeText={(v) => setOverride(k, 'away_score', v.replace(/[^0-9]/g, ''))}
                    placeholder="-"
                    placeholderTextColor={theme.colors.muted}
                    maxLength={2}
                  />
                </View>
              )}
              <Text style={[styles.fxTeam, isPost && { color: theme.colors.muted, textDecorationLine: 'line-through' }]}>{f.away_team}</Text>
            </View>
          );
        })}
      </View>
      <Pressable
        onPress={onRecalc}
        disabled={recalculating}
        style={[styles.recalcBtn, recalculating && { opacity: 0.5 }]}
        testID="mds-recalc"
      >
        {recalculating ? <ActivityIndicator color={COLOR} size="small" />
          : <><Ionicons name="refresh" size={14} color={COLOR} /><Text style={styles.recalcBtnText}>Ricalcola con i dati inseriti</Text></>}
      </Pressable>

      {preview.big_match && (
        <>
          <Text style={styles.sectionH}>Big Match Bonus</Text>
          <View style={styles.fxRow}>
            <Text style={styles.fxTeam}>{preview.big_match.home_team}</Text>
            <Text style={styles.fxScore}>
              {preview.big_match.played
                ? `${preview.big_match.home_score} – ${preview.big_match.away_score}`
                : 'rinviata'}
            </Text>
            <Text style={styles.fxTeam}>{preview.big_match.away_team}</Text>
          </View>
        </>
      )}

      {preview.first_scorer_bonus_open && (
        <>
          <Text style={styles.sectionH}>Primo Marcatore Bonus</Text>
          <Text style={styles.fsInfo}>
            {preview.first_scorer_input.player_name
              ? `${preview.first_scorer_input.player_name} (${preview.first_scorer_input.team || '—'})`
              : '⚠️ nessun marcatore selezionato'}
          </Text>
        </>
      )}

      <Text style={styles.sectionH}>Impatto</Text>
      <View style={styles.impactGrid}>
        <ImpactCell label="Survival" val={preview.affected.survival_tournaments} />
        <ImpactCell label="Score" val={preview.affected.score_tournaments} />
        <ImpactCell label="Tiket" val={preview.affected.tiket_rooms} />
        <ImpactCell label="Fanta" val={preview.affected.fanta_leagues} />
        <ImpactCell label="Bonus" val={preview.affected.bonus_configs_open} />
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <Pressable
          testID="mds-cancel"
          onPress={onCancel}
          disabled={saving}
          style={[styles.cancelBtn, saving && { opacity: 0.5 }]}
        >
          <Text style={styles.cancelBtnText}>ANNULLA ANTEPRIMA</Text>
        </Pressable>
        <Pressable
          testID="mds-save"
          onPress={() => {
            const msg = `Confermi la pubblicazione della Giornata ${preview.matchday}?\n\n`
              + `• ${preview.affected.survival_tournaments} tornei Survival\n`
              + `• ${preview.affected.score_tournaments} tornei Score\n`
              + `• ${preview.affected.tiket_rooms} stanze Tiket\n`
              + `• ${preview.affected.fanta_leagues} leghe Fanta\n`
              + `• ${preview.affected.bonus_configs_open} bonus\n\n`
              + `Dopo la pubblicazione i risultati saranno visibili a TUTTI gli utenti.`;
            if (typeof window !== 'undefined' && window.confirm) {
              if (window.confirm(msg)) onSave();
            } else if (Platform.OS !== 'web') {
              Alert.alert(
                'Conferma e Pubblica',
                msg,
                [
                  { text: 'Annulla', style: 'cancel' },
                  { text: 'PUBBLICA', style: 'destructive', onPress: onSave },
                ],
              );
            } else {
              onSave();
            }
          }}
          disabled={saving}
          style={[styles.saveBtn, saving && { opacity: 0.5 }]}
        >
          {saving ? <ActivityIndicator color="#fff" />
            : <><Ionicons name="checkmark-done" size={16} color="#fff" /><Text style={styles.saveBtnText}>CONFERMA E PUBBLICA</Text></>}
        </Pressable>
      </View>
    </View>
  );
}


function ImpactCell({ label, val }: { label: string; val: number }) {
  return (
    <View style={styles.impactCell}>
      <Text style={styles.impactNum}>{val}</Text>
      <Text style={styles.impactLabel}>{label}</Text>
    </View>
  );
}




function SaveLogBlock({ log }: { log: any }) {
  const s = log.summary || {};
  return (
    <View style={[styles.card, { borderColor: COLOR }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="checkmark-circle" size={22} color={COLOR} />
        <Text style={[styles.previewTitle, { color: COLOR }]}>SALVATO</Text>
      </View>
      <Text style={styles.help}>
        Giornata {log.matchday} liquidata. Riepilogo:
      </Text>
      <View style={styles.impactGrid}>
        <ImpactCell label="Survival" val={s.settled?.survival || 0} />
        <ImpactCell label="Score" val={s.settled?.score || 0} />
        <ImpactCell label="Tiket" val={s.settled?.tiket || 0} />
        <ImpactCell label="Fanta" val={s.settled?.fanta || 0} />
        <ImpactCell label="Bonus Exact" val={s.settled?.bonus_exact || 0} />
        <ImpactCell label="Bonus Marc." val={s.settled?.bonus_first_scorer || 0} />
      </View>
      {(s.errors > 0 || s.skipped > 0) && (
        <Text style={styles.help}>
          {s.skipped > 0 ? `${s.skipped} skippati (già liquidati) · ` : ''}
          {s.errors > 0 ? `${s.errors} errori` : ''}
        </Text>
      )}
      {log.log && log.log.length > 0 && (
        <ScrollView style={{ maxHeight: 240, marginTop: 8 }}>
          {log.log.map((row: any, i: number) => (
            <View key={i} style={styles.logRow}>
              <Text style={[
                styles.logDot,
                { color: row.skipped ? theme.colors.muted
                  : row.status === 200 ? COLOR : theme.colors.error },
              ]}>●</Text>
              <Text style={styles.logText}>
                [{row.game}] {row.tournament || row.room || row.league || row.config_id}: {' '}
                {row.skipped ? `skipped (${row.reason})`
                  : row.status === 200 ? 'ok'
                  : `errore ${row.status}: ${JSON.stringify(row.detail).slice(0, 100)}`}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}


const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border,
  },
  title: { color: theme.colors.text, fontWeight: '800', fontSize: 17 },
  card: {
    padding: 14, borderRadius: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border, gap: 8,
  },
  cardLabel: {
    color: theme.colors.muted, fontSize: 11, fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  input: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border,
    padding: 10, color: theme.colors.text, fontSize: 15,
  },
  help: { color: theme.colors.muted, fontSize: 12, lineHeight: 16 },
  stateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  chipLabel: { color: theme.colors.muted, fontSize: 11, fontWeight: '700' },
  chipValue: { color: theme.colors.text, fontSize: 11, fontWeight: '900', marginLeft: 2 },
  dropZone: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    padding: 20, borderWidth: 2, borderColor: COLOR + '55',
    borderStyle: 'dashed', borderRadius: 12,
    backgroundColor: COLOR + '08',
  },
  dropText: { fontWeight: '800' },
  uploadResult: { color: theme.colors.text, fontSize: 12, fontStyle: 'italic' },
  scorerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 8, borderRadius: 8, borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSecondary,
    marginBottom: 4,
  },
  scorerName: { color: theme.colors.text, fontWeight: '700', fontSize: 13, flex: 1 },
  scorerMeta: { color: theme.colors.muted, fontSize: 11 },
  muted: { color: theme.colors.muted, fontStyle: 'italic', padding: 8 },
  mainBtn: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderRadius: 12,
  },
  mainBtnText: { color: '#fff', fontWeight: '900', fontSize: 15, letterSpacing: 0.5 },
  previewTitle: { color: theme.colors.text, fontWeight: '900', fontSize: 15, letterSpacing: 0.5 },
  stickyMdBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14,
    backgroundColor: '#EF4444',
    borderRadius: 12,
  },
  stickyMdLabel: {
    color: '#fff', fontSize: 10, fontWeight: '800',
    letterSpacing: 1, opacity: 0.85,
  },
  stickyMdValue: {
    color: '#fff', fontSize: 18, fontWeight: '900',
    letterSpacing: 0.5, marginTop: 2,
  },
  stickyMdBadge: {
    color: '#EF4444', fontSize: 20, fontWeight: '900',
    backgroundColor: '#fff',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 6,
  },
  previewMdBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, marginBottom: 8,
    backgroundColor: '#EF4444',
    borderRadius: 12,
  },
  previewMdBannerLabel: {
    color: '#fff', fontSize: 10, fontWeight: '800',
    letterSpacing: 1, opacity: 0.85,
  },
  previewMdBannerValue: {
    color: '#fff', fontSize: 18, fontWeight: '900',
    letterSpacing: 0.5, marginTop: 2,
  },
  previewMdBannerBadge: {
    color: '#EF4444', fontSize: 20, fontWeight: '900',
    backgroundColor: '#fff',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 6,
  },
  warnBox: {
    padding: 8, backgroundColor: '#FEF3C7', borderRadius: 8, gap: 4,
    borderWidth: 1, borderColor: '#F59E0B55',
  },
  warnText: { color: '#92400E', fontSize: 12, flex: 1 },
  sectionH: { color: theme.colors.muted, fontSize: 11, fontWeight: '800', marginTop: 8 },
  fxRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 4, paddingHorizontal: 8,
    backgroundColor: theme.colors.surfaceSecondary, borderRadius: 8,
  },
  fxTeam: { color: theme.colors.text, fontSize: 12, fontWeight: '700', flex: 1 },
  fxScore: { color: COLOR, fontSize: 14, fontWeight: '900', flex: 0.6, textAlign: 'center' },
  fxScorePost: { color: theme.colors.muted, fontSize: 11, fontStyle: 'italic', flex: 0.6, textAlign: 'center' },
  scoreInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    flex: 0.7, justifyContent: 'center',
  },
  scoreInput: {
    width: 36, height: 32, borderRadius: 6,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
    color: theme.colors.text, fontWeight: '900', fontSize: 15,
    textAlign: 'center', padding: 0,
  },
  scoreDash: { color: theme.colors.muted, fontWeight: '900', fontSize: 14 },
  recalcBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6,
    backgroundColor: COLOR + '15', borderWidth: 1, borderColor: COLOR + '55',
  },
  recalcBtnText: { color: COLOR, fontWeight: '800', fontSize: 12 },
  fsInfo: { color: theme.colors.text, fontSize: 13, fontWeight: '700', padding: 8, backgroundColor: theme.colors.surfaceSecondary, borderRadius: 8 },
  impactGrid: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  impactCell: {
    flex: 1, minWidth: 78, alignItems: 'center', padding: 8,
    backgroundColor: theme.colors.surfaceSecondary, borderRadius: 8,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  impactNum: { color: theme.colors.text, fontWeight: '900', fontSize: 20 },
  impactLabel: { color: theme.colors.muted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  saveBtn: {
    flex: 1, flexDirection: 'row', gap: 6,
    backgroundColor: COLOR, paddingVertical: 12, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '900', letterSpacing: 0.5 },
  cancelBtn: {
    flex: 1, backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.border,
    paddingVertical: 12, borderRadius: 10, alignItems: 'center',
  },
  cancelBtnText: { color: theme.colors.text, fontWeight: '800', letterSpacing: 0.5 },
  logRow: { flexDirection: 'row', gap: 6, paddingVertical: 2 },
  logDot: { fontSize: 14, lineHeight: 16 },
  logText: { color: theme.colors.text, fontSize: 11, flex: 1 },
  excCountBadge: {
    backgroundColor: '#EF4444', paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 10,
  },
  excCountText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  exclusionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  exclusionTeams: { color: theme.colors.text, fontSize: 13, fontWeight: '700', flex: 1 },
  exclusionBtn: {
    flexDirection: 'row', gap: 4, alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
    minWidth: 90, justifyContent: 'center',
  },
  exclusionBtnText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  postToggle: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 1, borderColor: theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSecondary,
  },
  fxPostLabel: {
    color: '#EF4444', fontSize: 11, fontWeight: '900',
    letterSpacing: 0.5, flex: 0.7, textAlign: 'center',
  },
  privacyBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 12, borderRadius: 10,
    backgroundColor: '#1E3A8A',
    borderWidth: 1, borderColor: '#3B82F6',
    marginBottom: 8,
  },
  privacyTitle: { color: '#DBEAFE', fontSize: 13, fontWeight: '900', marginBottom: 2 },
  privacyText: { color: '#BFDBFE', fontSize: 11, lineHeight: 15 },
});
