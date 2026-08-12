/*
 * Shared modal that renders a Survival participant's picks grouped by
 * matchday, mirroring the "Test bigmach" leaderboard-click experience.
 *
 * Used by:
 *   • /surviva/[id]              — live tournament leaderboard row → picks
 *   • /surviva/[id]/history      — archived tournament leaderboard row → picks
 */
import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, ScrollView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

const COLOR = '#EF4444';

export type SurvivaLeaderboardRow = {
  user_id: string;
  nickname: string;
  lives_left: number;
  eliminated: boolean;
  rank: number;
};

type ParticipantPickRow = {
  matchday: number;
  matchday_id: string;
  status: string;
  settled: boolean;
  deadline_passed: boolean;
  hidden: boolean;
  big_match_bonus_won?: boolean;
  picks?: {
    home_team: string;
    away_team: string;
    pick: '1' | 'X' | '2';
    correct?: boolean | null;
    concession?: boolean;
    is_lock?: boolean;
  }[];
};

type ParticipantPicksResp = {
  participant: {
    user_id: string;
    display_name: string | null;
    lives_left: number;
    eliminated_at: string | null;
    locked_teams: string[];
  };
  matchdays: ParticipantPickRow[];
};

export function SurvivaPicksModal({
  tid, row, onClose,
}: {
  tid: string;
  row: SurvivaLeaderboardRow | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<ParticipantPicksResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!row) return;
    let alive = true;
    setData(null); setErr(null);
    api<ParticipantPicksResp>(
      `/sv/tournaments/${tid}/participants/${row.user_id}/picks`,
    )
      .then((r) => { if (alive) setData(r); })
      .catch((e: any) => { if (alive) setErr(e.message || 'Errore'); });
    return () => { alive = false; };
  }, [tid, row]);

  return (
    <Modal
      visible={!!row}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{row?.nickname ?? ''}</Text>
              <Text style={styles.sub}>
                {row ? `#${row.rank} · ${row.lives_left} ${row.lives_left === 1 ? 'vita' : 'vite'}${row.eliminated ? ' · Eliminato' : ''}` : ''}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} testID="sv-modal-close">
              <Ionicons name="close" size={24} color={theme.colors.onSurface} />
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 520 }}
            contentContainerStyle={{ padding: theme.spacing.md, gap: theme.spacing.sm }}
          >
            {err && (
              <View style={[styles.notice, { borderColor: theme.colors.error + '55' }]}>
                <Ionicons name="alert-circle" size={16} color={theme.colors.error} />
                <Text style={[styles.noticeText, { color: theme.colors.error }]}>{err}</Text>
              </View>
            )}
            {!data && !err && <ActivityIndicator color={COLOR} />}
            {data && data.matchdays.length === 0 && (
              <Text style={styles.muted}>Nessuna giornata giocata.</Text>
            )}
            {data && data.matchdays.map((md) => (
              <View key={md.matchday_id} style={styles.mdBlock}>
                <View style={styles.mdBlockHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                    <Text style={styles.mdBlockTitle}>Giornata {md.matchday}</Text>
                    {md.big_match_bonus_won && (
                      <View
                        style={styles.bonusGiftBadge}
                        accessibilityLabel="Big Match Bonus vinto: +1 vita"
                      >
                        <Text style={styles.bonusGiftEmoji}>🎁</Text>
                      </View>
                    )}
                  </View>
                  <View style={[
                    styles.mdBlockBadge,
                    md.settled && { backgroundColor: theme.colors.success + '22' },
                  ]}>
                    <Text style={[
                      styles.mdBlockBadgeText,
                      md.settled && { color: theme.colors.success },
                    ]}>
                      {md.settled ? 'Calcolata' : md.deadline_passed ? 'Chiusa' : 'Aperta'}
                    </Text>
                  </View>
                </View>
                {md.hidden ? (
                  <View style={styles.hiddenBox}>
                    <Ionicons name="eye-off" size={14} color={theme.colors.muted} />
                    <Text style={styles.hiddenText}>
                      Pronostici nascosti finché il timer non scade
                    </Text>
                  </View>
                ) : (md.picks && md.picks.length > 0) ? (
                  md.picks.map((p, i) => {
                    const outcome = md.settled
                      ? (p.correct === true ? 'ok' : p.correct === false ? 'ko' : 'na')
                      : 'na';
                    return (
                      <View key={i} style={styles.pickRow}>
                        <Text style={styles.pickTeams} numberOfLines={1}>
                          {p.home_team} - {p.away_team}
                        </Text>
                        <View style={[
                          styles.pickSign,
                          outcome === 'ok' && { backgroundColor: theme.colors.success + '22', borderColor: theme.colors.success },
                          outcome === 'ko' && { backgroundColor: theme.colors.error + '22', borderColor: theme.colors.error },
                        ]}>
                          <Text style={styles.pickSignText}>{p.pick}</Text>
                        </View>
                        <View style={{ width: 24, alignItems: 'center', justifyContent: 'center' }}>
                          {outcome === 'ok' && <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />}
                          {outcome === 'ko' && (
                            <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
                              <Ionicons name="heart" size={20} color={theme.colors.error} />
                              <Ionicons name="close" size={12} color="#fff" style={{ position: 'absolute' }} />
                            </View>
                          )}
                          {outcome === 'na' && <Ionicons name="time" size={16} color={theme.colors.muted} />}
                        </View>
                      </View>
                    );
                  })
                ) : (
                  <Text style={styles.muted}>Nessuna scelta inviata.</Text>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    maxHeight: '85%' as any,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: { color: theme.colors.onSurface, fontSize: 17, fontWeight: '800' },
  sub: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  muted: { color: theme.colors.muted, fontSize: 13, fontStyle: 'italic' },
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  noticeText: { color: theme.colors.onSurface, flex: 1, fontSize: 12 },
  mdBlock: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 6,
  },
  mdBlockHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  mdBlockTitle: { color: theme.colors.onSurface, fontSize: 13, fontWeight: '800' },
  mdBlockBadge: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceTertiary,
  },
  mdBlockBadgeText: { color: theme.colors.muted, fontSize: 10, fontWeight: '800' },
  hiddenBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: 8,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceTertiary,
  },
  hiddenText: { color: theme.colors.muted, fontSize: 11, fontStyle: 'italic' },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 4,
  },
  pickTeams: { flex: 1, color: theme.colors.onSurface, fontSize: 12 },
  pickSign: {
    minWidth: 26, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border,
    alignItems: 'center',
  },
  pickSignText: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 12 },
  bonusGiftBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    backgroundColor: '#F59E0B22',
    borderWidth: 1,
    borderColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bonusGiftEmoji: { fontSize: 12, lineHeight: 16 },
});
