import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Share,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session } from '@/src/api';
import { theme } from '@/src/theme';

type Room = {
  id: string;
  name: string;
  matchday: number;
  max_events: number;
  color: string;
  invite_code: string;
  admin_nickname: string;
  status: string;
  members_count: number;
  is_admin: boolean;
};

type Member = { nickname: string; is_admin?: boolean; submitted: boolean };

type LeaderEntry = {
  nickname: string;
  total: number;
  won_count: number;
  events_count: number;
  rank: number;
};

export default function RoomDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([]);
  const [hasResults, setHasResults] = useState(false);
  const [mySchedina, setMySchedina] = useState<any>(null);
  const [tab, setTab] = useState<'members' | 'leaderboard'>('members');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api<Room>(`/rooms/${id}`);
      setRoom(r);
      const [m, s, lb] = await Promise.all([
        api<Member[]>(`/rooms/${id}/members`),
        api<any>(`/rooms/${id}/schedina`).catch(() => ({ empty: true })),
        api<{ has_results: boolean; leaderboard: LeaderEntry[] }>(`/rooms/${id}/leaderboard`).catch(() => ({
          has_results: false,
          leaderboard: [],
        })),
      ]);
      setMembers(m);
      setMySchedina(s?.empty ? null : s);
      setHasResults(lb.has_results);
      setLeaderboard(lb.leaderboard);
    } catch {} finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const shareInvite = async () => {
    if (!room) return;
    const text = `Entra nella mia stanza SchedinaBar "${room.name}" con il codice ${room.invite_code}`;
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
      try { await (navigator as any).clipboard.writeText(text); } catch {}
      return;
    }
    try { await Share.share({ message: text }); } catch {}
  };

  const logout = async () => {
    await session.clear();
    router.replace('/');
  };

  if (loading || !room) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.brand} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: room.color + '22' }}>
        <View style={styles.header}>
          <Pressable onPress={logout} hitSlop={12} testID="room-logout">
            <Ionicons name="log-out-outline" size={22} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.roomName} numberOfLines={1}>{room.name}</Text>
            <Text style={styles.roomMeta}>
              Giornata {room.matchday} · {room.max_events} pronostici
            </Text>
          </View>
          <Pressable onPress={shareInvite} hitSlop={12} testID="room-share">
            <Ionicons name="share-social" size={22} color={theme.colors.onSurface} />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.brand} />
        }
      >
        {/* Invite code hero */}
        <View style={[styles.hero, { backgroundColor: room.color + '15', borderColor: room.color }]}>
          <Text style={styles.heroLabel}>CODICE INVITO</Text>
          <Text style={[styles.heroCode, { color: room.color }]}>{room.invite_code}</Text>
          <Text style={styles.heroSub}>{room.members_count} partecipanti</Text>
        </View>

        {/* Schedina CTA */}
        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          {mySchedina && mySchedina.status === 'confirmed' ? (
            <View style={styles.doneCard}>
              <Ionicons name="checkmark-circle" size={24} color={theme.colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.doneTitle}>Schedina consegnata</Text>
                <Text style={styles.doneSub}>
                  {mySchedina.events?.length || 0} pronostici confermati
                </Text>
              </View>
              <Pressable
                testID="edit-schedina"
                onPress={() => router.push(`/room/${room.id}/upload`)}
              >
                <Text style={{ color: theme.colors.brand, fontWeight: '800' }}>Modifica</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              testID="upload-schedina-btn"
              onPress={() => router.push(`/room/${room.id}/upload`)}
              style={styles.uploadCta}
            >
              <Ionicons name="camera" size={22} color={theme.colors.onBrand} />
              <View style={{ flex: 1 }}>
                <Text style={styles.uploadTitle}>Carica la tua schedina</Text>
                <Text style={styles.uploadSub}>Scatta lo screenshot da Staryes e caricalo qui</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={theme.colors.onBrand} />
            </Pressable>
          )}

          {room.is_admin && (
            <Pressable
              testID="admin-fixtures-btn"
              onPress={() => router.push(`/room/${room.id}/admin`)}
              style={styles.adminCta}
            >
              <Ionicons name="trophy" size={20} color={theme.colors.brand} />
              <Text style={styles.adminCtaText}>Pannello admin · Risultati partite</Text>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
            </Pressable>
          )}
        </View>

        {/* Tabs */}
        <View style={styles.segments}>
          <Pressable
            testID="tab-members"
            onPress={() => setTab('members')}
            style={[styles.segment, tab === 'members' && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, tab === 'members' && styles.segmentTextActive]}>
              Partecipanti ({members.length})
            </Text>
          </Pressable>
          <Pressable
            testID="tab-leaderboard"
            onPress={() => setTab('leaderboard')}
            style={[styles.segment, tab === 'leaderboard' && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, tab === 'leaderboard' && styles.segmentTextActive]}>
              Classifica
            </Text>
          </Pressable>
        </View>

        {tab === 'members' && (
          <View style={styles.list}>
            {members.map((m) => (
              <View key={m.nickname} style={styles.row}>
                <View style={[styles.avatar, { backgroundColor: room.color + '33' }]}>
                  <Text style={[styles.avatarText, { color: room.color }]}>
                    {m.nickname.slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{m.nickname}</Text>
                  {m.nickname === room.admin_nickname && (
                    <Text style={styles.rowSub}>Admin stanza</Text>
                  )}
                </View>
                {m.submitted ? (
                  <View style={styles.badgeOk}>
                    <Ionicons name="checkmark" size={14} color={theme.colors.accent} />
                    <Text style={styles.badgeOkText}>Consegnata</Text>
                  </View>
                ) : (
                  <View style={styles.badgePending}>
                    <Text style={styles.badgePendingText}>In attesa</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {tab === 'leaderboard' && (
          <View style={styles.list}>
            {!hasResults ? (
              <View style={styles.empty}>
                <Ionicons name="hourglass" size={40} color={theme.colors.muted} />
                <Text style={styles.emptyTitle}>Risultati non ancora inseriti</Text>
                <Text style={styles.emptySub}>
                  L&apos;admin deve caricare i risultati delle partite per calcolare la classifica.
                </Text>
              </View>
            ) : leaderboard.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Nessuna schedina consegnata</Text>
              </View>
            ) : (
              leaderboard.map((row, idx) => {
                const isLoser = idx === leaderboard.length - 1;
                return (
                  <View key={row.nickname} style={[styles.row, isLoser && styles.rowLoser]}>
                    <Text style={styles.rank}>{row.rank}</Text>
                    <View style={[styles.avatar, { backgroundColor: room.color + '33' }]}>
                      <Text style={[styles.avatarText, { color: room.color }]}>
                        {row.nickname.slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName}>{row.nickname}</Text>
                      <Text style={styles.rowSub}>
                        {row.won_count}/{row.events_count} azzeccate
                      </Text>
                    </View>
                    {idx === 0 && row.total > 0 && (
                      <Ionicons name="trophy" size={20} color={theme.colors.brand} style={{ marginRight: 6 }} />
                    )}
                    {isLoser && (
                      <Ionicons name="beer" size={20} color={theme.colors.warning} style={{ marginRight: 6 }} />
                    )}
                    <Text style={[styles.rowScore, { color: room.color }]}>{row.total.toFixed(2)}</Text>
                  </View>
                );
              })
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  roomName: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  roomMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  hero: {
    margin: theme.spacing.lg,
    padding: theme.spacing.xl,
    borderRadius: theme.radius.lg,
    alignItems: 'center',
    borderWidth: 1,
    gap: 4,
  },
  heroLabel: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
  },
  heroCode: {
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: 8,
  },
  heroSub: { color: theme.colors.onSurfaceSecondary, fontSize: 13 },
  uploadCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.brand,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
  },
  uploadTitle: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 15 },
  uploadSub: { color: theme.colors.onBrand, fontSize: 12, opacity: 0.85 },
  doneCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  doneTitle: { color: theme.colors.onSurface, fontWeight: '800' },
  doneSub: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  adminCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  adminCtaText: { flex: 1, color: theme.colors.onSurface, fontWeight: '700' },
  segments: {
    flexDirection: 'row',
    marginTop: theme.spacing.lg,
    marginHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceSecondary,
    padding: 4,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  segment: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: theme.radius.sm },
  segmentActive: { backgroundColor: theme.colors.brand },
  segmentText: { color: theme.colors.onSurfaceSecondary, fontWeight: '700', fontSize: 13 },
  segmentTextActive: { color: theme.colors.onBrand, fontWeight: '800' },
  list: { padding: theme.spacing.lg, gap: theme.spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowLoser: { borderColor: theme.colors.warning },
  rank: {
    color: theme.colors.onSurface,
    fontWeight: '800',
    fontSize: 18,
    width: 22,
    textAlign: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontWeight: '800', fontSize: 12 },
  rowName: { color: theme.colors.onSurface, fontWeight: '700' },
  rowSub: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  rowScore: { fontSize: 20, fontWeight: '800' },
  badgeOk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.colors.accent + '22',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
  },
  badgeOkText: { color: theme.colors.accent, fontWeight: '800', fontSize: 11 },
  badgePending: {
    backgroundColor: theme.colors.surfaceTertiary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
  },
  badgePendingText: { color: theme.colors.muted, fontSize: 11, fontWeight: '700' },
  empty: { alignItems: 'center', padding: theme.spacing.xxl, gap: 8 },
  emptyTitle: { color: theme.colors.onSurface, fontWeight: '800', marginTop: 8 },
  emptySub: { color: theme.colors.muted, textAlign: 'center', fontSize: 13 },
});
