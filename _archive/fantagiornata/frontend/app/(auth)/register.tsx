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

export default function Register() {
  const { signUp, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (password.length < 6) return setError('Password minimo 6 caratteri');
    if (username.length < 2) return setError('Username minimo 2 caratteri');
    try {
      await signUp(email.trim(), password, username.trim());
      router.replace('/(tabs)/home');
    } catch (e: any) {
      setError(e.message || 'Errore registrazione');
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
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.brandWrap}>
              <View style={styles.badge}>
                <Ionicons name="football" size={22} color={theme.colors.brand} />
              </View>
              <Text style={styles.brandTitle}>Crea account</Text>
              <Text style={styles.brandSub}>Inizia la tua stagione</Text>
            </View>

            <View style={styles.card}>
              <View style={styles.field}>
                <Ionicons name="person-outline" size={18} color={theme.colors.muted} />
                <TextInput
                  testID="register-username-input"
                  placeholder="Username"
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="none"
                  value={username}
                  onChangeText={setUsername}
                  style={styles.input}
                />
              </View>
              <View style={styles.field}>
                <Ionicons name="mail-outline" size={18} color={theme.colors.muted} />
                <TextInput
                  testID="register-email-input"
                  placeholder="Email"
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  style={styles.input}
                />
              </View>
              <View style={styles.field}>
                <Ionicons name="lock-closed-outline" size={18} color={theme.colors.muted} />
                <TextInput
                  testID="register-password-input"
                  placeholder="Password (min 6)"
                  placeholderTextColor={theme.colors.muted}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  style={styles.input}
                />
              </View>

              {error && <Text testID="register-error" style={styles.error}>{error}</Text>}

              <Pressable
                testID="register-submit-button"
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
                  <Text style={styles.ctaText}>Crea account</Text>
                )}
              </Pressable>

              <Link href="/(auth)/login" asChild>
                <Pressable testID="go-to-login" style={styles.linkRow}>
                  <Text style={styles.linkText}>
                    Hai gia un account?{' '}
                    <Text style={{ color: theme.colors.brand, fontWeight: '700' }}>Accedi</Text>
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
  brandTitle: { color: theme.colors.onSurface, fontSize: 34, fontWeight: '800' },
  brandSub: { color: theme.colors.muted, marginTop: 4, fontSize: 14 },
  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
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
  input: { flex: 1, color: theme.colors.onSurface, fontSize: 15, paddingVertical: 14 },
  cta: {
    backgroundColor: theme.colors.brand,
    height: 52,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing.sm,
  },
  ctaText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 16 },
  linkRow: { marginTop: theme.spacing.lg, alignItems: 'center' },
  linkText: { color: theme.colors.onSurfaceSecondary, fontSize: 14 },
  error: { color: theme.colors.error, marginBottom: theme.spacing.sm, fontSize: 13 },
});
