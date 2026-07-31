import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session } from '@/src/api';
import { theme } from '@/src/theme';

const COLORS = ['#F59E0B', '#00D95F', '#EF4444', '#3B82F6', '#A855F7', '#EC4899', '#14B8A6', '#F97316'];

export default function CreateRoom() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [matchday, setMatchday] = useState('1');
  const [maxEvents, setMaxEvents] = useState(5);
  const [nickname, setNickname] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (name.trim().length < 2) return setErr('Nome stanza troppo corto');
    const md = parseInt(matchday, 10);
    if (isNaN(md) || md < 1 || md > 38) return setErr('Giornata non valida (1-38)');
    if (nickname.trim().length < 2) return setErr('Nickname minimo 2 caratteri');
    setBusy(true);
    try {
      const res = await api<{ token: string; room: any }>(
        '/rooms',
        {
          method: 'POST',
          auth: false,
          body: {
            name: name.trim(),
            matchday: md,
            max_events: maxEvents,
            color,
            admin_nickname: nickname.trim(),
          },
        }
      );
      await session.save(res.token, res.room.id, nickname.trim());
      router.replace(`/room/${res.room.id}`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="create-back">
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>Nuova stanza</Text>
          <View style={{ width: 26 }} />
        </View>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.card}>
              <Label>Nome stanza</Label>
              <View style={styles.field}>
                <TextInput
                  testID="room-name-input"
                  placeholder="es. Ciao ragazzi G25"
                  placeholderTextColor={theme.colors.muted}
                  value={name}
                  onChangeText={setName}
                  style={styles.input}
                />
              </View>

              <Label>Giornata Serie A</Label>
              <View style={styles.field}>
                <TextInput
                  testID="matchday-input"
                  placeholder="1-38"
                  placeholderTextColor={theme.colors.muted}
                  value={matchday}
                  onChangeText={(t) => setMatchday(t.replace(/[^\d]/g, '').slice(0, 2))}
                  keyboardType="number-pad"
                  style={styles.input}
                />
              </View>

              <Label>Numero pronostici per schedina</Label>
              <View style={styles.chipsRow}>
                {[3, 4, 5, 6, 7, 8].map((n) => {
                  const active = maxEvents === n;
                  return (
                    <Pressable
                      key={n}
                      testID={`max-events-${n}`}
                      onPress={() => setMaxEvents(n)}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{n}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Label>Colore stanza</Label>
              <View style={styles.chipsRow}>
                {COLORS.map((c) => (
                  <Pressable
                    key={c}
                    testID={`color-${c}`}
                    onPress={() => setColor(c)}
                    style={[
                      styles.colorSwatch,
                      { backgroundColor: c },
                      color === c && styles.colorSwatchActive,
                    ]}
                  >
                    {color === c && <Ionicons name="checkmark" size={16} color="#000" />}
                  </Pressable>
                ))}
              </View>

              <Label>Il tuo nickname (admin)</Label>
              <View style={styles.field}>
                <Ionicons name="person" size={18} color={theme.colors.muted} />
                <TextInput
                  testID="admin-nickname-input"
                  placeholder="Come vuoi essere chiamato?"
                  placeholderTextColor={theme.colors.muted}
                  value={nickname}
                  onChangeText={setNickname}
                  autoCorrect={false}
                  style={styles.input}
                />
              </View>

              {err && <Text testID="create-error" style={styles.err}>{err}</Text>}

              <Pressable
                testID="create-submit"
                onPress={submit}
                disabled={busy}
                style={[styles.cta, busy && { opacity: 0.6 }]}
              >
                {busy ? (
                  <ActivityIndicator color={theme.colors.onBrand} />
                ) : (
                  <Text style={styles.ctaText}>Crea stanza</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing.lg,
  },
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  scroll: { padding: theme.spacing.lg },
  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.md,
  },
  label: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: theme.spacing.sm,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceTertiary,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  input: { flex: 1, color: theme.colors.onSurface, paddingVertical: 14, fontSize: 15 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  chip: {
    minWidth: 44,
    height: 44,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  chipText: { color: theme.colors.onSurface, fontWeight: '800' },
  chipTextActive: { color: theme.colors.onBrand },
  colorSwatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorSwatchActive: { borderColor: theme.colors.onSurface },
  cta: {
    backgroundColor: theme.colors.brand,
    height: 52,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing.md,
  },
  ctaText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 16 },
  err: { color: theme.colors.error, fontSize: 13 },
});
