import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Platform,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import {
  formatPrediction,
  isUnknownPrediction,
  PREDICTION_GROUPS,
} from '@/src/utils/predictions';

type Event = {
  home_team: string;
  away_team: string;
  prediction: string;
  odd: number;
};

export default function UploadSchedina() {
  const { id, asUser, asName } = useLocalSearchParams<{
    id: string;
    asUser?: string;
    asName?: string;
  }>();
  const router = useRouter();
  const onBehalfOf = typeof asUser === 'string' && asUser.length > 0 ? asUser : null;
  const onBehalfName = typeof asName === 'string' ? asName : null;
  const [preview, setPreview] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [maxEvents, setMaxEvents] = useState(7);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [step, setStep] = useState<'pick' | 'confirm'>('pick');
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setMsg('Permesso galleria negato');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const b64 = asset.base64;
    if (!b64) {
      setMsg('Impossibile leggere l&apos;immagine');
      return;
    }
    setPreview(`data:image/jpeg;base64,${b64}`);
    await runOcr(b64);
  };

  const runOcr = async (b64: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ events: Event[]; max_events: number; raw_text?: string }>(
        `/rooms/${id}/schedina/ocr`,
        {
          method: 'POST',
          body: onBehalfOf
            ? { image_base64: b64, on_behalf_of: onBehalfOf }
            : { image_base64: b64 },
        }
      );
      setMaxEvents(res.max_events);
      if (res.events.length === 0) {
        // Give the user 3 empty rows to make manual entry less painful.
        setEvents([
          { home_team: '', away_team: '', prediction: '1', odd: 0 },
          { home_team: '', away_team: '', prediction: '1', odd: 0 },
          { home_team: '', away_team: '', prediction: '1', odd: 0 },
        ]);
        setMsg(
          'OCR non ha trovato eventi. Verifica che lo screenshot sia leggibile (senza tagli) e inserisci i pronostici manualmente.'
        );
      } else {
        setEvents(res.events);
        if (res.events.length < 3) {
          setMsg(
            `OCR ha trovato ${res.events.length} evento/i. Se lo screenshot conteneva più partite, aggiungi manualmente le mancanti.`
          );
        }
      }
      setStep('confirm');
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const updateEvent = (i: number, patch: Partial<Event>) => {
    setEvents((arr) => arr.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  };
  const removeEvent = (i: number) => setEvents((arr) => arr.filter((_, idx) => idx !== i));
  const addEvent = () => {
    if (events.length >= maxEvents) {
      setMsg(`Massimo ${maxEvents} pronostici`);
      return;
    }
    setEvents((arr) => [...arr, { home_team: '', away_team: '', prediction: '1', odd: 0 }]);
  };

  const hasInvalidPrediction = events.some((e) => isUnknownPrediction(e.prediction));
  const hasInvalidOdd = events.some((e) => !e.odd || e.odd < 1.01);
  const canConfirm = events.length > 0 && !hasInvalidPrediction && !hasInvalidOdd;

  const submit = async () => {
    if (!canConfirm) {
      if (events.length === 0) return setMsg('Nessun pronostico rilevato — ricarica lo screenshot.');
      if (hasInvalidPrediction) {
        return setMsg(
          "L'OCR non ha riconosciuto uno o più mercati. Ricarica uno screenshot più nitido."
        );
      }
      if (hasInvalidOdd) {
        return setMsg(
          "L'OCR non ha letto correttamente le quote. Ricarica uno screenshot più nitido."
        );
      }
    }
    setBusy(true);
    setMsg(null);
    try {
      // NOTE: no body is needed — the backend uses the OCR draft it stored
      // during upload. Sending events would be ignored server-side by design
      // (anti-cheat: prevent the client from tampering with odds).
      await api(`/rooms/${id}/schedina/confirm`, {
        method: 'POST',
        body: onBehalfOf ? { on_behalf_of: onBehalfOf } : {},
      });
      if (Platform.OS !== 'web') {
        Alert.alert('OK', 'Schedina consegnata!');
      }
      router.replace(`/room/${id}`);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="upload-back">
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>
            {step === 'pick' ? 'Carica screenshot' : 'Conferma pronostici'}
          </Text>
          <View style={{ width: 26 }} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120 }}>
        {onBehalfOf && (
          <View style={styles.behalfBanner} testID="on-behalf-banner">
            <Ionicons name="person-add" size={20} color={theme.colors.brand} />
            <View style={{ flex: 1 }}>
              <Text style={styles.behalfTitle}>
                Stai caricando per {onBehalfName || 'un altro giocatore'}
              </Text>
              <Text style={styles.behalfSub}>
                La schedina sarà registrata a suo nome. Verifica che lo screenshot sia effettivamente il suo.
              </Text>
            </View>
          </View>
        )}

        {step === 'pick' && (
          <>
            <View style={styles.instr}>
              <Text style={styles.instrTitle}>Come funziona</Text>
              <Text style={styles.instrText}>
                1. Apri Staryes.it, componi la schedina Serie A e mettila nel carrello{'\n'}
                2. Fai uno screenshot dello schermo{'\n'}
                3. Tocca il pulsante qui sotto e seleziona l&apos;immagine{'\n'}
                4. Verifica ed eventualmente correggi cio che l&apos;OCR ha letto{'\n'}
                5. Conferma
              </Text>
            </View>
            <Pressable
              testID="pick-image-btn"
              onPress={pickImage}
              disabled={busy}
              style={[styles.pickBtn, busy && { opacity: 0.6 }]}
            >
              {busy ? (
                <ActivityIndicator color={theme.colors.onBrand} />
              ) : (
                <>
                  <Ionicons name="image" size={22} color={theme.colors.onBrand} />
                  <Text style={styles.pickBtnText}>Seleziona screenshot</Text>
                </>
              )}
            </Pressable>
            {msg && <Text style={styles.err}>{msg}</Text>}
          </>
        )}

        {step === 'confirm' && (
          <>
            {preview && (
              <View style={styles.previewWrap}>
                <Image source={preview} style={styles.preview} contentFit="cover" />
                <Pressable
                  onPress={() => { setStep('pick'); setEvents([]); setPreview(null); }}
                  style={styles.previewChange}
                  testID="change-image"
                >
                  <Ionicons name="refresh" size={14} color={theme.colors.onSurface} />
                  <Text style={styles.previewChangeText}>Rifai</Text>
                </Pressable>
              </View>
            )}
            <View style={styles.lockNotice}>
              <Ionicons name="shield-checkmark" size={18} color={theme.colors.brand} />
              <Text style={styles.lockNoticeText}>
                Anti-cheat: quote e pronostici sono letti automaticamente dallo screenshot e
                non sono modificabili. Se qualcosa è sbagliato, rifai lo screenshot.
              </Text>
            </View>

            {events.map((e, i) => {
              const bad = isUnknownPrediction(e.prediction);
              const badOdd = !e.odd || e.odd < 1.01;
              return (
                <View
                  key={i}
                  style={[
                    styles.eventCard,
                    (bad || badOdd) && { borderColor: theme.colors.error, borderWidth: 1.5 },
                  ]}
                >
                  <View style={styles.eventHead}>
                    <Text style={styles.eventNum}>#{i + 1}</Text>
                    {(bad || badOdd) && (
                      <View style={styles.badTag}>
                        <Ionicons name="alert-circle" size={12} color={theme.colors.error} />
                        <Text style={styles.badTagText}>OCR non riuscito</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.eventRowStatic}>
                    <Text style={styles.eventTeamStatic} numberOfLines={1}>
                      {e.home_team || '—'}
                    </Text>
                    <Text style={styles.vs}>vs</Text>
                    <Text style={styles.eventTeamStatic} numberOfLines={1}>
                      {e.away_team || '—'}
                    </Text>
                  </View>
                  <View style={styles.predRowStatic}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.marketLabel}>PRONOSTICO</Text>
                      <Text
                        style={[
                          styles.marketValue,
                          bad && { color: theme.colors.error },
                        ]}
                        numberOfLines={2}
                      >
                        {bad ? 'MERCATO NON AMMESSO' : formatPrediction(e.prediction)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.oddRowStatic}>
                    <Text style={styles.oddLabel}>Quota</Text>
                    <Text
                      style={[
                        styles.oddValue,
                        badOdd && { color: theme.colors.error },
                      ]}
                    >
                      {e.odd ? e.odd.toFixed(2) : '—'}
                    </Text>
                  </View>
                </View>
              );
            })}

            {msg && <Text style={[styles.err, { marginTop: theme.spacing.md }]}>{msg}</Text>}

            {(hasInvalidPrediction || hasInvalidOdd) && (
              <View style={styles.retakeBox}>
                <Ionicons name="camera-reverse" size={20} color={theme.colors.error} />
                <Text style={styles.retakeText}>
                  {hasInvalidPrediction
                    ? "L'OCR non ha riconosciuto uno o più mercati."
                    : "L'OCR non ha letto correttamente le quote."}
                  {' '}Ricarica uno screenshot più nitido (senza tagli, ben illuminato).
                </Text>
              </View>
            )}

            <Pressable
              testID="confirm-schedina-btn"
              onPress={submit}
              disabled={busy || !canConfirm}
              style={[
                styles.cta,
                (busy || !canConfirm) && { opacity: 0.4 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color={theme.colors.onBrand} />
              ) : (
                <Text style={styles.ctaText}>
                  {canConfirm ? 'Conferma schedina' : 'Impossibile confermare'}
                </Text>
              )}
            </Pressable>

            <Pressable
              testID="retake-schedina-btn"
              onPress={() => { setStep('pick'); setEvents([]); setPreview(null); setMsg(null); }}
              style={styles.retakeCta}
            >
              <Ionicons name="refresh" size={18} color={theme.colors.onSurface} />
              <Text style={styles.retakeCtaText}>Rifai lo screenshot</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <MarketPickerModal
        visible={pickerIndex !== null}
        currentCode={pickerIndex !== null ? events[pickerIndex]?.prediction : undefined}
        onClose={() => setPickerIndex(null)}
        onPick={(code) => {
          if (pickerIndex !== null) updateEvent(pickerIndex, { prediction: code });
          setPickerIndex(null);
        }}
      />
    </View>
  );
}

function MarketPickerModal({
  visible,
  currentCode,
  onClose,
  onPick,
}: {
  visible: boolean;
  currentCode?: string;
  onClose: () => void;
  onPick: (code: string) => void;
}) {
  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.pickerBackdrop}>
        <View style={styles.pickerCard}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Scegli il mercato</Text>
            <Pressable onPress={onClose} hitSlop={12} testID="close-market-picker">
              <Ionicons name="close" size={24} color={theme.colors.onSurface} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}>
            {PREDICTION_GROUPS.map((group) => (
              <View key={group.title}>
                <Text style={styles.groupTitle}>{group.title}</Text>
                <View style={styles.groupChips}>
                  {group.options.map((opt) => {
                    const active = currentCode === opt.code;
                    return (
                      <Pressable
                        key={opt.code}
                        testID={`market-opt-${opt.code}`}
                        onPress={() => onPick(opt.code)}
                        style={[styles.optionChip, active && styles.optionChipActive]}
                      >
                        <Text
                          style={[styles.optionShort, active && styles.optionShortActive]}
                        >
                          {opt.short}
                        </Text>
                        <Text
                          style={[styles.optionLabel, active && styles.optionLabelActive]}
                          numberOfLines={1}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing.lg,
  },
  title: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 18 },
  instr: {
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.lg,
  },
  instrTitle: { color: theme.colors.onSurface, fontWeight: '800', marginBottom: 8 },
  instrText: { color: theme.colors.onSurfaceSecondary, lineHeight: 20, fontSize: 13 },
  pickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.brand,
    height: 56,
    borderRadius: theme.radius.md,
  },
  pickBtnText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 16 },
  err: {
    color: theme.colors.error,
    marginTop: theme.spacing.md,
    textAlign: 'center',
    fontSize: 13,
  },
  previewWrap: {
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.md,
    position: 'relative',
  },
  preview: { width: '100%', height: 220, backgroundColor: theme.colors.surfaceSecondary },
  previewChange: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
  },
  previewChangeText: { color: theme.colors.onSurface, fontSize: 12, fontWeight: '600' },
  hint: {
    color: theme.colors.muted,
    fontSize: 12,
    marginBottom: theme.spacing.md,
    textAlign: 'center',
  },
  eventCard: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  eventHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eventNum: { color: theme.colors.brand, fontWeight: '800' },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  eventInput: {
    flex: 1,
    color: theme.colors.onSurface,
    backgroundColor: theme.colors.surfaceTertiary,
    padding: theme.spacing.md,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: 14,
  },
  vs: { color: theme.colors.muted, fontWeight: '800' },
  predRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  marketButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceTertiary,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  marketButtonError: {
    backgroundColor: theme.colors.error + '18',
    borderColor: theme.colors.error,
    borderWidth: 2,
  },
  marketLabel: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  marketLabelError: {
    color: theme.colors.error,
  },
  marketValue: {
    color: theme.colors.onSurface,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  marketValueError: {
    color: theme.colors.error,
  },
  oddRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  oddLabel: { color: theme.colors.muted, fontWeight: '600' },
  oddInput: {
    flex: 1,
    color: theme.colors.onSurface,
    backgroundColor: theme.colors.surfaceTertiary,
    padding: theme.spacing.md,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontWeight: '800',
    fontSize: 16,
  },
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
  cta: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.brand,
    height: 56,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 16 },

  // Market picker modal
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  pickerCard: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    maxHeight: '88%',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  pickerTitle: {
    color: theme.colors.onSurface,
    fontSize: 16,
    fontWeight: '800',
  },
  groupTitle: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: theme.spacing.sm,
  },
  groupChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    minWidth: 96,
    flexShrink: 1,
  },
  optionChipActive: {
    backgroundColor: theme.colors.brand,
    borderColor: theme.colors.brand,
  },
  optionShort: {
    color: theme.colors.onSurface,
    fontWeight: '800',
    fontSize: 13,
  },
  optionShortActive: {
    color: theme.colors.onBrand,
  },
  optionLabel: {
    color: theme.colors.muted,
    fontSize: 11,
    marginTop: 2,
  },
  optionLabelActive: {
    color: theme.colors.onBrand,
    opacity: 0.85,
  },
  lockNotice: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.brand + '15',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.brand + '55',
    marginBottom: theme.spacing.md,
    alignItems: 'flex-start',
  },
  lockNoticeText: {
    flex: 1,
    color: theme.colors.onSurface,
    fontSize: 12,
    lineHeight: 18,
  },
  eventRowStatic: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  eventTeamStatic: {
    flex: 1,
    color: theme.colors.onSurface,
    fontSize: 14,
    fontWeight: '700',
    paddingVertical: 8,
  },
  predRowStatic: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: 4,
  },
  oddRowStatic: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  oddValue: {
    color: theme.colors.onSurface,
    fontSize: 18,
    fontWeight: '800',
  },
  badTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.error + '22',
  },
  badTagText: {
    color: theme.colors.error,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  retakeBox: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'flex-start',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.error + '15',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.error + '55',
    marginTop: theme.spacing.md,
  },
  retakeText: {
    flex: 1,
    color: theme.colors.onSurface,
    fontSize: 12,
    lineHeight: 18,
  },
  retakeCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    height: 44,
    marginTop: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSecondary,
  },
  retakeCtaText: {
    color: theme.colors.onSurface,
    fontWeight: '800',
    fontSize: 14,
  },
  behalfBanner: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'flex-start',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.brand + '15',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.brand + '55',
    marginBottom: theme.spacing.md,
  },
  behalfTitle: {
    color: theme.colors.onSurface,
    fontWeight: '800',
    fontSize: 14,
  },
  behalfSub: {
    color: theme.colors.muted,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
});
