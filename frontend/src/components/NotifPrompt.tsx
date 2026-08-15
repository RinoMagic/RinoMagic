/**
 * NotifPrompt — smart, single-file banner shown on the Hub that guides
 * players through enabling Web Push notifications.
 *
 * States handled:
 *  - 'unsupported' → not shown
 *  - 'ios-needs-install' → show "Aggiungi a Home" tutorial banner
 *  - 'ready' + permission='default' → "Attiva notifiche" CTA banner
 *  - 'ready' + permission='denied' → hint about unblocking from browser settings
 *  - 'ready' + permission='granted' → nothing (already subscribed)
 *
 * Also auto-hides for the session after user dismisses.
 */
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import {
  pushSupport, pushPermission, subscribeToPush, isIOS,
} from '@/src/push';

const SESSION_KEY = 'rinomagic_notif_prompt_dismissed';

export function NotifPrompt() {
  const [support, setSupport] = useState<string>('unsupported');
  const [permission, setPermission] = useState<string>('unsupported');
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    setSupport(pushSupport());
    setPermission(pushPermission());
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        setDismissed(window.sessionStorage.getItem(SESSION_KEY) === '1');
      }
    } catch (_e) { /* ignore */ }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem(SESSION_KEY, '1');
      }
    } catch (_e) { /* ignore */ }
  };

  const enable = async () => {
    setBusy(true);
    const res = await subscribeToPush();
    setBusy(false);
    if (res.ok) {
      setPermission('granted');
      Alert.alert(
        '🔔 Notifiche attive!',
        'Riceverai un avviso per le deadline, i risultati e le comunicazioni importanti.',
      );
    } else if (res.reason === 'permission') {
      Alert.alert(
        'Permesso negato',
        'Puoi riattivare le notifiche dalle impostazioni del browser.',
      );
      setPermission('denied');
    } else {
      Alert.alert('Errore', 'Impossibile attivare le notifiche. Riprova più tardi.');
    }
  };

  // Only shown on web PWA
  if (Platform.OS !== 'web' || dismissed) return null;
  if (support === 'unsupported' || permission === 'granted') return null;

  // iOS Safari without installed PWA → guide user to Add to Home
  if (support === 'ios-needs-install') {
    return (
      <View style={[styles.card, styles.iosCard]}>
        <View style={styles.row}>
          <View style={styles.iconBox}>
            <Ionicons name="phone-portrait-outline" size={24} color={theme.colors.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Attiva le notifiche su iPhone 📲</Text>
            <Text style={styles.desc}>
              1. Tocca l&apos;icona <Ionicons name="share-outline" size={13} color={theme.colors.onSurface} /> Condividi in basso
              {'\n'}2. Scegli <Text style={styles.bold}>&quot;Aggiungi alla schermata Home&quot;</Text>
              {'\n'}3. Riapri RinoMagic dall&apos;icona sulla Home
              {'\n'}4. Torna qui e attiva le notifiche 🔔
            </Text>
          </View>
          <Pressable onPress={dismiss} hitSlop={10}>
            <Ionicons name="close" size={20} color={theme.colors.muted} />
          </Pressable>
        </View>
      </View>
    );
  }

  // Ready + permission is 'default' or 'denied'
  const isDenied = permission === 'denied';

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.iconBox}>
          <Ionicons name="notifications" size={24} color={theme.colors.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            {isDenied ? 'Notifiche disabilitate' : 'Attiva le notifiche 🔔'}
          </Text>
          <Text style={styles.desc}>
            {isDenied
              ? 'Le hai bloccate. Riattivale dalle impostazioni del browser (icona lucchetto in URL).'
              : 'Ricevi avvisi per deadline, risultati e novità.'}
          </Text>
        </View>
        <Pressable onPress={dismiss} hitSlop={10}>
          <Ionicons name="close" size={20} color={theme.colors.muted} />
        </Pressable>
      </View>
      {!isDenied && (
        <Pressable
          onPress={enable}
          disabled={busy}
          style={[styles.cta, busy && { opacity: 0.6 }]}
        >
          <Ionicons name="notifications-outline" size={16} color={theme.colors.onBrand} />
          <Text style={styles.ctaText}>{busy ? 'Attivazione...' : 'Attiva ora'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.brand + '18',
    borderWidth: 1,
    borderColor: theme.colors.brand + '55',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  iosCard: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderColor: theme.colors.brand + '55',
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm },
  iconBox: {
    width: 40, height: 40, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.brand + '22',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: theme.colors.onSurface, fontSize: 15, fontWeight: '800' },
  desc: { color: theme.colors.onSurfaceSecondary, fontSize: 13, lineHeight: 18, marginTop: 2 },
  bold: { fontWeight: '800', color: theme.colors.onSurface },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: theme.colors.brand,
    paddingVertical: 10, borderRadius: theme.radius.md,
  },
  ctaText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 14 },
});
