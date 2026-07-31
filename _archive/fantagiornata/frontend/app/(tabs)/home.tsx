import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/context/AuthContext';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

type League = {
  id: string;
  name: string;
  code: string;
  members_count: number;
  is_owner: boolean;
  current_matchday: number;
};

export default function Home() {
  const { user } = useAuth();
  const router = useRouter();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<League[]>('/leagues');
      setLeagues(data);
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const totalMatchday = leagues.length > 0 ? Math.max(...leagues.map(l => l.current_matchday)) : 1;

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: 'transparent' }}>
        <View style={styles.header}>
          <View>
            <Text style={styles.hello}>Ciao,</Text>
            <Text testID="home-username" style={styles.username}>{user?.username}</Text>
          </View>
          <View style={styles.avatarBig}>
            <Text style={styles.avatarText}>
              {(user?.username || '?').slice(0, 2).toUpperCase()}
            </Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.brand}
          />
        }
      >
        {/* Hero card */}
        <View style={styles.hero}>
          <Image
            source="https://images.pexels.com/photos/4122451/pexels-photo-4122451.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
          <LinearGradient
            colors={['rgba(0,0,0,0.1)', 'rgba(13,17,20,0.9)']}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroContent}>
            <Text style={styles.heroLabel}>GIORNATA CORRENTE</Text>
            <Text style={styles.heroNumber}>{totalMatchday}</Text>
            <Text style={styles.heroSub}>
              Crea la tua formazione senza limiti di crediti
            </Text>
          </View>
        </View>

        {/* Quick actions */}
        <View style={styles.actions}>
          <Pressable
            testID="quick-action-leagues"
            style={styles.actionCard}
            onPress={() => router.push('/(tabs)/leagues')}
          >
            <Ionicons name="trophy" size={22} color={theme.colors.brandSecondary} />
            <Text style={styles.actionTitle}>Le tue leghe</Text>
            <Text style={styles.actionSub}>{leagues.length} attive</Text>
          </Pressable>
          <Pressable
            testID="quick-action-players"
            style={styles.actionCard}
            onPress={() => router.push('/(tabs)/players')}
          >
            <Ionicons name="football" size={22} color={theme.colors.brand} />
            <Text style={styles.actionTitle}>Rosa Serie A</Text>
            <Text style={styles.actionSub}>200+ giocatori</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Le tue leghe</Text>

        {leagues.length === 0 ? (
          <View style={styles.empty} testID="home-empty">
            <Ionicons name="trophy-outline" size={40} color={theme.colors.muted} />
            <Text style={styles.emptyText}>Non hai leghe attive</Text>
            <Pressable
              testID="empty-goto-leagues"
              style={styles.emptyCta}
              onPress={() => router.push('/(tabs)/leagues')}
            >
              <Text style={styles.emptyCtaText}>Crea o entra in una lega</Text>
            </Pressable>
          </View>
        ) : (
          leagues.map((lg) => (
            <Pressable
              key={lg.id}
              testID={`home-league-${lg.id}`}
              style={styles.leagueCard}
              onPress={() => router.push(`/league/${lg.id}`)}
            >
              <View style={styles.leagueLeft}>
                <View style={styles.leagueIcon}>
                  <Ionicons name="shield" size={20} color={theme.colors.brand} />
                </View>
                <View>
                  <Text style={styles.leagueName}>{lg.name}</Text>
                  <Text style={styles.leagueMeta}>
                    {lg.members_count} membri · Giornata {lg.current_matchday}
                    {lg.is_owner ? ' · Admin' : ''}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  hello: { color: theme.colors.muted, fontSize: 13 },
  username: { color: theme.colors.onSurface, fontSize: 22, fontWeight: '800' },
  avatarBig: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  avatarText: { color: theme.colors.brand, fontWeight: '800' },
  scroll: { paddingHorizontal: theme.spacing.lg, paddingBottom: 100 },
  hero: {
    height: 180,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  heroContent: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
  },
  heroLabel: {
    color: theme.colors.brand,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  heroNumber: {
    color: theme.colors.onSurface,
    fontSize: 48,
    fontWeight: '800',
    lineHeight: 52,
  },
  heroSub: { color: theme.colors.onSurfaceSecondary, fontSize: 13, marginTop: 4 },
  actions: { flexDirection: 'row', gap: theme.spacing.md, marginBottom: theme.spacing.xl },
  actionCard: {
    flex: 1,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  actionTitle: {
    color: theme.colors.onSurface,
    fontWeight: '700',
    marginTop: theme.spacing.sm,
    fontSize: 15,
  },
  actionSub: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  sectionTitle: {
    color: theme.colors.onSurface,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: theme.spacing.md,
  },
  empty: {
    padding: theme.spacing.xl,
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  emptyText: { color: theme.colors.muted },
  emptyCta: {
    backgroundColor: theme.colors.brand,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.md,
    marginTop: theme.spacing.sm,
  },
  emptyCtaText: { color: theme.colors.onBrand, fontWeight: '800' },
  leagueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.sm,
  },
  leagueLeft: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  leagueIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leagueName: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 15 },
  leagueMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
});
