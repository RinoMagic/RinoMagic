import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/context/AuthContext';
import { theme } from '@/src/theme';

export default function Profile() {
  const { user, signOut } = useAuth();

  return (
    <View style={styles.wrap}>
      <View style={styles.bannerWrap}>
        <Image
          source="https://images.unsplash.com/photo-1637004732258-4b792ce8f474?crop=entropy&cs=srgb&fm=jpg&h=400&w=800"
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
        <LinearGradient
          colors={['rgba(13,17,20,0.2)', theme.colors.surface]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <Text style={styles.headerTitle}>Profilo</Text>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.avatarBig}>
          <Text style={styles.avatarText}>
            {(user?.username || '?').slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <Text testID="profile-username" style={styles.name}>{user?.username}</Text>
        <Text style={styles.email}>{user?.email}</Text>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Ionicons name="trophy" size={22} color={theme.colors.brandSecondary} />
            <Text style={styles.statValue}>0</Text>
            <Text style={styles.statLabel}>Giornate vinte</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="flame" size={22} color={theme.colors.brand} />
            <Text style={styles.statValue}>0</Text>
            <Text style={styles.statLabel}>Punti totali</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Regolamento</Text>
          <View style={styles.card}>
            <Rule label="Voto base" value="6.0 di partenza" />
            <Rule label="Gol" value="+3" />
            <Rule label="Assist" value="+1" />
            <Rule label="Rigore segnato" value="+3" />
            <Rule label="Rigore sbagliato" value="-3" />
            <Rule label="Ammonizione" value="-0.5" />
            <Rule label="Espulsione" value="-1" />
            <Rule label="Autogol" value="-2" />
            <Rule label="Portiere: gol subito" value="-1 ogni 2" last />
          </View>
        </View>

        <Pressable testID="logout-button" style={styles.logout} onPress={signOut}>
          <Ionicons name="log-out-outline" size={18} color={theme.colors.error} />
          <Text style={styles.logoutText}>Esci</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Rule({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View
      style={[
        s2.ruleRow,
        !last && { borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
      ]}
    >
      <Text style={s2.ruleLabel}>{label}</Text>
      <Text style={s2.ruleValue}>{value}</Text>
    </View>
  );
}

const s2 = StyleSheet.create({
  ruleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  ruleLabel: { color: theme.colors.onSurfaceSecondary, fontSize: 14 },
  ruleValue: { color: theme.colors.brand, fontWeight: '800', fontSize: 14 },
});

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  bannerWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,
  },
  headerSafe: { padding: theme.spacing.lg },
  headerTitle: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 26 },
  scroll: { alignItems: 'center', padding: theme.spacing.lg, paddingBottom: 140 },
  avatarBig: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: theme.colors.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.colors.brand,
    marginTop: theme.spacing.md,
  },
  avatarText: { color: theme.colors.brand, fontWeight: '800', fontSize: 30 },
  name: { color: theme.colors.onSurface, fontSize: 22, fontWeight: '800', marginTop: theme.spacing.md },
  email: { color: theme.colors.muted, marginTop: 2 },
  statsRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    width: '100%',
    marginTop: theme.spacing.xl,
  },
  statCard: {
    flex: 1,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    gap: 4,
  },
  statValue: { color: theme.colors.onSurface, fontSize: 24, fontWeight: '800' },
  statLabel: { color: theme.colors.muted, fontSize: 12 },
  section: { width: '100%', marginTop: theme.spacing.xl },
  sectionTitle: {
    color: theme.colors.onSurface,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: theme.spacing.md,
  },
  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xl,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  logoutText: { color: theme.colors.error, fontWeight: '800' },
});
