import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator,
  ScrollView, KeyboardAvoidingView, Platform, ImageBackground, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api, session, User } from '@/src/api';
import { theme } from '@/src/theme';

type Mode = 'login' | 'register' | 'forgot';

export default function Landing() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<Mode>('login');
  const [identifier, setIdentifier] = useState('');   // Email o Nickname
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const s = await session.load();
      if (s.token && s.user) {
        goHome(s.user);
      } else {
        setChecking(false);
      }
    })();
  }, []);

  const goHome = (_user: User) => {
    router.replace('/hub');
  };

  const isEmail = (v: string) => v.includes('@');

  const submit = async () => {
    setBusy(true); setMsg(null); setOkMsg(null);
    try {
      const idTrim = identifier.trim();

      if (mode === 'login') {
        if (!idTrim || !password) {
          setMsg('Inserisci email/nickname e password.');
          return;
        }
        if (isEmail(idTrim)) {
          // Admin login
          const res = await api<{ token: string; user: User }>(
            '/auth/admin/login',
            { method: 'POST', body: { email: idTrim, password }, auth: false },
          );
          await session.save(res.token, res.user);
          goHome(res.user);
        } else {
          // Player login
          const res = await api<{ token: string; user: User }>(
            '/auth/player/login',
            { method: 'POST', body: { username: idTrim, password }, auth: false },
          );
          await session.save(res.token, res.user);
          goHome(res.user);
        }
      } else if (mode === 'register') {
        if (!idTrim || !password) {
          setMsg('Inserisci nickname e password.');
          return;
        }
        if (isEmail(idTrim)) {
          setMsg('Il nickname non può contenere una @.');
          return;
        }
        const res = await api<{ token: string; user: User }>(
          '/auth/player/register',
          { method: 'POST', body: { username: idTrim, password }, auth: false },
        );
        await session.save(res.token, res.user);
        goHome(res.user);
      } else if (mode === 'forgot') {
        if (!idTrim || !isEmail(idTrim)) {
          setMsg('Inserisci una email valida.');
          return;
        }
        const res = await api<{ message: string }>(
          '/auth/admin/forgot-password',
          { method: 'POST', body: { email: idTrim }, auth: false },
        );
        setOkMsg(res.message);
      }
    } catch (e: any) {
      setMsg(e.message);
    } finally { setBusy(false); }
  };

  if (checking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.brand} />
      </View>
    );
  }

  const ctaLabel =
    mode === 'login' ? 'Accedi'
      : mode === 'register' ? 'Registrati'
        : 'Invia link di reset';

  const idPlaceholder =
    mode === 'login' ? 'Email o Nickname'
      : mode === 'register' ? 'Nickname (2-20 caratteri)'
        : 'Email admin';

  return (
    <ImageBackground
      source={require('../assets/images/stadium-bg.webp')}
      style={styles.bg}
      resizeMode="cover"
    >
      <View style={styles.overlay} />
      <SafeAreaView style={styles.wrap} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Logo */}
            <View style={styles.hero}>
              <Image
                source={require('../assets/images/barslot-logo.jpg')}
                style={styles.logoImg}
                resizeMode="contain"
              />
              <Text style={styles.brand}>RinoMagic</Text>
              <View style={styles.brandUnderline} />
            </View>

            {/* Card */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                {mode === 'login' ? 'Bentornato' : mode === 'register' ? 'Crea il tuo account' : 'Recupero password'}
              </Text>
              <Text style={styles.cardSub}>
                {mode === 'login'
                  ? 'Accedi con la tua email admin o il tuo nickname.'
                  : mode === 'register'
                    ? 'Scegli un nickname e una password.'
                    : "Riceverai un link per reimpostare la password."}
              </Text>

              <TextInput
                testID="auth-identifier"
                placeholder={idPlaceholder}
                placeholderTextColor="rgba(255,255,255,0.5)"
                value={identifier}
                onChangeText={setIdentifier}
                autoCapitalize="none"
                keyboardType={mode === 'forgot' ? 'email-address' : 'default'}
                style={styles.input}
              />

              {mode !== 'forgot' && (
                <TextInput
                  testID="auth-password"
                  placeholder="Password"
                  placeholderTextColor="rgba(255,255,255,0.5)"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  style={styles.input}
                />
              )}

              {msg && <Text style={styles.err}>{msg}</Text>}
              {okMsg && <Text style={styles.ok}>{okMsg}</Text>}

              <Pressable
                onPress={submit}
                disabled={busy}
                style={[styles.cta, busy && { opacity: 0.6 }]}
                testID="auth-submit"
              >
                {busy
                  ? <ActivityIndicator color={theme.colors.onBrand} />
                  : <Text style={styles.ctaText}>{ctaLabel}</Text>}
              </Pressable>

              {/* Links */}
              <View style={styles.linksRow}>
                {mode === 'login' && (
                  <>
                    <Pressable onPress={() => { setMode('register'); setMsg(null); setOkMsg(null); setPassword(''); }}>
                      <Text style={styles.linkSmall}>Registrati</Text>
                    </Pressable>
                    <Text style={styles.linkDot}>•</Text>
                    <Pressable onPress={() => { setMode('forgot'); setMsg(null); setOkMsg(null); setPassword(''); }}>
                      <Text style={styles.linkSmall}>Password dimenticata?</Text>
                    </Pressable>
                  </>
                )}
                {mode === 'register' && (
                  <Pressable onPress={() => { setMode('login'); setMsg(null); setOkMsg(null); }}>
                    <Text style={styles.linkSmall}>← Hai già un account? Accedi</Text>
                  </Pressable>
                )}
                {mode === 'forgot' && (
                  <Pressable onPress={() => { setMode('login'); setMsg(null); setOkMsg(null); }}>
                    <Text style={styles.linkSmall}>← Torna al login</Text>
                  </Pressable>
                )}
              </View>
            </View>

            <Text style={styles.footer}>Chi ha la quota più bassa, paga da bere.</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, width: '100%', height: '100%', backgroundColor: '#0a0f1e' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 10, 25, 0.65)',
  },
  wrap: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0f1e' },
  scroll: {
    flexGrow: 1,
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
    justifyContent: 'center',
  },

  // Logo hero
  hero: {
    alignItems: 'center',
    marginTop: theme.spacing.md,
    gap: 6,
  },
  logoImg: {
    width: 260,
    height: 90,
    marginBottom: 4,
  },
  brand: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 1.5,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  brandUnderline: {
    width: 60,
    height: 3,
    borderRadius: 2,
    backgroundColor: theme.colors.brand,
    marginTop: 4,
  },

  // Card
  card: {
    padding: theme.spacing.lg,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    gap: theme.spacing.md,
    // subtle shadow / glow
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  cardTitle: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 20,
    textAlign: 'center',
  },
  cardSub: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: -4,
  },
  input: {
    color: '#ffffff',
    backgroundColor: 'rgba(255,255,255,0.08)',
    padding: theme.spacing.md,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    fontSize: 15,
  },

  err: { color: '#ff6b6b', fontSize: 13, textAlign: 'center' },
  ok: { color: '#4ade80', fontSize: 13, textAlign: 'center' },

  cta: {
    height: 52,
    backgroundColor: theme.colors.brand,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: theme.colors.brand,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  ctaText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },

  linksRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  linkSmall: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
    textAlign: 'center',
  },
  linkDot: { color: 'rgba(255,255,255,0.4)', fontSize: 13 },

  footer: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: theme.spacing.md,
  },
});
