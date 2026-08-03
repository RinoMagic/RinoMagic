/*
 * /bonus — 4-slot grid for the RinoMagic Bonus games.
 *
 * Each tile is colour-coded to the parent game (Tiket=giallo, Score=blu,
 * Fanta=viola, Survival=rosso) and shows at-a-glance status:
 *  - eligibility (unlocked/locked based on subscriptions)
 *  - current matchday bonus type + countdown / pick submitted / winner
 */
import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

type Game = 'tiket' | 'score' | 'fanta' | 'survival';

type Available = {
  game: Game;
  bonus_type: 'exact_score' | 'first_scorer';
  eligible: boolean;
  config: null | {
    id: string;
    matchday: number;
    lock_at: string | null;
    status: 'open' | 'locked' | 'settled';
    big_match: { home_team: string; away_team: string } | null;
    result: any;
  };
  subscriptions: {
    id: string; name: string;
    my_pick: null | { is_correct: boolean | null };
  }[];
};

const GAMES: { id: Game; name: string; color: string; icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap; parent: string; reward: string }[] = [
  { id: 'tiket', name: 'Bonus Tiket', color: '#FFB300', icon: 'trophy', parent: 'TheBestTiket', reward: 'Giocata extra' },
  { id: 'score', name: 'Bonus Score', color: '#3B82F6', icon: 'pulse', parent: 'ScoreAndLive', reward: '+1 Vita' },
  { id: 'fanta', name: 'Bonus Fanta', color: '#A855F7', icon: 'football', parent: 'FantaGiornata', reward: '+3 Punti' },
  { id: 'survival', name: 'Bonus Survival', color: '#EF4444', icon: 'heart', parent: 'Survival 2.0', reward: '+1 Vita' },
];

const SEASON = '2026-27';

export default function BonusHub() {
  const router = useRouter();
  const [data, setData] = useState<Record<Game, Available | null>>({
    tiket: null, score: null, fanta: null, survival: null,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all(
        GAMES.map((g) => api<Available>(`/bonus/available?game=${g.id}&season=${SEASON}`).catch(() => null))
      );
      const next: Record<Game, Available | null> = { tiket: null, score: null, fanta: null, survival: null };
      GAMES.forEach((g, i) => { next[g.id] = results[i]; });
      setData(next);
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>;
  }

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Giochi Bonus 🎁</Text>
            <Text style={styles.sub}>1 pronostico bonus per ogni giornata</Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl refreshing={refreshing} tintColor={theme.colors.brand}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />
        }
      >
        <View style={styles.rulesBox}>
          <Ionicons name="information-circle" size={20} color={theme.colors.brand} />
          <Text style={styles.rulesText}>
            <Text style={{ fontWeight: '800' }}>Tipo 1</Text> (Tiket + Survival): indovina il risultato esatto del Big Match.{'\n'}
            <Text style={{ fontWeight: '800' }}>Tipo 2</Text> (Score + Fanta): indovina il primo marcatore della giornata.{'\n'}
            <Text style={{ fontStyle: 'italic' }}>Puoi giocare solo se sei iscritto al gioco corrispondente.</Text>
          </Text>
        </View>

        <View style={styles.grid}>
          {GAMES.map((g) => {
            const d = data[g.id];
            return (
              <BonusCard
                key={g.id}
                title={g.name} parent={g.parent} color={g.color}
                icon={g.icon} reward={g.reward} data={d}
                onPress={() => router.push({ pathname: '/bonus/[game]', params: { game: g.id } })}
              />
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function BonusCard({
  title, parent, color, icon, reward, data, onPress,
}: {
  title: string; parent: string; color: string;
  icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap;
  reward: string; data: Available | null;
  onPress: () => void;
}) {
  const status = data?.config?.status;
  const eligible = data?.eligible;
  const subsCount = data?.subscriptions?.length || 0;
  const subsWithPick = data?.subscriptions?.filter((s) => s.my_pick).length || 0;
  const subsToPlay = subsCount - subsWithPick;
  const winners = data?.subscriptions?.filter((s) => s.my_pick?.is_correct === true).length || 0;

  const statusLabel = useMemo(() => {
    if (!eligible) return 'Iscriviti per giocare';
    if (!data?.config) return 'Bonus non attivo';
    if (status === 'settled') {
      if (winners > 0) return `🏆 Vinto ×${winners}`;
      if (subsWithPick > 0) return 'Nessuna vincita';
      return 'Non giocato';
    }
    if (status === 'locked') return subsWithPick > 0 ? 'In attesa esito' : 'Countdown scaduto';
    if (subsToPlay === 0) return `✓ ${subsCount} pronostic${subsCount === 1 ? 'o inviato' : 'i inviati'}`;
    return `⏳ ${subsToPlay}/${subsCount} da giocare`;
  }, [eligible, status, subsCount, subsWithPick, subsToPlay, winners, data]);

  const countdown = useCountdown(data?.config?.lock_at);

  return (
    <Pressable
      testID={`bonus-tile-${data?.game || parent}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { borderColor: color, backgroundColor: color + '15' },
        !eligible && { opacity: 0.55 },
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      <View style={[styles.tileIcon, { backgroundColor: color }]}>
        <Ionicons name={icon} size={24} color="#fff" />
      </View>
      <Text style={styles.tileTitle}>{title}</Text>
      <Text style={styles.tileParent}>{parent}</Text>
      <View style={styles.tileReward}>
        <Ionicons name="gift" size={12} color={color} />
        <Text style={[styles.tileRewardText, { color }]}>{reward}</Text>
      </View>
      <View style={styles.tileFooter}>
        <Text style={[styles.tileStatus, { color: eligible ? theme.colors.onSurface : theme.colors.muted }]} numberOfLines={2}>
          {statusLabel}
        </Text>
        {countdown && status === 'open' && (
          <View style={[styles.countPill, { backgroundColor: color }]}>
            <Ionicons name="time" size={11} color="#fff" />
            <Text style={styles.countPillText}>{countdown}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function useCountdown(iso: string | null | undefined): string | null {
  const [, setTick] = useState(0);
  useFocusEffect(useCallback(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []));
  if (!iso) return null;
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diff = target - now;
  if (diff <= 0) return null;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return `${d}g ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  title: { color: theme.colors.onSurface, fontSize: 22, fontWeight: '800' },
  sub: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  body: {
    padding: theme.spacing.lg, paddingBottom: 100, gap: theme.spacing.lg,
  },

  rulesBox: {
    flexDirection: 'row', gap: theme.spacing.sm,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.brand + '55',
  },
  rulesText: {
    color: theme.colors.onSurfaceSecondary, fontSize: 12,
    lineHeight: 18, flex: 1,
  },

  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md,
  },
  tile: {
    width: '48%',
    borderWidth: 1.5, borderRadius: theme.radius.lg,
    padding: theme.spacing.md, gap: 6,
    minHeight: 200,
  },
  tileIcon: {
    width: 42, height: 42, borderRadius: theme.radius.md,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  tileTitle: { color: theme.colors.onSurface, fontSize: 15, fontWeight: '800' },
  tileParent: { color: theme.colors.muted, fontSize: 11 },
  tileReward: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 4,
  },
  tileRewardText: {
    fontSize: 11, fontWeight: '800', letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  tileFooter: {
    marginTop: 'auto', gap: 6,
  },
  tileStatus: { fontSize: 11, fontWeight: '600', lineHeight: 15 },
  countPill: {
    flexDirection: 'row', alignSelf: 'flex-start',
    alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: theme.radius.pill,
  },
  countPillText: {
    color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.4,
  },
});
