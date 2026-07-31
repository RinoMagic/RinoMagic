import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/context/AuthContext';
import { theme } from '@/src/theme';

export default function Login() {
  const { signIn, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await signIn(email.trim(), password);
      router.replace('/(tabs)/home');
    } catch (e: any) {
      setError(e.message || 'Errore login');
    }
  };

  return (
    <View style={styles.wrap}>
      <Image
        source="https://images.pexels.com/photos/32761355/pexels-photo-32761355.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
      <LinearGradient
        colors={['rgba(13,17,20,0.2)', 'rgba(13,17,20,0.85)', theme.colors.surface]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.brandWrap}>
              <View style={styles.badge}>
                <Ionicons name="football" size={22} color={theme.colors.brand} />
              </View>
              <Text style={styles.brandTitle}>FantaGiornata</Text>
              <Text style={styles.brandSub}>Ogni giornata, una nuova sfida.</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.h1}>Bentornato</Text>
              <Text style={styles.p}>Accedi per creare la tua formazione</Text>

              <View style={styles.field}>
                <Ionicons name="mail-outline" size={18} color={theme.colors.muted} />
                <TextInput
                  testID="login-email-input"
                  placeholder="Email"
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  style={styles.input}
                />
              </View>
              <View style={styles.field}>
                <Ionicons name="lock-closed-outline" size={18} color={theme.colors.muted} />
                <TextInput
                  testID="login-password-input"
                  placeholder="Password"
                  placeholderTextColor={theme.colors.muted}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  style={styles.input}
                />
              </View>

              {error && <Text testID="login-error" style={styles.error}>{error}</Text>}

              <Pressable
                testID="login-submit-button"
                onPress={submit}
                disabled={loading}
                style={({ pressed }) => [
                  styles.cta,
                  pressed && { opacity: 0.85 },
                  loading && { opacity: 0.6 },
                ]}
              >
                {loading ? (
                  <ActivityIndicator color={theme.colors.onBrand} />
                ) : (
                  <Text style={styles.ctaText}>Accedi</Text>
                )}
              </Pressable>

              <Pressable
                testID="forgot-password"
                style={styles.forgotRow}
                onPress={() => setError('Password dimenticata? Contatta l\'amministratore della lega o dell\'app per ricevere una nuova password.')}
              >
                <Text style={styles.forgotText}>Password dimenticata?</Text>
              </Pressable>

              <Link href="/(auth)/register" asChild>
                <Pressable testID="go-to-register" style={styles.linkRow}>
                  <Text style={styles.linkText}>
                    Non hai un account?{' '}
                    <Text style={{ color: theme.colors.brand, fontWeight: '700' }}>
                      Registrati
                    </Text>
                  </Text>
                </Pressable>
              </Link>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  scroll: { padding: theme.spacing.lg, flexGrow: 1, justifyContent: 'space-between' },
  brandWrap: { alignItems: 'flex-start', marginTop: theme.spacing.xl },
  badge: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
  },
  brandTitle: {
    color: theme.colors.onSurface,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  brandSub: { color: theme.colors.muted, fontSize: 14, marginTop: 4 },
  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  h1: { color: theme.colors.onSurface, fontSize: 24, fontWeight: '800' },
  p: { color: theme.colors.muted, marginTop: 4, marginBottom: theme.spacing.lg },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceTertiary,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  input: {
    flex: 1,
    color: theme.colors.onSurface,
    fontSize: 15,
    paddingVertical: 14,
  },
  cta: {
    backgroundColor: theme.colors.brand,
    height: 52,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing.sm,
  },
  ctaText: {
    color: theme.colors.onBrand,
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.3,
  },
  linkRow: { marginTop: theme.spacing.lg, alignItems: 'center' },
  linkText: { color: theme.colors.onSurfaceSecondary, fontSize: 14 },
  forgotRow: {
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  forgotText: {
    color: theme.colors.brand,
    fontSize: 13,
    fontWeight: '600',
  },
  error: {
    color: theme.colors.error,
    marginBottom: theme.spacing.sm,
    fontSize: 13,
  },
});
