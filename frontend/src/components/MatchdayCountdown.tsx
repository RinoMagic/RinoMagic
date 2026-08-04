/*
 * MatchdayCountdown — compact live countdown card used across the app.
 *
 * Fetches the current open matchday's deadline (from /api/deadlines/current)
 * and updates every second. Once the deadline elapses it shows the "locked"
 * badge so users know submissions are closed.
 *
 * Auto-refreshes the source every 60s to stay in sync when the admin bumps
 * the deadline.
 */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

type DeadlineInfo = {
  season: string;
  matchday: number | null;
  deadline_at: string | null;
  locked: boolean;
  server_now: string;
};

function fmtRemaining(diffMs: number): string {
  if (diffMs <= 0) return '0s';
  const totalS = Math.floor(diffMs / 1000);
  const days = Math.floor(totalS / 86400);
  const hours = Math.floor((totalS % 86400) / 3600);
  const mins = Math.floor((totalS % 3600) / 60);
  const secs = totalS % 60;
  if (days > 0) return `${days}g ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function fmtItalianDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('it-IT', {
      timeZone: 'Europe/Rome',
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

type Props = {
  season?: string;
  /**
   * When set, the countdown targets this specific matchday instead of the
   * global "next open". Useful inside a game-specific screen.
   */
  matchday?: number;
  compact?: boolean;
  onPress?: () => void;
};

export function MatchdayCountdown({
  season = '2026-27',
  matchday,
  compact = false,
  onPress,
}: Props) {
  const [info, setInfo] = useState<DeadlineInfo | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const url = matchday
          ? `/deadlines/${matchday}?season=${encodeURIComponent(season)}`
          : `/deadlines/current?season=${encodeURIComponent(season)}`;
        const d = await api<DeadlineInfo>(url);
        if (alive) { setInfo(d); setFailed(false); }
      } catch {
        if (alive) setFailed(true);
      }
    };
    load();
    const refreshId = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(refreshId); };
  }, [season, matchday]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (failed || !info) return null;
  if (!info.matchday || !info.deadline_at) {
    // No deadline configured — show a discreet hint for admins in the
    // parent screen; the component itself renders nothing to avoid clutter.
    return null;
  }

  const dlMs = new Date(info.deadline_at).getTime();
  const diff = dlMs - now;
  const locked = diff <= 0 || info.locked;

  const bg = locked ? theme.colors.error + '22' : theme.colors.brand + '22';
  const fg = locked ? theme.colors.error : theme.colors.brand;

  const Body = (
    <View style={[styles.wrap, { backgroundColor: bg, borderColor: fg + '55' }]}>
      <Ionicons
        name={locked ? 'lock-closed' : 'time'}
        size={compact ? 14 : 16}
        color={fg}
      />
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: fg }]} numberOfLines={1}>
          {locked
            ? `Giornata ${info.matchday} · Pronostici chiusi`
            : `Giornata ${info.matchday} · chiude tra ${fmtRemaining(diff)}`}
        </Text>
        {!compact && (
          <Text style={styles.sub} numberOfLines={1}>
            {fmtItalianDate(info.deadline_at)}
          </Text>
        )}
      </View>
    </View>
  );
  if (onPress) {
    return <Pressable onPress={onPress}>{Body}</Pressable>;
  }
  return Body;
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
  },
  label: { fontSize: 12, fontWeight: '800' },
  sub: { color: theme.colors.muted, fontSize: 10, fontWeight: '600', marginTop: 1 },
});
