import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

export default function ScoreAndLive() {
  const router = useRouter();
  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="sal-back">
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>ScoreAndLive</Text>
          <View style={{ width: 26 }} />
        </View>
      </SafeAreaView>

      <View style={styles.center}>
        <View style={styles.iconBox}>
          <Ionicons name="pulse" size={56} color="#3B82F6" />
        </View>
        <Text style={styles.headline}>In arrivo prossimamente</Text>
        <Text style={styles.body}>
          Un nuovo gioco della famiglia RinoMagic in fase di sviluppo.{'\n'}
          Torna presto a scoprire di cosa si tratta!
        </Text>
        <Pressable
          testID="sal-back-hub"
          onPress={() => router.replace('/hub')}
          style={styles.cta}
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
    backgroundColor: '#3B82F6' + '22',
    alignItems: 'center', justifyContent: 'center',
  },
  headline: { color: theme.colors.onSurface, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  body: { color: theme.colors.onSurfaceSecondary, fontSize: 14, textAlign: 'center', lineHeight: 22 },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg, paddingVertical: 12,
    backgroundColor: theme.colors.brand,
    borderRadius: theme.radius.pill,
    marginTop: theme.spacing.md,
  },
  ctaText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 14 },
});
