import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session, User } from '@/src/api';
import { theme } from '@/src/theme';

export default function Settings() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const s = await session.load();
      if (!s.user) {
        router.replace('/');
        return;
      }
      setMe(s.user);
    })();
  }, [router]);

  const submit = async () => {
    setMsg(null);
    if (!oldPw) return setMsg({ type: 'err', text: 'Inserisci la password attuale' });
    if (newPw.length < 8) {
      return setMsg({ type: 'err', text: 'La nuova password deve avere almeno 8 caratteri' });
    }
    if (newPw !== confirmPw) {
      return setMsg({ type: 'err', text: 'Le due nuove password non coincidono' });
    }
    if (newPw === oldPw) {
      return setMsg({ type: 'err', text: 'La nuova password deve essere diversa da quella attuale' });
    }
    setBusy(true);
    try {
      await api('/auth/admin/change-password', {
        method: 'POST',
        body: { old_password: oldPw, new_password: newPw },
      });
      setMsg({ type: 'ok', text: 'Password aggiornata con successo!' });
      setOldPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (e: any) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  if (!me) return null;

  const isAdmin = me.role === 'admin';

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="settings-back">
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>Impostazioni</Text>
          <View style={{ width: 26 }} />
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: 120 }}
      >
        {/* Account info */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>ACCOUNT</Text>
          <View style={styles.rowItem}>
            <Ionicons
              name={isAdmin ? 'shield-checkmark' : 'person'}
              size={20}
              color={isAdmin ? theme.colors.brand : theme.colors.accent}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowText}>{me.email || me.username}</Text>
              <Text style={styles.rowSub}>{isAdmin ? 'Amministratore' : 'Giocatore'}</Text>
            </View>
          </View>
        </View>

        {/* Admin tools */}
        {isAdmin && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>STRUMENTI ADMIN</Text>
            <Pressable
              testID="settings-admin-settle"
              onPress={() => router.push('/admin/settle-matchday')}
              style={styles.adminRow}
            >
              <View style={[styles.adminIcon, { backgroundColor: '#10B981' }]}>
                <Ionicons name="calculator" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowText}>Calcola Giornata</Text>
                <Text style={styles.rowSub}>Carica PDF voti e liquida tutti i giochi in un solo passaggio</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
            </Pressable>
            <Pressable
              testID="settings-admin-players"
              onPress={() => router.push('/admin/players')}
              style={styles.adminRow}
            >
              <View style={[styles.adminIcon, { backgroundColor: '#8B5CF6' }]}>
                <Ionicons name="people" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowText}>Lista Calciatori</Text>
                <Text style={styles.rowSub}>Carica il Listone Fantacalcio (PDF) — richiesto per picks e settlement</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
            </Pressable>
            <Pressable
              testID="settings-admin-bonus"
              onPress={() => router.push('/admin/bonus')}
              style={styles.adminRow}
            >
              <View style={[styles.adminIcon, { backgroundColor: '#F59E0B' }]}>
                <Ionicons name="gift" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowText}>Gestione Giochi Bonus</Text>
                <Text style={styles.rowSub}>Configura Big Match, primo marcatore e liquida i premi</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
            </Pressable>
          </View>
        )}

        {/* Change password (admin only) */}
        {isAdmin ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>CAMBIA PASSWORD</Text>

            <PasswordField
              testID="old-pw"
              label="Password attuale"
              value={oldPw}
              onChange={setOldPw}
              show={showOld}
              onToggle={() => setShowOld((s) => !s)}
              autoComplete="current-password"
            />

            <PasswordField
              testID="new-pw"
              label="Nuova password (min 8 caratteri)"
              value={newPw}
              onChange={setNewPw}
              show={showNew}
              onToggle={() => setShowNew((s) => !s)}
              autoComplete="new-password"
            />

            <PasswordField
              testID="confirm-pw"
              label="Conferma nuova password"
              value={confirmPw}
              onChange={setConfirmPw}
              show={showNew}
              onToggle={() => setShowNew((s) => !s)}
              autoComplete="new-password"
            />

            {msg && (
              <View
                style={[
                  styles.msg,
                  msg.type === 'ok' ? styles.msgOk : styles.msgErr,
                ]}
              >
                <Ionicons
                  name={msg.type === 'ok' ? 'checkmark-circle' : 'alert-circle'}
                  size={16}
                  color={msg.type === 'ok' ? theme.colors.success : theme.colors.error}
                />
                <Text
                  style={[
                    styles.msgText,
                    { color: msg.type === 'ok' ? theme.colors.success : theme.colors.error },
                  ]}
                >
                  {msg.text}
                </Text>
              </View>
            )}

            <Pressable
              testID="save-password"
              onPress={submit}
              disabled={busy}
              style={[styles.cta, busy && { opacity: 0.5 }]}
            >
              {busy ? (
                <ActivityIndicator color={theme.colors.onBrand} />
              ) : (
                <>
                  <Ionicons name="lock-closed" size={18} color={theme.colors.onBrand} />
                  <Text style={styles.ctaText}>Aggiorna password</Text>
                </>
              )}
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>PASSWORD</Text>
            <Text style={styles.helpText}>
              Per cambiare la tua password contatta l&apos;admin della tua stanza. Sarà lui a
              impostare una nuova password temporanea.
            </Text>
          </View>
        )}

        {/* Sign out */}
        <Pressable
          testID="settings-logout"
          onPress={async () => {
            await session.clear();
            router.replace('/');
          }}
          style={styles.logoutBtn}
        >
          <Ionicons name="log-out-outline" size={18} color={theme.colors.error} />
          <Text style={styles.logoutText}>Esci</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function PasswordField({
  testID,
  label,
  value,
  onChange,
  show,
  onToggle,
  autoComplete,
}: {
  testID?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  autoComplete?: 'current-password' | 'new-password';
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChange}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={autoComplete}
          textContentType={autoComplete === 'new-password' ? 'newPassword' : 'password'}
          style={styles.input}
          placeholder="••••••••"
          placeholderTextColor={theme.colors.muted}
        />
        <Pressable onPress={onToggle} hitSlop={8} style={styles.eyeBtn}>
          <Ionicons name={show ? 'eye-off' : 'eye'} size={18} color={theme.colors.muted} />
        </Pressable>
      </View>
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
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardLabel: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  rowText: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 15 },
  rowSub: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  adminRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
  },
  adminIcon: {
    width: 40, height: 40, borderRadius: theme.radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  fieldWrap: { gap: 6 },
  fieldLabel: {
    color: theme.colors.onSurfaceSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceTertiary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  input: {
    flex: 1,
    color: theme.colors.onSurface,
    fontSize: 16,
    paddingVertical: 14,
    paddingHorizontal: theme.spacing.md,
  },
  eyeBtn: { padding: theme.spacing.md },
  msg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.sm,
  },
  msgOk: { backgroundColor: theme.colors.success + '22' },
  msgErr: { backgroundColor: theme.colors.error + '22' },
  msgText: { fontSize: 12, fontWeight: '700', flex: 1 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    height: 48,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.brand,
  },
  ctaText: {
    color: theme.colors.onBrand,
    fontWeight: '800',
    fontSize: 15,
  },
  helpText: {
    color: theme.colors.onSurfaceSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    height: 48,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.error + '55',
    backgroundColor: theme.colors.error + '15',
  },
  logoutText: {
    color: theme.colors.error,
    fontWeight: '800',
    fontSize: 15,
  },
});
