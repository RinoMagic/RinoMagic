import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

type League = {
  id: string;
  name: string;
  code: string;
  members_count: number;
  is_owner: boolean;
  current_matchday: number;
};

type Mode = null | 'create' | 'join';

export default function Leagues() {
  const router = useRouter();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState<Mode>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await api<League[]>('/leagues');
      setLeagues(data);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const closeModal = () => {
    setModal(null);
    setName('');
    setCode('');
    setErr(null);
  };

  const submitCreate = async () => {
    setErr(null);
    if (name.trim().length < 2) return setErr('Nome troppo corto');
    setBusy(true);
    try {
      const lg = await api<League>('/leagues', { method: 'POST', body: { name: name.trim() } });
      closeModal();
      router.push(`/league/${lg.id}`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submitJoin = async () => {
    setErr(null);
    if (code.trim().length < 4) return setErr('Codice non valido');
    setBusy(true);
    try {
      const lg = await api<League>('/leagues/join', {
        method: 'POST',
        body: { code: code.trim().toUpperCase() },
      });
      closeModal();
      router.push(`/league/${lg.id}`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.title}>Le mie leghe</Text>
        </View>
      </SafeAreaView>

      <View style={styles.actionRow}>
        <Pressable
          testID="create-league-button"
          style={[styles.actionBtn, { backgroundColor: theme.colors.brand }]}
          onPress={() => setModal('create')}
        >
          <Ionicons name="add-circle" size={18} color={theme.colors.onBrand} />
          <Text style={[styles.actionBtnText, { color: theme.colors.onBrand }]}>Crea Lega</Text>
        </Pressable>
        <Pressable
          testID="join-league-button"
          style={[styles.actionBtn, { backgroundColor: theme.colors.surfaceSecondary, borderWidth: 1, borderColor: theme.colors.border }]}
          onPress={() => setModal('join')}
        >
          <Ionicons name="enter" size={18} color={theme.colors.brand} />
          <Text style={[styles.actionBtnText, { color: theme.colors.onSurface }]}>Entra con codice</Text>
        </Pressable>
      </View>

      <FlatList
        data={leagues}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120 }}
        refreshing={refreshing}
        onRefresh={load}
        ListEmptyComponent={
          <View style={styles.empty} testID="leagues-empty">
            <Ionicons name="trophy-outline" size={48} color={theme.colors.muted} />
            <Text style={styles.emptyTitle}>Nessuna lega ancora</Text>
            <Text style={styles.emptyText}>
              Crea una lega e invita gli amici con un codice
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            testID={`league-item-${item.id}`}
            style={styles.card}
            onPress={() => router.push(`/league/${item.id}`)}
          >
            <View style={styles.cardHead}>
              <View style={styles.cardIcon}>
                <Ionicons name="shield" size={20} color={theme.colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{item.name}</Text>
                <Text style={styles.cardMeta}>
                  {item.members_count} membri · Giornata {item.current_matchday}
                </Text>
              </View>
              {item.is_owner && (
                <View style={styles.adminBadge}>
                  <Text style={styles.adminBadgeText}>ADMIN</Text>
                </View>
              )}
            </View>
            <View style={styles.codeRow}>
              <Text style={styles.codeLabel}>Codice invito</Text>
              <Text style={styles.codeValue}>{item.code}</Text>
            </View>
          </Pressable>
        )}
      />

      <Modal
        visible={modal !== null}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalWrap}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={closeModal} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>
              {modal === 'create' ? 'Nuova Lega' : 'Entra in una lega'}
            </Text>

            {modal === 'create' ? (
              <TextInput
                testID="league-name-input"
                placeholder="Nome della lega"
                placeholderTextColor={theme.colors.muted}
                value={name}
                onChangeText={setName}
                style={styles.input}
                autoFocus
              />
            ) : (
              <TextInput
                testID="league-code-input"
                placeholder="Codice invito (es. ABC123)"
                placeholderTextColor={theme.colors.muted}
                value={code}
                onChangeText={(t) => setCode(t.toUpperCase())}
                style={styles.input}
                autoCapitalize="characters"
                autoFocus
              />
            )}

            {err && <Text style={styles.err}>{err}</Text>}

            <Pressable
              testID="modal-submit"
              onPress={modal === 'create' ? submitCreate : submitJoin}
              disabled={busy}
              style={[styles.cta, busy && { opacity: 0.6 }]}
            >
              {busy ? (
                <ActivityIndicator color={theme.colors.onBrand} />
              ) : (
                <Text style={styles.ctaText}>
                  {modal === 'create' ? 'Crea Lega' : 'Entra'}
                </Text>
              )}
            </Pressable>
            <Pressable onPress={closeModal} style={styles.cancel}>
              <Text style={styles.cancelText}>Annulla</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  header: { padding: theme.spacing.lg },
  title: { color: theme.colors.onSurface, fontSize: 26, fontWeight: '800' },
  actionRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.md,
  },
  actionBtnText: { fontWeight: '800', fontSize: 14 },
  empty: { alignItems: 'center', padding: theme.spacing.xxl, gap: 8 },
  emptyTitle: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 18, marginTop: 8 },
  emptyText: { color: theme.colors.muted, textAlign: 'center' },
  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardName: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 16 },
  cardMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  adminBadge: {
    backgroundColor: theme.colors.brandSecondary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.radius.sm,
  },
  adminBadgeText: {
    color: theme.colors.onBrandSecondary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
  },
  codeLabel: { color: theme.colors.muted, fontSize: 12 },
  codeValue: {
    color: theme.colors.brand,
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 2,
  },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.md,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: theme.colors.borderStrong,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: theme.spacing.sm,
  },
  sheetTitle: { color: theme.colors.onSurface, fontSize: 20, fontWeight: '800' },
  input: {
    backgroundColor: theme.colors.surfaceTertiary,
    color: theme.colors.onSurface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: 16,
  },
  err: { color: theme.colors.error, fontSize: 13 },
  cta: {
    backgroundColor: theme.colors.brand,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    height: 52,
    justifyContent: 'center',
  },
  ctaText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 16 },
  cancel: { alignItems: 'center', paddingVertical: theme.spacing.sm },
  cancelText: { color: theme.colors.muted, fontWeight: '600' },
});
