import { useCallback, useMemo, useState } from 'react';
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
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session } from '@/src/api';
import { theme } from '@/src/theme';
import { formatPrediction } from '@/src/utils/predictions';

type Room = {
  id: string;
  name: string;
  matchday: number;
  max_events: number;
  color: string;
  invite_code: string;
  admin_user_id: string;
  status: string;
  members_count: number;
  is_admin: boolean;
};

type Member = { user_id: string; nickname: string; role: string; blocked: boolean; submitted: boolean };

type BreakdownItem = {
  home_team: string;
  away_team: string;
  prediction: string;
  odd: number;
  won: boolean;
  matched_fixture: string | null;
  score: string | null;
};

type LeaderEntry = {
  nickname: string;
  total: number;
  won_count: number;
  events_count: number;
  rank: number;
  breakdown: BreakdownItem[];
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
  const [selectedNick, setSelectedNick] = useState<string | null>(null);

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
    // Navigate to the role-appropriate home; keep the JWT so the user stays logged in.
    const s = await session.load();
    if (s.user?.role === 'admin') router.replace('/admin');
    else router.replace('/player');
  };

  const selectedEntry = useMemo(() => {
    if (!selectedNick) return null;
    return leaderboard.find((e) => e.nickname === selectedNick) || null;
  }, [selectedNick, leaderboard]);

  const openPlayerSchedina = (nickname: string, submitted: boolean) => {
    if (!submitted) return;
    setSelectedNick(nickname);
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
              <Pressable
                key={m.nickname}
                onPress={() => openPlayerSchedina(m.nickname, m.submitted)}
                disabled={!m.submitted}
                testID={`member-row-${m.nickname}`}
                style={({ pressed }) => [
                  styles.row,
                  pressed && m.submitted && { opacity: 0.7 },
                ]}
              >
                <View style={[styles.avatar, { backgroundColor: room.color + '33' }]}>
                  <Text style={[styles.avatarText, { color: room.color }]}>
                    {m.nickname.slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{m.nickname}</Text>
                  {m.role === 'admin' && (
                    <Text style={styles.rowSub}>Admin</Text>
                  )}
                </View>
                {m.submitted ? (
                  <>
                    <View style={styles.badgeOk}>
                      <Ionicons name="checkmark" size={14} color={theme.colors.accent} />
                      <Text style={styles.badgeOkText}>Consegnata</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
                  </>
                ) : (
                  <View style={styles.badgePending}>
                    <Text style={styles.badgePendingText}>In attesa</Text>
                  </View>
                )}
              </Pressable>
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
                  <Pressable
                    key={row.nickname}
                    testID={`leader-row-${row.nickname}`}
                    onPress={() => openPlayerSchedina(row.nickname, true)}
                    style={({ pressed }) => [
                      styles.row,
                      isLoser && styles.rowLoser,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
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
                  </Pressable>
                );
              })
            )}
          </View>
        )}
      </ScrollView>

      <PlayerSchedinaModal
        visible={!!selectedEntry}
        onClose={() => setSelectedNick(null)}
        entry={selectedEntry}
        hasResults={hasResults}
        color={room.color}
      />
    </View>
  );
}

function PlayerSchedinaModal({
  visible,
  onClose,
  entry,
  hasResults,
  color,
}: {
  visible: boolean;
  onClose: () => void;
  entry: LeaderEntry | null;
  hasResults: boolean;
  color: string;
}) {
  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            {entry && (
              <View style={[styles.avatar, styles.modalAvatar, { backgroundColor: color + '33' }]}>
                <Text style={[styles.avatarText, { color, fontSize: 14 }]}>
                  {entry.nickname.slice(0, 2).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>
                Schedina di {entry?.nickname || '—'}
              </Text>
              {entry && (
                <Text style={styles.modalSub}>
                  {hasResults
                    ? `${entry.won_count}/${entry.events_count} azzeccate · Punteggio ${entry.total.toFixed(2)}`
                    : `${entry.events_count} pronostici · In attesa dei risultati`}
                </Text>
              )}
            </View>
            <Pressable onPress={onClose} hitSlop={12} testID="close-schedina-modal">
              <Ionicons name="close" size={26} color={theme.colors.onSurface} />
            </Pressable>
          </View>

          <ScrollView
            style={{ maxHeight: '75%' }}
            contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}
          >
            {entry?.breakdown?.length ? (
              entry.breakdown.map((b, i) => {
                const evaluated = hasResults && b.matched_fixture;
                const isWin = !!b.won;
                const isLose = evaluated && !b.won;
                const borderColor = isWin
                  ? theme.colors.success
                  : isLose
                    ? theme.colors.error
                    : theme.colors.border;
                const bg = isWin
                  ? theme.colors.success + '18'
                  : isLose
                    ? theme.colors.error + '18'
                    : theme.colors.surfaceSecondary;
                return (
                  <View
                    key={`${b.home_team}-${b.away_team}-${i}`}
                    testID={`schedina-event-${i}`}
                    style={[
                      styles.eventCard,
                      { backgroundColor: bg, borderColor },
                    ]}
                  >
                    <View style={styles.eventRow}>
                      <Text style={styles.eventTeams} numberOfLines={2}>
                        {b.home_team} — {b.away_team}
                      </Text>
                      <View
                        style={[
                          styles.oddPill,
                          {
                            backgroundColor: isWin
                              ? theme.colors.success
                              : isLose
                                ? theme.colors.error
                                : theme.colors.surfaceTertiary,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.oddText,
                            {
                              color: isWin || isLose
                                ? '#FFFFFF'
                                : theme.colors.onSurface,
                            },
                          ]}
                        >
                          {b.odd.toFixed(2)}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.eventMeta}>
                      <View style={styles.predictionChip}>
                        <Text style={styles.predictionLabel}>Pronostico</Text>
                        <Text style={styles.predictionValue}>
                          {formatPrediction(b.prediction)}
                        </Text>
                      </View>
                      {evaluated ? (
                        <View style={styles.resultChip}>
                          <Ionicons
                            name={isWin ? 'checkmark-circle' : 'close-circle'}
                            size={16}
                            color={isWin ? theme.colors.success : theme.colors.error}
                          />
                          <Text
                            style={[
                              styles.resultText,
                              { color: isWin ? theme.colors.success : theme.colors.error },
                            ]}
                          >
                            {isWin ? 'AZZECCATA' : 'SBAGLIATA'}
                            {b.score ? ` · ${b.score}` : ''}
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.resultChip}>
                          <Ionicons
                            name="time-outline"
                            size={16}
                            color={theme.colors.muted}
                          />
                          <Text style={[styles.resultText, { color: theme.colors.muted }]}>
                            {hasResults ? 'Partita non trovata' : 'In attesa'}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Nessun pronostico</Text>
              </View>
            )}

            {entry && hasResults && (
              <View
                style={[
                  styles.totalCard,
                  {
                    borderColor: entry.total > 0 ? theme.colors.success : theme.colors.error,
                    backgroundColor:
                      (entry.total > 0 ? theme.colors.success : theme.colors.error) + '18',
                  },
                ]}
              >
                <Text style={styles.totalLabel}>Punteggio finale</Text>
                <Text
                  style={[
                    styles.totalValue,
                    { color: entry.total > 0 ? theme.colors.success : theme.colors.error },
                  ]}
                >
                  {entry.total > 0
                    ? `× ${entry.total.toFixed(2)}`
                    : '0 (nessuna azzeccata)'}
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
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

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  modalAvatar: { width: 44, height: 44, borderRadius: 22 },
  modalTitle: { color: theme.colors.onSurface, fontSize: 16, fontWeight: '800' },
  modalSub: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  eventCard: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: theme.spacing.sm,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  eventTeams: {
    flex: 1,
    color: theme.colors.onSurface,
    fontWeight: '800',
    fontSize: 14,
  },
  oddPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    minWidth: 60,
    alignItems: 'center',
  },
  oddText: { fontWeight: '800', fontSize: 14 },
  eventMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.sm,
    flexWrap: 'wrap',
  },
  predictionChip: {
    flex: 1,
    minWidth: 140,
  },
  predictionLabel: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  predictionValue: {
    color: theme.colors.onSurface,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  resultChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  resultText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  totalCard: {
    marginTop: theme.spacing.sm,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.md,
    borderWidth: 2,
    alignItems: 'center',
  },
  totalLabel: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  totalValue: {
    fontSize: 28,
    fontWeight: '800',
    marginTop: 4,
  },
});
