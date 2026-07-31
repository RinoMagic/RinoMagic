import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

export default function FantaGiornata() {
  const router = useRouter();
  const color = '#A855F7';
  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="fg-back">
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>FantaGiornata</Text>
          <View style={{ width: 26 }} />
        </View>
      </SafeAreaView>

      <View style={styles.center}>
        <View style={[styles.iconBox, { backgroundColor: color + '22' }]}>
          <Ionicons name="football" size={56} color={color} />
        </View>
        <Text style={styles.headline}>In arrivo prossimamente</Text>
        <Text style={styles.body}>
          Fantacalcio a giornata singola. Metti in campo 11 titolari + 8 riserve e sfida i tuoi amici
          settimana dopo settimana. Torna presto a scoprire di più!
        </Text>
        <Pressable
          testID="fg-back-hub"
          onPress={() => router.replace('/hub')}
          style={[styles.cta, { backgroundColor: color }]}
        >
          <Ionicons name="game-controller" size={18} color={theme.colors.onBrand} />
          <Text style={styles.ctaText}>Torna all&apos;hub giochi</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: theme.spacing.lg,
  },
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: theme.spacing.xxl, gap: theme.spacing.lg,
  },
  iconBox: {
    width: 100, height: 100, borderRadius: 50,
    alignItems: 'center', justifyContent: 'center',
  },
  headline: { color: theme.colors.onSurface, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  body: { color: theme.colors.onSurfaceSecondary, fontSize: 14, textAlign: 'center', lineHeight: 22 },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg, paddingVertical: 12,
    borderRadius: theme.radius.pill,
    marginTop: theme.spacing.md,
  },
  ctaText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 14 },
});
