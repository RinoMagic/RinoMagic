/*
 * /admin/admins — Manage admin accounts.
 *
 * Any admin can:
 *  - Create a new admin (email + temporary password). The new admin must
 *    change the password at first login (via `must_change_password`).
 *  - See the list of existing admins.
 *  - Delete any admin (except themselves, and provided at least one admin
 *    remains).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  TextInput, Modal, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session } from '@/src/api';
import { theme } from '@/src/theme';

const COLOR = '#EC4899';

type AdminRow = {
  id: string;
  role: 'admin' | 'player';
  email?: string;
  username?: string;
  blocked?: boolean;
  must_change_password?: boolean;
  created_at?: string;
};

export default function AdminAdmins() {
  const router = useRouter();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await session.load();
      setMeId(s.user?.id ?? null);
      const users = await api<AdminRow[]>('/auth/users');
      const admins = (users || []).filter((u) => u.role === 'admin');
      admins.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
      setRows(admins);
    } catch (e: any) {
      setFlash({ type: 'err', text: e.message || 'Errore caricamento' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetCreateForm = () => {
    setEmail('');
    setPassword('');
    setPassword2('');
  };

  const openCreate = () => {
    resetCreateForm();
    setCreateOpen(true);
  };

  const closeCreate = () => {
    setCreateOpen(false);
    resetCreateForm();
  };

  const submitCreate = async () => {
    setFlash(null);
    const em = email.trim().toLowerCase();
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setFlash({ type: 'err', text: "Email non valida" });
      return;
    }
    if (password.length < 8) {
      setFlash({ type: 'err', text: 'Password: minimo 8 caratteri' });
      return;
    }
    if (password !== password2) {
      setFlash({ type: 'err', text: 'Le password non corrispondono' });
      return;
    }
    setSubmitting(true);
    try {
      await api('/auth/admin/promote', {
        method: 'POST',
        body: { email: em, temp_password: password },
      });
      setFlash({ type: 'ok', text: `Admin ${em} creato. Al primo accesso dovrà cambiare la password.` });
      closeCreate();
      await load();
    } catch (e: any) {
      setFlash({ type: 'err', text: e.message || 'Errore creazione admin' });
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = (row: AdminRow) => {
    if (row.id === meId) return;
    Alert.alert(
      'Elimina admin',
      `Sei sicuro di voler eliminare l'admin ${row.email}?\n\nQuesta azione è irreversibile.`,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Elimina',
          style: 'destructive',
          onPress: () => doDelete(row.id),
        },
      ],
    );
  };

  const doDelete = async (id: string) => {
    setDeletingId(id);
    setFlash(null);
    try {
      await api(`/auth/users/${id}`, { method: 'DELETE' });
      setFlash({ type: 'ok', text: 'Admin eliminato' });
      await load();
    } catch (e: any) {
      setFlash({ type: 'err', text: e.message || 'Errore eliminazione' });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="admins-back">
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Gestione Admin</Text>
            <Text style={styles.subtitle}>Crea e gestisci amministratori</Text>
          </View>
          <Ionicons name="shield-checkmark" size={22} color={COLOR} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.scroll}>
        {flash && (
          <View style={[styles.flash, flash.type === 'ok' ? styles.flashOk : styles.flashErr]}>
            <Ionicons
              name={flash.type === 'ok' ? 'checkmark-circle' : 'alert-circle'}
              size={16}
              color={flash.type === 'ok' ? theme.colors.success : theme.colors.error}
            />
            <Text
              style={[
                styles.flashText,
                { color: flash.type === 'ok' ? theme.colors.success : theme.colors.error },
              ]}
            >
              {flash.text}
            </Text>
          </View>
        )}

        <Pressable
          style={[styles.cta, { backgroundColor: COLOR }]}
          onPress={openCreate}
          testID="admins-create"
        >
          <Ionicons name="add-circle" size={18} color="#fff" />
          <Text style={styles.ctaText}>Crea nuovo admin</Text>
        </Pressable>

        {loading && <ActivityIndicator color={COLOR} />}

        <Text style={styles.sectionLabel}>ADMIN ATTUALI · {rows.length}</Text>
        {rows.map((r) => {
          const isSelf = r.id === meId;
          const isDeleting = deletingId === r.id;
          return (
            <View key={r.id} style={styles.row}>
              <View style={[styles.avatar, { backgroundColor: isSelf ? theme.colors.brand : COLOR }]}>
                <Ionicons name="person" size={18} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowEmail} numberOfLines={1}>
                  {r.email || r.username || '—'}
                </Text>
                <View style={styles.rowMeta}>
                  {isSelf && (
                    <View style={[styles.pill, { backgroundColor: theme.colors.brand + '33' }]}>
                      <Text style={[styles.pillText, { color: theme.colors.brand }]}>TU</Text>
                    </View>
                  )}
                  {r.must_change_password && (
                    <View style={[styles.pill, { backgroundColor: theme.colors.warning + '33' }]}>
                      <Text style={[styles.pillText, { color: theme.colors.warning }]}>
                        Cambio pwd pendente
                      </Text>
                    </View>
                  )}
                  {r.blocked && (
                    <View style={[styles.pill, { backgroundColor: theme.colors.error + '33' }]}>
                      <Text style={[styles.pillText, { color: theme.colors.error }]}>Bloccato</Text>
                    </View>
                  )}
                </View>
              </View>
              {!isSelf && (
                <Pressable
                  onPress={() => confirmDelete(r)}
                  hitSlop={10}
                  style={styles.deleteBtn}
                  disabled={isDeleting}
                  testID={`admins-delete-${r.id}`}
                >
                  {isDeleting ? (
                    <ActivityIndicator size="small" color={theme.colors.error} />
                  ) : (
                    <Ionicons name="trash-outline" size={18} color={theme.colors.error} />
                  )}
                </Pressable>
              )}
            </View>
          );
        })}

        {!loading && rows.length === 0 && (
          <Text style={styles.emptyText}>Nessun admin trovato.</Text>
        )}
      </ScrollView>

      {/* Create modal */}
      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={closeCreate}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Nuovo admin</Text>
              <Pressable onPress={closeCreate} hitSlop={10} testID="admins-modal-close">
                <Ionicons name="close" size={22} color={theme.colors.onSurface} />
              </Pressable>
            </View>
            <Text style={styles.modalHint}>
              Al primo accesso l&apos;admin dovrà cambiare la password temporanea.
            </Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="admin@esempio.com"
                placeholderTextColor={theme.colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                testID="admins-email-input"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Password temporanea (min. 8)</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={theme.colors.muted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                testID="admins-password-input"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Ripeti password</Text>
              <TextInput
                style={styles.input}
                value={password2}
                onChangeText={setPassword2}
                placeholder="••••••••"
                placeholderTextColor={theme.colors.muted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                testID="admins-password2-input"
              />
            </View>

            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnSecondary]}
                onPress={closeCreate}
                disabled={submitting}
                testID="admins-cancel"
              >
                <Text style={styles.modalBtnSecondaryText}>Annulla</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: COLOR }, submitting && { opacity: 0.5 }]}
                onPress={submitCreate}
                disabled={submitting}
                testID="admins-submit"
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>Crea admin</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    gap: theme.spacing.md, padding: theme.spacing.lg,
  },
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  scroll: { padding: theme.spacing.lg, paddingBottom: 120, gap: theme.spacing.md },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: theme.spacing.sm, height: 44, borderRadius: theme.radius.md,
  },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  sectionLabel: {
    color: theme.colors.muted,
    fontSize: 11, fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: theme.spacing.sm,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  rowEmail: { color: theme.colors.onSurface, fontSize: 14, fontWeight: '700' },
  rowMeta: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  pill: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: theme.radius.pill,
  },
  pillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  deleteBtn: {
    width: 36, height: 36, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.error + '18',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: theme.colors.error + '55',
  },
  emptyText: {
    color: theme.colors.muted, fontSize: 13, textAlign: 'center',
    marginTop: theme.spacing.lg,
  },
  flash: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
  },
  flashOk: { backgroundColor: theme.colors.success + '22' },
  flashErr: { backgroundColor: theme.colors.error + '22' },
  flashText: { flex: 1, fontSize: 12, fontWeight: '700' },
  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.lg + 20,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  modalTitle: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  modalHint: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
  fieldGroup: { gap: 6 },
  fieldLabel: { color: theme.colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  input: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
    color: theme.colors.onSurface,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14,
  },
  modalActions: {
    flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm,
  },
  modalBtn: {
    flex: 1, height: 44, borderRadius: theme.radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  modalBtnSecondary: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  modalBtnSecondaryText: { color: theme.colors.onSurface, fontWeight: '700' },
  modalBtnPrimaryText: { color: '#fff', fontWeight: '800' },
});
