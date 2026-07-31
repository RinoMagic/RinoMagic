import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

export default function ResetPassword() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!token) setMsg('Link non valido. Torna alla home e usa il pulsante "Password dimenticata".');
  }, [token]);

  const submit = async () => {
    if (!token) return;
    if (pw.length < 8) return setMsg('La password deve avere almeno 8 caratteri');
    if (pw !== pw2) return setMsg('Le due password non coincidono');
    setBusy(true); setMsg(null);
    try {
      await api('/auth/admin/reset-password', {
        method: 'POST', body: { token: String(token), new_password: pw }, auth: false,
      });
      setOk(true);
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.wrap} edges={['top', 'bottom']}>
      <View style={styles.card}>
        <Text style={styles.title}>Reimposta password</Text>
        {ok ? <>
          <Text style={styles.help}>Password aggiornata! Accedi con la nuova password.</Text>
          <Pressable style={styles.cta} onPress={() => router.replace('/')}>
            <Text style={styles.ctaText}>Vai al login</Text>
          </Pressable>
        </> : <>
          <Text style={styles.help}>Scegli una nuova password (min 8 caratteri).</Text>
          <TextInput placeholder="Nuova password" placeholderTextColor={theme.colors.muted}
            value={pw} onChangeText={setPw} secureTextEntry style={styles.input} testID="new-pw" />
          <TextInput placeholder="Ripeti password" placeholderTextColor={theme.colors.muted}
            value={pw2} onChangeText={setPw2} secureTextEntry style={styles.input} testID="new-pw2" />
          {msg && <Text style={styles.err}>{msg}</Text>}
          <Pressable style={[styles.cta, busy && { opacity: 0.5 }]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color={theme.colors.onBrand} /> : <Text style={styles.ctaText}>Salva password</Text>}
          </Pressable>
        </>}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface, padding: theme.spacing.lg, justifyContent: 'center' },
  card: { padding: theme.spacing.xl, backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, gap: theme.spacing.md },
  title: { color: theme.colors.onSurface, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  help: { color: theme.colors.muted, fontSize: 13, textAlign: 'center' },
  input: { color: theme.colors.onSurface, backgroundColor: theme.colors.surfaceTertiary, padding: theme.spacing.md, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, fontSize: 15 },
  err: { color: theme.colors.error, textAlign: 'center' },
  cta: { height: 52, backgroundColor: theme.colors.brand, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 16 },
});
