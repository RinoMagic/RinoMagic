import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, ScrollView,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session } from '@/src/api';
import { theme } from '@/src/theme';
import {
  pushSupport, pushPermission, subscribeToPush, unsubscribeFromPush,
  sendTestPush, isStandalone, isIOS,
} from '@/src/push';

export default function AdminNotifications() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [stats, setStats] = useState<{ subscriptions_total: number; distinct_users: number } | null>(null);
  const [myPermission, setMyPermission] = useState<string>('unsupported');
  const [supportState, setSupportState] = useState<string>('unsupported');

  const loadStats = useCallback(async () => {
    try {
      const s = await api<{ subscriptions_total: number; distinct_users: number }>(
        '/push/stats',
      );
      setStats(s);
    } catch (e: any) {
      setMsg(e?.message || 'Errore caricamento stats');
    }
  }, []);

  useEffect(() => {
    (async () => {
      const s = await session.load();
      if (!s.token || s.user?.role !== 'admin') {
        router.replace('/');
        return;
      }
      setMyPermission(pushPermission());
      setSupportState(pushSupport());
      await loadStats();
      setChecking(false);
    })();
  }, [loadStats, router]);

  const send = async () => {
    if (!title.trim() || !body.trim()) {
      setMsg('Titolo e testo obbligatori.');
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const res = await api<{ sent: number; failed: number; expired_removed: number; total_targeted: number }>(
        '/push/broadcast',
        {
          method: 'POST',
          body: {
            title: title.trim(),
            body: body.trim(),
            url: url.trim() || undefined,
          },
        },
      );
      setMsg(`✅ Inviata a ${res.sent}/${res.total_targeted} utenti (${res.failed} falliti, ${res.expired_removed} scaduti rimossi).`);
      setTitle(''); setBody(''); setUrl('');
      loadStats();
    } catch (e: any) {
      setMsg('Errore: ' + (e?.message || 'sconosciuto'));
    } finally {
      setBusy(false);
    }
  };

  const enableMyNotifications = async () => {
    setBusy(true); setMsg(null);
    const res = await subscribeToPush();
    if (res.ok) {
      setMsg('Notifiche attivate su questo dispositivo. Ora ricevi le push!');
      setMyPermission('granted');
    } else {
      const map: Record<string, string> = {
        'permission': 'Permesso rifiutato dal browser.',
        'no-support': 'Il browser non supporta le notifiche push.',
        'network': 'Errore di rete durante la sottoscrizione.',
        'sw': 'Errore registrazione Service Worker.',
      };
      setMsg('❌ ' + (map[res.reason] || res.reason));
    }
    setBusy(false);
  };

  const disableMyNotifications = async () => {
    setBusy(true); setMsg(null);
    const ok = await unsubscribeFromPush();
    setMsg(ok ? 'Notifiche disattivate su questo dispositivo.' : 'Errore disattivazione.');
    setMyPermission(pushPermission());
    setBusy(false);
  };

  const testSelf = async () => {
    setBusy(true); setMsg(null);
    const res = await sendTestPush();
    setMsg(res.ok ? '📬 Notifica di test inviata a te stesso!' : '❌ ' + (res.detail || 'errore'));
    setBusy(false);
  };

  if (checking) {
    return <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>;
  }

  const canPushWeb = Platform.OS === 'web';
  const iosNeedsInstall = canPushWeb && supportState === 'ios-needs-install';

  return (
    <SafeAreaView style={styles.wrap} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Notifiche Push</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Stats */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Iscrizioni attive</Text>
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statNum}>{stats?.distinct_users ?? '—'}</Text>
              <Text style={styles.statLabel}>Utenti</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNum}>{stats?.subscriptions_total ?? '—'}</Text>
              <Text style={styles.statLabel}>Dispositivi</Text>
            </View>
          </View>
          <Text style={styles.hint}>
            Ogni utente può iscriversi da più dispositivi (telefono, PC, tablet).
          </Text>
        </View>

        {/* Personal push state */}
        {canPushWeb && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Le tue notifiche</Text>
            <Text style={styles.hint}>Stato: <Text style={{ fontWeight: '700', color: theme.colors.onSurface }}>{myPermission}</Text></Text>
            {iosNeedsInstall && (
              <View style={styles.warn}>
                <Ionicons name="information-circle" size={16} color={theme.colors.warning} />
                <Text style={styles.warnText}>
                  Su iPhone/iPad devi prima installare l&apos;app in Home (icona Condividi → &quot;Aggiungi a Home&quot;) e riaprirla da lì.
                </Text>
              </View>
            )}
            {supportState === 'unsupported' && (
              <Text style={styles.hint}>Il browser non supporta le notifiche push.</Text>
            )}
            <View style={styles.btnRow}>
              {myPermission !== 'granted' ? (
                <Pressable
                  onPress={enableMyNotifications}
                  disabled={busy || supportState !== 'ready'}
                  style={[styles.btn, styles.btnPrimary, (busy || supportState !== 'ready') && styles.btnDisabled]}
                >
                  <Ionicons name="notifications" size={16} color={theme.colors.onBrand} />
                  <Text style={styles.btnPrimaryText}>Attiva</Text>
                </Pressable>
              ) : (
                <>
                  <Pressable
                    onPress={testSelf}
                    disabled={busy}
                    style={[styles.btn, styles.btnSecondary]}
                  >
                    <Ionicons name="paper-plane" size={16} color={theme.colors.onSurface} />
                    <Text style={styles.btnSecondaryText}>Test</Text>
                  </Pressable>
                  <Pressable
                    onPress={disableMyNotifications}
                    disabled={busy}
                    style={[styles.btn, styles.btnSecondary]}
                  >
                    <Ionicons name="notifications-off" size={16} color={theme.colors.onSurface} />
                    <Text style={styles.btnSecondaryText}>Disattiva</Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        )}

        {/* Compose broadcast */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Invia notifica a tutti 📢</Text>
          <TextInput
            style={styles.input}
            placeholder="Titolo (max 100 caratteri)"
            placeholderTextColor={theme.colors.muted}
            value={title}
            onChangeText={setTitle}
            maxLength={100}
          />
          <TextInput
            style={[styles.input, styles.textarea]}
            placeholder="Testo del messaggio (max 300 caratteri)"
            placeholderTextColor={theme.colors.muted}
            value={body}
            onChangeText={setBody}
            multiline
            numberOfLines={4}
            maxLength={300}
          />
          <TextInput
            style={styles.input}
            placeholder="URL destinazione (opzionale, es. /surviva)"
            placeholderTextColor={theme.colors.muted}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            maxLength={500}
          />
          <Text style={styles.hint}>Verrà recapitata a tutti gli utenti che hanno attivato le notifiche.</Text>

          {msg && (
            <View style={styles.msgBox}>
              <Text style={styles.msgText}>{msg}</Text>
            </View>
          )}

          <Pressable
            onPress={() => {
              Alert.alert(
                'Confermi invio?',
                `Titolo: ${title.trim()}\n\nVerrà inviata a ${stats?.distinct_users ?? '?'} utenti.`,
                [
                  { text: 'Annulla', style: 'cancel' },
                  { text: 'Invia', style: 'destructive', onPress: send },
                ],
              );
            }}
            disabled={busy || !title.trim() || !body.trim()}
            style={[styles.btn, styles.btnPrimaryFull, (busy || !title.trim() || !body.trim()) && styles.btnDisabled]}
          >
            {busy ? (
              <ActivityIndicator color={theme.colors.onBrand} />
            ) : (
              <>
                <Ionicons name="send" size={16} color={theme.colors.onBrand} />
                <Text style={styles.btnPrimaryText}>Invia broadcast</Text>
              </>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  scroll: { padding: theme.spacing.md, gap: theme.spacing.md },
  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    padding: theme.spacing.md, borderRadius: theme.radius.lg,
    borderWidth: 1, borderColor: theme.colors.border, gap: theme.spacing.sm,
  },
  cardTitle: { color: theme.colors.onSurface, fontSize: 16, fontWeight: '800' },
  hint: { color: theme.colors.muted, fontSize: 13, lineHeight: 18 },
  statsRow: { flexDirection: 'row', gap: theme.spacing.md, marginTop: 4 },
  statBox: {
    flex: 1, backgroundColor: theme.colors.surfaceTertiary,
    padding: theme.spacing.md, borderRadius: theme.radius.md, alignItems: 'center',
  },
  statNum: { color: theme.colors.brand, fontSize: 26, fontWeight: '900' },
  statLabel: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  input: {
    color: theme.colors.onSurface,
    backgroundColor: theme.colors.surfaceTertiary,
    padding: theme.spacing.md, borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border, fontSize: 14,
  },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  msgBox: {
    padding: theme.spacing.sm, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceTertiary,
  },
  msgText: { color: theme.colors.onSurface, fontSize: 13 },
  warn: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: theme.colors.warning + '20', padding: theme.spacing.sm, borderRadius: theme.radius.sm,
  },
  warnText: { color: theme.colors.onSurface, fontSize: 12, flex: 1, lineHeight: 16 },
  btnRow: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: 4 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
  },
  btnPrimary: { backgroundColor: theme.colors.brand, flex: 1 },
  btnPrimaryFull: { backgroundColor: theme.colors.brand, height: 48, marginTop: theme.spacing.sm },
  btnPrimaryText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 14 },
  btnSecondary: {
    backgroundColor: theme.colors.surfaceTertiary,
    borderWidth: 1, borderColor: theme.colors.border, flex: 1,
  },
  btnSecondaryText: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.45 },
});
