import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

type UserRow = { id: string; email: string; username: string; created_at?: string };

export default function AdminUsers() {
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<UserRow | null>(null);
  const [newPass, setNewPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async (search = q) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (search.trim()) params.set('q', search.trim());
      const r = await api<{ items: UserRow[]; total: number }>(
        `/admin/users?${params.toString()}`
      );
      setUsers(r.items);
      setTotal(r.total);
    } catch (e: any) {
      setMsg(e.message);
      setTimeout(() => setMsg(null), 3000);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitReset = async () => {
    if (!target) return;
    if (newPass.length < 6) {
      setMsg('Password minimo 6 caratteri');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api('/admin/users/reset-password', {
        method: 'POST',
        body: { email: target.email, new_password: newPass },
      });
      setMsg(`Password aggiornata per ${target.username}. Password: ${newPass}`);
      setTarget(null);
      setNewPass('');
      setTimeout(() => setMsg(null), 8000);
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
          <Pressable onPress={() => router.back()} hitSlop={12} testID="admin-users-back">
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Reset password utenti</Text>
            <Text style={styles.subtitle}>{total} utenti registrati</Text>
          </View>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={theme.colors.muted} />
          <TextInput
            testID="admin-users-search"
            placeholder="Cerca per email o username..."
            placeholderTextColor={theme.colors.muted}
            value={q}
            onChangeText={(t) => { setQ(t); load(t); }}
            style={styles.searchInput}
            autoCapitalize="none"
          />
        </View>
      </SafeAreaView>

      {msg && (
        <View style={styles.msgBox} testID="admin-users-msg">
          <Text style={styles.msgText}>{msg}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.brand} />
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 100 }}
          ItemSeparatorComponent={() => <View style={{ height: theme.spacing.sm }} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={{ color: theme.colors.muted }}>Nessun utente</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.userRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {item.username.slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>{item.username}</Text>
                <Text style={styles.userEmail}>{item.email}</Text>
              </View>
              <Pressable
                testID={`reset-${item.id}`}
                onPress={() => {
                  setTarget(item);
                  setNewPass('');
                }}
                style={styles.resetBtn}
              >
                <Ionicons name="key" size={14} color={theme.colors.onBrandSecondary} />
                <Text style={styles.resetBtnText}>Reset</Text>
              </Pressable>
            </View>
          )}
        />
      )}

      <Modal
        visible={target !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setTarget(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalWrap}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setTarget(null)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Reset password</Text>
            {target && (
              <>
                <Text style={styles.sheetUser}>{target.username}</Text>
                <Text style={styles.sheetEmail}>{target.email}</Text>
              </>
            )}
            <View style={styles.field}>
              <Ionicons name="lock-closed-outline" size={18} color={theme.colors.muted} />
              <TextInput
                testID="admin-reset-newpass"
                placeholder="Nuova password (min 6)"
                placeholderTextColor={theme.colors.muted}
                value={newPass}
                onChangeText={setNewPass}
                secureTextEntry
                autoCapitalize="none"
                style={styles.fieldInput}
                autoFocus
              />
            </View>
            <Text style={styles.hint}>
              Comunica la nuova password all&apos;utente. Non ricevera notifiche automatiche.
            </Text>
            <Pressable
              testID="admin-reset-submit"
              onPress={submitReset}
              disabled={busy}
              style={[styles.cta, busy && { opacity: 0.5 }]}
            >
              {busy ? (
                <ActivityIndicator color={theme.colors.onBrand} />
              ) : (
                <Text style={styles.ctaText}>Aggiorna password</Text>
              )}
            </Pressable>
            <Pressable onPress={() => setTarget(null)} style={styles.cancel}>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  title: { color: theme.colors.onSurface, fontSize: 22, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.onSurface,
    paddingVertical: 12,
    fontSize: 15,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: theme.colors.brand, fontWeight: '800', fontSize: 12 },
  userName: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 15 },
  userEmail: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.colors.brandSecondary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
  },
  resetBtnText: {
    color: theme.colors.onBrandSecondary,
    fontWeight: '800',
    fontSize: 12,
  },
  msgBox: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.sm,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.brandTertiary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.brand,
  },
  msgText: { color: theme.colors.brand, fontSize: 13, fontWeight: '600' },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.sm,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: theme.colors.borderStrong,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: theme.spacing.md,
  },
  sheetTitle: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 20 },
  sheetUser: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 16 },
  sheetEmail: { color: theme.colors.muted, fontSize: 12, marginBottom: theme.spacing.sm },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceTertiary,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginTop: theme.spacing.sm,
  },
  fieldInput: {
    flex: 1,
    color: theme.colors.onSurface,
    paddingVertical: 14,
    fontSize: 15,
  },
  hint: { color: theme.colors.muted, fontSize: 11 },
  cta: {
    marginTop: theme.spacing.md,
    height: 52,
    backgroundColor: theme.colors.brand,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 16 },
  cancel: { alignItems: 'center', paddingVertical: theme.spacing.sm },
  cancelText: { color: theme.colors.muted, fontWeight: '600' },
});
