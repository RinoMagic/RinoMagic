import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session, User } from '@/src/api';
import { theme } from '@/src/theme';

type GameInfo = {
  id: string;
  name: string;
  tagline: string;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  enabled: boolean;
  my_rooms_count: number;
};

export default function Hub() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [games, setGames] = useState<GameInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await session.load();
      if (!s.user) {
        router.replace('/');
        return;
      }
      setMe(s.user);
      const gs = await api<GameInfo[]>('/games');
      setGames(gs);
    } catch (e: any) {
      // If auth expired
      if ((e.message || '').toLowerCase().includes('unauth')) {
        await session.clear();
        router.replace('/');
        return;
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const logout = async () => {
    await session.clear();
    router.replace('/');
  };

  const openGame = (g: GameInfo) => {
    if (!g.enabled) {
      // Show the "Coming Soon" page anyway so users see what's in the pipeline
      if (g.id === 'scoreandlive') router.push('/scoreandlive');
      else if (g.id === 'fantagiornata') router.push('/fantagiornata');
      return;
    }
    if (g.id === 'thebesttiket') {
      if (me?.role === 'admin') router.push('/admin');
      else router.push('/player');
    } else if (g.id === 'scoreandlive') {
      router.push('/scoreandlive');
    } else if (g.id === 'fantagiornata') {
      router.push('/fantagiornata');
    }
  };

  if (loading || !me) {
    return (
      <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>
    );
  }

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>RinoMagic</Text>
            <Text style={styles.brandSub}>Ciao {me.username || me.email?.split('@')[0]}</Text>
          </View>
          <Pressable onPress={() => router.push('/settings')} hitSlop={10} testID="hub-settings">
            <Ionicons name="settings-outline" size={22} color={theme.colors.onSurface} />
          </Pressable>
          <Pressable onPress={logout} hitSlop={10} testID="hub-logout" style={{ marginLeft: 12 }}>
            <Ionicons name="log-out-outline" size={22} color={theme.colors.onSurface} />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120, gap: theme.spacing.lg }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.colors.brand} />
        }
      >
        <View>
          <Text style={styles.sectionTitle}>Scegli il gioco</Text>
          <Text style={styles.sectionSub}>Sfida i tuoi amici in due giochi diversi con lo stesso account.</Text>
        </View>

        {games.map((g) => (
          <Pressable
            key={g.id}
            testID={`game-card-${g.id}`}
            onPress={() => openGame(g)}
            style={({ pressed }) => [
              styles.card,
              { borderColor: g.color, backgroundColor: g.color + '18' },
              !g.enabled && { opacity: 0.7 },
              pressed && { transform: [{ scale: 0.98 }] },
            ]}
          >
            <View style={[styles.iconBox, { backgroundColor: g.color }]}>
              <Ionicons name={g.icon} size={30} color={theme.colors.onBrand} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.cardName}>{g.name}</Text>
                {!g.enabled && (
                  <View style={styles.pillSoon}>
                    <Text style={styles.pillSoonText}>COMING SOON</Text>
                  </View>
                )}
              </View>
              <Text style={styles.cardTag}>{g.tagline}</Text>
              {g.enabled && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <Ionicons name="people" size={13} color={g.color} />
                  <Text style={[styles.cardMeta, { color: g.color }]}>
                    {g.my_rooms_count === 0
                      ? 'Nessuna stanza ancora'
                      : `${g.my_rooms_count} ${g.my_rooms_count === 1 ? 'stanza' : 'stanze'}`}
                  </Text>
                </View>
              )}
            </View>
            {g.enabled ? (
              <Ionicons name="chevron-forward" size={22} color={g.color} />
            ) : (
              <Ionicons name="information-circle-outline" size={22} color={g.color} />
            )}
          </Pressable>
        ))}

        <View style={styles.footNote}>
          <Ionicons name="information-circle-outline" size={16} color={theme.colors.muted} />
          <Text style={styles.footNoteText}>
            Ogni codice invito è valido solo per il gioco per cui è stato generato.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center',
    padding: theme.spacing.lg,
  },
  brand: { color: theme.colors.onSurface, fontSize: 22, fontWeight: '800', letterSpacing: 0.3 },
  brandSub: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },

  sectionTitle: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  sectionSub: { color: theme.colors.muted, fontSize: 13, marginTop: 4, lineHeight: 18 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderWidth: 1.5, borderRadius: theme.radius.lg,
  },
  iconBox: {
    width: 56, height: 56, borderRadius: theme.radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  cardName: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  cardTag: { color: theme.colors.onSurfaceSecondary, fontSize: 13 },
  cardMeta: { fontSize: 12, fontWeight: '700' },
  pillSoon: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.muted + '33',
  },
  pillSoonText: { color: theme.colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },

  footNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
  },
  footNoteText: { color: theme.colors.muted, fontSize: 12, flex: 1, lineHeight: 18 },
});
