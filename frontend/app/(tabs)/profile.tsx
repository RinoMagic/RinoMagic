import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/context/AuthContext';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

type SystemInfo = {
  current_matchday: number;
  current_season: number;
  scheduler_enabled: boolean;
  scheduler_running: boolean;
  in_match_window: boolean;
  server_time_rome: string;
  last_scheduled_sync_at: string | null;
  last_scheduled_sync_count: number;
  last_scheduled_sync_error: string | null;
  api_votes_by_matchday: Record<string, number>;
};

const ADMIN_EMAIL = 'admin@fantagiornata.it';

export default function Profile() {
  const { user, signOut } = useAuth();
  const isAdmin = user?.email === ADMIN_EMAIL;
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [sysLoading, setSysLoading] = useState(false);
  const [sysMsg, setSysMsg] = useState<string | null>(null);

  const loadSys = async () => {
    if (!user) return;
    setSysLoading(true);
    try {
      const d = await api<SystemInfo>('/system');
      setSys(d);
    } catch {} finally {
      setSysLoading(false);
    }
  };

  useEffect(() => {
    loadSys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const changeMatchday = async (delta: number) => {
    if (!sys) return;
    const next = Math.max(1, Math.min(38, sys.current_matchday + delta));
    if (next === sys.current_matchday) return;
    try {
      await api('/system/matchday', { method: 'POST', body: { matchday: next } });
      await loadSys();
    } catch (e: any) {
      setSysMsg(e.message);
      setTimeout(() => setSysMsg(null), 3000);
    }
  };

  const toggleScheduler = async () => {
    if (!sys) return;
    try {
      await api('/system/scheduler', { method: 'POST', body: { enabled: !sys.scheduler_enabled } });
      await loadSys();
    } catch (e: any) {
      setSysMsg(e.message);
    }
  };

  const syncNow = async () => {
    setSysMsg(null);
    setSysLoading(true);
    try {
      const r = await api<{ votes_synced: number; matchday: number }>(
        '/system/sync-now',
        { method: 'POST' }
      );
      setSysMsg(`Sincronizzati ${r.votes_synced} voti giornata ${r.matchday}`);
    } catch (e: any) {
      setSysMsg(e.message || 'Errore sync');
    } finally {
      setSysLoading(false);
      await loadSys();
      setTimeout(() => setSysMsg(null), 4000);
    }
  };

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

        {isAdmin && sys && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sistema · Admin</Text>
            <View style={styles.card}>
              <View style={styles.sysRow}>
                <Text style={styles.sysLabel}>Giornata Serie A</Text>
                <View style={styles.stepper}>
                  <Pressable
                    testID="sys-md-minus"
                    onPress={() => changeMatchday(-1)}
                    style={styles.stepBtn}
                  >
                    <Ionicons name="remove" size={16} color={theme.colors.onSurface} />
                  </Pressable>
                  <Text testID="sys-current-md" style={styles.sysValue}>{sys.current_matchday}</Text>
                  <Pressable
                    testID="sys-md-plus"
                    onPress={() => changeMatchday(1)}
                    style={styles.stepBtn}
                  >
                    <Ionicons name="add" size={16} color={theme.colors.onSurface} />
                  </Pressable>
                </View>
              </View>

              <View style={[styles.sysRow, styles.sysRowDiv]}>
                <Text style={styles.sysLabel}>Stagione</Text>
                <Text style={styles.sysValue}>{sys.current_season}</Text>
              </View>

              <View style={[styles.sysRow, styles.sysRowDiv]}>
                <Text style={styles.sysLabel}>Scheduler</Text>
                <Pressable
                  testID="sys-scheduler-toggle"
                  onPress={toggleScheduler}
                  style={[
                    styles.toggle,
                    sys.scheduler_enabled && styles.toggleOn,
                  ]}
                >
                  <Text
                    style={[
                      styles.toggleText,
                      sys.scheduler_enabled && { color: theme.colors.onBrand },
                    ]}
                  >
                    {sys.scheduler_enabled ? 'ON' : 'OFF'}
                  </Text>
                </Pressable>
              </View>

              <View style={[styles.sysRow, styles.sysRowDiv]}>
                <Text style={styles.sysLabel}>Finestra partite</Text>
                <View style={[styles.dot, { backgroundColor: sys.in_match_window ? theme.colors.brand : theme.colors.muted }]} />
              </View>

              <View style={[styles.sysRow, styles.sysRowDiv]}>
                <Text style={styles.sysLabel}>Ora Roma</Text>
                <Text style={styles.sysHint}>{sys.server_time_rome}</Text>
              </View>

              <View style={[styles.sysRow, styles.sysRowDiv]}>
                <Text style={styles.sysLabel}>Ultimo sync</Text>
                <Text style={styles.sysHint}>
                  {sys.last_scheduled_sync_at ? new Date(sys.last_scheduled_sync_at).toLocaleString('it-IT') : 'Mai'}
                </Text>
              </View>

              {sys.last_scheduled_sync_error && (
                <Text style={styles.sysErr}>{sys.last_scheduled_sync_error}</Text>
              )}

              <Pressable
                testID="sys-sync-now"
                onPress={syncNow}
                disabled={sysLoading}
                style={[styles.syncNowBtn, sysLoading && { opacity: 0.5 }]}
              >
                {sysLoading ? (
                  <ActivityIndicator color={theme.colors.onBrand} size="small" />
                ) : (
                  <>
                    <Ionicons name="cloud-download" size={16} color={theme.colors.onBrand} />
                    <Text style={styles.syncNowText}>Sincronizza ora</Text>
                  </>
                )}
              </Pressable>
              {sysMsg && <Text style={styles.sysMsg}>{sysMsg}</Text>}
            </View>
          </View>
        )}

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
  sysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  sysRowDiv: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
  },
  sysLabel: { color: theme.colors.onSurfaceSecondary, fontSize: 14 },
  sysValue: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 16 },
  sysHint: { color: theme.colors.muted, fontSize: 12 },
  sysErr: {
    color: theme.colors.error,
    fontSize: 11,
    marginTop: theme.spacing.sm,
  },
  sysMsg: {
    color: theme.colors.brand,
    fontSize: 12,
    marginTop: theme.spacing.sm,
    textAlign: 'center',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.colors.surfaceTertiary,
    borderRadius: theme.radius.pill,
    padding: 4,
  },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggle: {
    minWidth: 56,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  toggleOn: {
    backgroundColor: theme.colors.brand,
    borderColor: theme.colors.brand,
  },
  toggleText: {
    color: theme.colors.onSurface,
    fontWeight: '800',
    fontSize: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  syncNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.brand,
    borderRadius: theme.radius.md,
  },
  syncNowText: { color: theme.colors.onBrand, fontWeight: '800' },
});
