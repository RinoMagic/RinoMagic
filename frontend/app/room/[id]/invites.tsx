import { useCallback, useEffect, useState } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { confirmDialog } from '@/src/utils/confirm';

type Room = {
  id: string;
  name: string;
  color: string;
  matchday: number;
};

type Invite = {
  id: string;
  code: string;
  used_by_user_id: string | null;
  used_by_nickname: string | null;
  used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

function appBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_BACKEND_URL?.replace(/\/api\/?$/, '');
  if (raw) return raw;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

export default function InvitesManagement() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [r, list] = await Promise.all([
        api<Room>(`/rooms/${id}`),
        api<Invite[]>(`/rooms/${id}/invites`),
      ]);
      setRoom(r);
      setInvites(list);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const generateInvite = async () => {
    if (!room || creating) return;
    setCreating(true);
    setError(null);
    try {
      const newInvite = await api<Invite>(`/rooms/${room.id}/invites`, {
        method: 'POST',
      });
      setInvites((prev) => [...prev, newInvite]);
      // Auto-copy link for the new invite
      const link = `${appBaseUrl()}/invite/${newInvite.code}`;
      if (Platform.OS === 'web') {
        try {
          await (navigator as any).clipboard?.writeText(link);
          setFlash('Nuovo codice generato e link copiato!');
        } catch {
          setFlash('Nuovo codice generato');
        }
      } else {
        setFlash('Nuovo codice generato');
      }
      setTimeout(() => setFlash(null), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const copyOrShare = async (invite: Invite) => {
    if (!room) return;
    const link = `${appBaseUrl()}/invite/${invite.code}`;
    const message = `Sei stato invitato in TheBestTiket · stanza "${room.name}"!\nCodice: ${invite.code}\n${link}`;
    if (Platform.OS === 'web') {
      try {
        await (navigator as any).clipboard?.writeText(link);
        setFlash(`Link copiato: ${invite.code}`);
        setTimeout(() => setFlash(null), 2500);
      } catch {
        if (typeof window !== 'undefined') window.alert(link);
      }
      return;
    }
    try {
      await Share.share({ message });
    } catch {}
  };

  const revokeInvite = async (invite: Invite) => {
    const ok = await confirmDialog(
      'Revoca invito',
      `Revocare il codice ${invite.code}? Non potrà più essere utilizzato.`,
      { destructive: true }
    );
    if (!ok) return;
    try {
      await api(`/rooms/${id}/invites/${invite.id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (loading || !room) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.brand} />
      </View>
    );
  }

  const available = invites.filter((i) => !i.used_by_user_id && !i.revoked_at);
  const used = invites.filter((i) => i.used_by_user_id);
  const revoked = invites.filter((i) => i.revoked_at && !i.used_by_user_id);

  return (
    <View style={styles.wrap}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: room.color + '22' }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="invites-back">
            <Ionicons name="chevron-back" size={26} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Gestione inviti</Text>
            <Text style={styles.sub} numberOfLines={1}>
              {room.name}
            </Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120, gap: theme.spacing.md }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.brand} />
        }
      >
        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={20} color={theme.colors.brand} />
          <Text style={styles.infoText}>
            Ogni codice invito è valido per un solo giocatore. Una volta usato non può essere riutilizzato.
            Genera un nuovo codice per ogni persona che vuoi invitare.
          </Text>
        </View>

        <View style={styles.statsRow}>
          <View style={[styles.statBox, { borderColor: theme.colors.brand }]}>
            <Text style={[styles.statValue, { color: theme.colors.brand }]}>{available.length}</Text>
            <Text style={styles.statLabel}>Disponibili</Text>
          </View>
          <View style={[styles.statBox, { borderColor: theme.colors.accent }]}>
            <Text style={[styles.statValue, { color: theme.colors.accent }]}>{used.length}</Text>
            <Text style={styles.statLabel}>Utilizzati</Text>
          </View>
          <View style={[styles.statBox, { borderColor: theme.colors.muted }]}>
            <Text style={[styles.statValue, { color: theme.colors.muted }]}>{revoked.length}</Text>
            <Text style={styles.statLabel}>Revocati</Text>
          </View>
        </View>

        <Pressable
          testID="generate-invite-btn"
          onPress={generateInvite}
          disabled={creating}
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: room.color },
            (creating || pressed) && { opacity: 0.7 },
          ]}
        >
          {creating ? (
            <ActivityIndicator color={theme.colors.onBrand} />
          ) : (
            <>
              <Ionicons name="add-circle" size={22} color={theme.colors.onBrand} />
              <Text style={styles.ctaText}>Genera nuovo codice invito</Text>
            </>
          )}
        </Pressable>

        {flash && (
          <View style={styles.flash}>
            <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />
            <Text style={styles.flashText}>{flash}</Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color={theme.colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {available.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Disponibili · {available.length}</Text>
            {available.map((inv) => (
              <InviteCard
                key={inv.id}
                invite={inv}
                color={room.color}
                onCopy={() => copyOrShare(inv)}
                onRevoke={() => revokeInvite(inv)}
              />
            ))}
          </View>
        )}

        {used.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Utilizzati · {used.length}</Text>
            {used.map((inv) => (
              <InviteCard key={inv.id} invite={inv} color={room.color} />
            ))}
          </View>
        )}

        {revoked.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Revocati · {revoked.length}</Text>
            {revoked.map((inv) => (
              <InviteCard key={inv.id} invite={inv} color={room.color} />
            ))}
          </View>
        )}

        {invites.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="mail-outline" size={40} color={theme.colors.muted} />
            <Text style={styles.emptyTitle}>Nessun codice generato</Text>
            <Text style={styles.emptySub}>
              Premi il pulsante sopra per creare il primo invito.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function InviteCard({
  invite,
  color,
  onCopy,
  onRevoke,
}: {
  invite: Invite;
  color: string;
  onCopy?: () => void;
  onRevoke?: () => void;
}) {
  const isUsed = !!invite.used_by_user_id;
  const isRevoked = !!invite.revoked_at && !isUsed;
  const status = isUsed ? 'used' : isRevoked ? 'revoked' : 'available';

  return (
    <View
      style={[
        styles.card,
        status === 'available' && { borderColor: color },
        status === 'used' && { borderColor: theme.colors.accent, opacity: 0.85 },
        status === 'revoked' && { borderColor: theme.colors.muted, opacity: 0.6 },
      ]}
      testID={`invite-card-${invite.code}`}
    >
      <View style={styles.cardTop}>
        <Text
          style={[
            styles.code,
            status === 'available' && { color },
            status === 'used' && { color: theme.colors.onSurface, textDecorationLine: 'line-through' },
            status === 'revoked' && { color: theme.colors.muted, textDecorationLine: 'line-through' },
          ]}
        >
          {invite.code}
        </Text>
        <View
          style={[
            styles.statusPill,
            status === 'available' && { backgroundColor: color + '22' },
            status === 'used' && { backgroundColor: theme.colors.accent + '22' },
            status === 'revoked' && { backgroundColor: theme.colors.surfaceTertiary },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              status === 'available' && { color },
              status === 'used' && { color: theme.colors.accent },
              status === 'revoked' && { color: theme.colors.muted },
            ]}
          >
            {status === 'available' ? 'DISPONIBILE' : status === 'used' ? 'UTILIZZATO' : 'REVOCATO'}
          </Text>
        </View>
      </View>
      {isUsed && (
        <Text style={styles.usedBy}>
          Usato da{' '}
          <Text style={{ color: theme.colors.onSurface, fontWeight: '800' }}>
            {invite.used_by_nickname || '?'}
          </Text>
        </Text>
      )}
      {status === 'available' && onCopy && onRevoke && (
        <View style={styles.actionsRow}>
          <Pressable
            testID={`copy-invite-${invite.code}`}
            onPress={onCopy}
            style={[styles.actionBtn, { backgroundColor: color }]}
          >
            <Ionicons name="copy" size={16} color={theme.colors.onBrand} />
            <Text style={styles.actionBtnText}>
              {Platform.OS === 'web' ? 'Copia link' : 'Condividi link'}
            </Text>
          </Pressable>
          <Pressable
            testID={`revoke-invite-${invite.code}`}
            onPress={onRevoke}
            style={[styles.actionBtn, styles.actionBtnGhost]}
          >
            <Ionicons name="trash-outline" size={16} color={theme.colors.error} />
            <Text style={[styles.actionBtnText, { color: theme.colors.error }]}>Revoca</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  sub: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },

  infoBox: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.brand + '15',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.brand + '55',
  },
  infoText: { flex: 1, color: theme.colors.onSurface, fontSize: 12, lineHeight: 18 },

  statsRow: { flexDirection: 'row', gap: theme.spacing.sm },
  statBox: {
    flex: 1,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceSecondary,
  },
  statValue: { fontSize: 26, fontWeight: '800' },
  statLabel: { color: theme.colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    height: 52,
    borderRadius: theme.radius.md,
  },
  ctaText: { color: theme.colors.onBrand, fontWeight: '800', fontSize: 15 },

  flash: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.success + '22',
  },
  flashText: { color: theme.colors.success, fontSize: 12, fontWeight: '700', flex: 1 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.error + '22',
  },
  errorText: { color: theme.colors.error, fontSize: 12, fontWeight: '700', flex: 1 },

  section: { gap: theme.spacing.sm },
  sectionTitle: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: theme.spacing.sm,
  },
  card: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: theme.spacing.sm,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  code: { fontSize: 22, fontWeight: '800', letterSpacing: 4 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  usedBy: { color: theme.colors.muted, fontSize: 12 },
  actionsRow: { flexDirection: 'row', gap: theme.spacing.sm },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: theme.radius.sm,
  },
  actionBtnGhost: {
    backgroundColor: theme.colors.error + '15',
    borderWidth: 1,
    borderColor: theme.colors.error + '55',
  },
  actionBtnText: { color: theme.colors.onBrand, fontWeight: '700', fontSize: 13 },
  empty: { alignItems: 'center', padding: theme.spacing.xxl, gap: 8 },
  emptyTitle: { color: theme.colors.onSurface, fontWeight: '800', marginTop: 8 },
  emptySub: { color: theme.colors.muted, textAlign: 'center', fontSize: 13 },
});
