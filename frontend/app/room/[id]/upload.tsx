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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

type Event = {
  home_team: string;
  away_team: string;
  prediction: string;
  odd: number;
};

const PREDICTIONS = ['1', 'X', '2', '1X', 'X2', '12', 'GOL', 'NOGOL', 'OVER', 'UNDER'];

export default function UploadSchedina() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [preview, setPreview] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [maxEvents, setMaxEvents] = useState(7);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [step, setStep] = useState<'pick' | 'confirm'>('pick');

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
      const res = await api<{ events: Event[]; max_events: number }>(
        `/rooms/${id}/schedina/ocr`,
        { method: 'POST', body: { image_base64: b64 } }
      );
      setMaxEvents(res.max_events);
      if (res.events.length === 0) {
        setEvents([{ home_team: '', away_team: '', prediction: '1', odd: 0 }]);
        setMsg('OCR non ha trovato eventi. Inseriscili manualmente.');
      } else {
        setEvents(res.events);
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

  const submit = async () => {
    if (events.length === 0) return setMsg('Aggiungi almeno un pronostico');
    for (const e of events) {
      if (!e.home_team || !e.away_team || !e.odd) {
        return setMsg('Compila tutti i campi (squadre + quota)');
      }
    }
    setBusy(true);
    setMsg(null);
    try {
      await api(`/rooms/${id}/schedina/confirm`, {
        method: 'POST',
        body: {
          events: events.map((e) => ({
            home_team: e.home_team,
            away_team: e.away_team,
            prediction: e.prediction,
            odd: Number(e.odd),
          })),
        },
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
                  <Text style={styles.previewChangeText}>Cambia</Text>
                </Pressable>
              </View>
            )}
            <Text style={styles.hint}>
              Verifica ogni evento. Modifica squadre, pronostico e quota se l&apos;OCR ha sbagliato.
              Max {maxEvents} pronostici.
            </Text>

            {events.map((e, i) => (
              <View key={i} style={styles.eventCard}>
                <View style={styles.eventHead}>
                  <Text style={styles.eventNum}>#{i + 1}</Text>
                  <Pressable onPress={() => removeEvent(i)} hitSlop={10} testID={`remove-event-${i}`}>
                    <Ionicons name="trash" size={16} color={theme.colors.error} />
                  </Pressable>
                </View>
                <View style={styles.eventRow}>
                  <TextInput
                    testID={`home-${i}`}
                    placeholder="Casa"
                    placeholderTextColor={theme.colors.muted}
                    value={e.home_team}
                    onChangeText={(t) => updateEvent(i, { home_team: t })}
                    style={styles.eventInput}
                  />
                  <Text style={styles.vs}>vs</Text>
                  <TextInput
                    testID={`away-${i}`}
                    placeholder="Trasferta"
                    placeholderTextColor={theme.colors.muted}
                    value={e.away_team}
                    onChangeText={(t) => updateEvent(i, { away_team: t })}
                    style={styles.eventInput}
                  />
                </View>
                <View style={styles.predRow}>
                  {PREDICTIONS.map((p) => (
                    <Pressable
                      key={p}
                      testID={`pred-${i}-${p}`}
                      onPress={() => updateEvent(i, { prediction: p })}
                      style={[styles.predChip, e.prediction === p && styles.predChipActive]}
                    >
                      <Text
                        style={[styles.predChipText, e.prediction === p && styles.predChipTextActive]}
                      >
                        {p}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.oddRow}>
                  <Text style={styles.oddLabel}>Quota</Text>
                  <TextInput
                    testID={`odd-${i}`}
                    keyboardType="decimal-pad"
                    placeholder="1.85"
                    placeholderTextColor={theme.colors.muted}
                    value={String(e.odd || '')}
                    onChangeText={(t) => {
                      const n = parseFloat(t.replace(',', '.'));
                      updateEvent(i, { odd: isNaN(n) ? 0 : n });
                    }}
                    style={styles.oddInput}
                  />
                </View>
              </View>
            ))}

            <Pressable onPress={addEvent} style={styles.addBtn} testID="add-event">
              <Ionicons name="add-circle" size={20} color={theme.colors.brand} />
              <Text style={styles.addBtnText}>Aggiungi pronostico ({events.length}/{maxEvents})</Text>
            </Pressable>

            {msg && <Text style={[styles.err, { marginTop: theme.spacing.md }]}>{msg}</Text>}

            <Pressable
              testID="confirm-schedina-btn"
              onPress={submit}
              disabled={busy}
              style={[styles.cta, busy && { opacity: 0.6 }]}
            >
              {busy ? (
                <ActivityIndicator color={theme.colors.onBrand} />
              ) : (
                <Text style={styles.ctaText}>Conferma schedina</Text>
              )}
            </Pressable>
          </>
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
  predChip: {
    paddingHorizontal: 12,
    height: 34,
    justifyContent: 'center',
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  predChipActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  predChipText: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 12 },
  predChipTextActive: { color: theme.colors.onBrand, fontWeight: '800' },
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
});
