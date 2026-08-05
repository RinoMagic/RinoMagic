/*
 * ScoreAndLive — home.
 *
 * Design (after the auto-progression refactor):
 *  - No manual "Crea nuovo torneo" form: tournaments are auto-created by the
 *    server as soon as a previous round ends (0/1 survivors) or when a new
 *    season calendar is imported.
 *  - Users see the LIVE tournaments they are part of (or admin of) at the
 *    top, and a permanent "Archivio" section at the bottom listing every
 *    finished tournament with its winner (visible to everyone).
 *  - Anyone can tap an archived tournament to inspect its picks history.
 */
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session } from '@/src/api';
import { theme } from '@/src/theme';
import { confirmDialog } from '@/src/utils/confirm';

const COLOR = '#3B82F6'; // ScoreAndLive azzurro (hub)

type T = {
  id: string; name: string; status: string; is_admin: boolean;
  participants_total: number; participants_alive: number;
  initial_lives: number; invite_code: string;
  season?: string; start_matchday?: number;
};

type Archived = {
  id: string; name: string; season: string; start_matchday: number;
  created_at: string; finished_at: string | null;
  winner_user_id: string | null; winner_nickname: string | null;
  participants_total: number; settled_matchdays: number;
};

export default function ScoreAndLiveHome() {
  const router = useRouter();
  const [items, setItems] = useState<T[]>([]);
  const [archive, setArchive] = useState<Archived[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [showArchive, setShowArchive] = useState(false);
  const [role, setRole] = useState<'admin' | 'player' | null>(null);
  // Admin: create tournament modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLives, setNewLives] = useState('3');
  const [newSeason, setNewSeason] = useState('2026-27');
  const [newStartMd, setNewStartMd] = useState('1');
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const s = await session.load();
      setRole(s.user?.role === 'admin' ? 'admin' : 'player');
      const [list, arch] = await Promise.all([
        api<T[]>('/sal/tournaments'),
        api<Archived[]>('/sal/tournaments/archive/list'),
      ]);
      setItems(list);
      setArchive(arch);
    } catch (e: any) { alert(e.message); }
    finally { setLoading(false); }
  };
  useFocusEffect(useCallback(() => { load(); }, []));

  const doJoin = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    try {
      const preview = await api<{ id: string }>(`/sal/tournaments/by-code/${code}`, { auth: false });
      await api(`/sal/tournaments/${preview.id}/join`, { method: 'POST', body: { invite_code: code } });
      setJoinCode(''); await load();
    } catch (e: any) { alert(e.message); }
  };

  const deleteTournament = async (t: T) => {
    if (!await confirmDialog(
      'Elimina torneo',
      `Sicuro di eliminare "${t.name}"? Verranno cancellati tutti i partecipanti, le giornate e i pronostici. L'azione è irreversibile.`,
      { destructive: true, confirmLabel: 'Elimina' },
    )) return;
    try {
      await api(`/sal/tournaments/${t.id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) { alert(e.message || 'Errore eliminazione'); }
  };

  const deleteArchived = async (a: Archived) => {
    if (!await confirmDialog(
      'Elimina torneo archiviato',
      `Attenzione: stai per cancellare "${a.name}" con TUTTO lo storico (${a.settled_matchdays} giornate, ${a.participants_total} partecipanti). Sicuro?`,
      { destructive: true, confirmLabel: 'Continua' },
    )) return;
    if (!await confirmDialog(
      'Conferma DEFINITIVA',
      'Ultima conferma: perderai per sempre ogni traccia di questo torneo dallo storico. Procedere?',
      { destructive: true, confirmLabel: 'ELIMINA per sempre' },
    )) return;
    try {
      await api(`/sal/tournaments/${a.id}?force=true`, { method: 'DELETE' });
      await load();
    } catch (e: any) { alert(e.message || 'Errore'); }
  };

  const doCreate = async () => {
    const name = newName.trim();
    const lives = parseInt(newLives || '3', 10);
    const startMd = parseInt(newStartMd || '1', 10);
    if (!name) return alert('Inserisci un nome per il torneo');
    if (isNaN(lives) || lives < 1 || lives > 10) {
      return alert('Le vite iniziali devono essere tra 1 e 10');
    }
    if (isNaN(startMd) || startMd < 1 || startMd > 38) {
      return alert('La giornata di partenza deve essere tra 1 e 38');
    }
    setCreating(true);
    try {
      await api('/sal/tournaments', {
        method: 'POST',
        body: {
          name,
          initial_lives: lives,
          season: newSeason.trim() || '2026-27',
          start_matchday: startMd,
        },
      });
      setCreateOpen(false);
      setNewName('');
      setNewLives('3');
      setNewStartMd('1');
      await load();
    } catch (e: any) {
      alert(e.message || 'Errore creazione torneo');
    } finally {
      setCreating(false);
    }
  };

  const activeItems = items.filter((t) => t.status !== 'finished');
  const isAdmin = role === 'admin';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.replace('/hub')} hitSlop={12}>
            <Ionicons name="home" size={22} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>ScoreAndLive</Text>
            <Text style={styles.subtitle}>Sopravvivi indovinando marcatori</Text>
          </View>
          {isAdmin && (
            <Pressable onPress={() => router.push('/calendar-admin')} hitSlop={12}>
              <Ionicons name="calendar" size={22} color={COLOR} />
            </Pressable>
          )}
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {loading ? <ActivityIndicator color={COLOR} /> : (
          <>
            {!isAdmin && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Iscriviti con codice</Text>
                <TextInput style={styles.input} placeholder="Codice invito"
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="characters" value={joinCode} onChangeText={setJoinCode} />
                <Pressable style={[styles.cta, { backgroundColor: COLOR }]} onPress={doJoin}>
                  <Ionicons name="log-in" size={18} color="#fff" />
                  <Text style={styles.ctaText}>Entra</Text>
                </Pressable>
              </View>
            )}

            {isAdmin && (
              <View style={[styles.card, { backgroundColor: COLOR + '18', borderColor: COLOR + '55', borderWidth: 1 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="flash" size={18} color={COLOR} />
                  <Text style={[styles.cardTitle, { flex: 1, color: COLOR }]}>Gestione tornei</Text>
                </View>
                <Text style={styles.hint}>
                  Crea manualmente il primo torneo di una stagione. I round successivi vengono generati automaticamente quando l&apos;ultimo sopravvissuto è decretato (nuovo codice invito univoco).
                </Text>
                <Pressable
                  style={[styles.cta, { backgroundColor: COLOR }]}
                  onPress={() => setCreateOpen(true)}
                  testID="sal-create-tournament"
                >
                  <Ionicons name="add-circle" size={18} color="#fff" />
                  <Text style={styles.ctaText}>Crea nuovo torneo</Text>
                </Pressable>
              </View>
            )}

            <Text style={styles.section}>Tornei attivi ({activeItems.length})</Text>
            {activeItems.length === 0 && (
              <Text style={styles.muted}>Nessun torneo attivo al momento.</Text>
            )}
            {activeItems.map((t) => (
              <View key={t.id} style={[styles.tCard, { borderColor: COLOR + '55' }]}>
                <Pressable
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
                  onPress={() => router.push(`/scoreandlive/${t.id}`)}
                  testID={`sal-t-${t.id}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tName}>{t.name}</Text>
                    <Text style={styles.tMeta}>
                      {t.participants_alive}/{t.participants_total} vivi · {t.initial_lives} vite iniziali
                      {t.is_admin ? ' · admin' : ''}
                    </Text>
                  </View>
                </Pressable>
                {t.is_admin && (
                  <Pressable onPress={() => deleteTournament(t)} hitSlop={10}
                    testID={`sal-delete-${t.id}`} style={styles.trash}>
                    <Ionicons name="trash" size={18} color={theme.colors.error} />
                  </Pressable>
                )}
                <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
              </View>
            ))}

            <Pressable
              style={[styles.archiveToggle]}
              onPress={() => setShowArchive((v) => !v)}
              testID="sal-archive-toggle"
            >
              <Ionicons name={showArchive ? 'chevron-down' : 'chevron-forward'} size={18} color={theme.colors.onSurface} />
              <Text style={styles.section}>Archivio storico ({archive.length})</Text>
            </Pressable>

            {showArchive && archive.length === 0 && (
              <Text style={styles.muted}>Nessun torneo concluso ancora.</Text>
            )}
            {showArchive && archive.map((a) => (
              <View key={a.id} style={styles.aCard}>
                <Pressable
                  style={{ flex: 1 }}
                  onPress={() => router.push(`/scoreandlive/${a.id}/history`)}
                  testID={`sal-archived-${a.id}`}
                >
                  <Text style={styles.aName}>{a.name}</Text>
                  <Text style={styles.aMeta}>
                    🏆 {a.winner_nickname || 'Nessun vincitore'} · G{a.start_matchday}+ · {a.settled_matchdays} giornate
                  </Text>
                  <Text style={styles.aDate}>
                    Concluso {a.finished_at ? new Date(a.finished_at).toLocaleDateString('it-IT') : '—'}
                  </Text>
                </Pressable>
                {isAdmin && (
                  <Pressable onPress={() => deleteArchived(a)} hitSlop={10} style={styles.trash}>
                    <Ionicons name="trash" size={16} color={theme.colors.error} />
                  </Pressable>
                )}
                <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* Admin: Create tournament modal */}
      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Nuovo torneo ScoreAndLive</Text>
              <Pressable onPress={() => setCreateOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={theme.colors.onSurface} />
              </Pressable>
            </View>
            <View style={styles.modalBody}>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Nome torneo</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Es. Round 1"
                  placeholderTextColor={theme.colors.muted}
                  value={newName}
                  onChangeText={setNewName}
                  testID="sal-new-name"
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>Vite iniziali</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="number-pad"
                    value={newLives}
                    onChangeText={setNewLives}
                    testID="sal-new-lives"
                  />
                </View>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>Giornata partenza</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="number-pad"
                    value={newStartMd}
                    onChangeText={setNewStartMd}
                    testID="sal-new-md"
                  />
                </View>
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Stagione</Text>
                <TextInput
                  style={styles.input}
                  value={newSeason}
                  onChangeText={setNewSeason}
                />
              </View>
              <Text style={styles.hint}>
                Alla creazione viene emesso automaticamente un codice invito univoco. Dalla scheda torneo potrai generarne altri per iscrivere più giocatori.
              </Text>
              <Pressable
                disabled={creating}
                style={[styles.cta, { backgroundColor: COLOR }, creating && { opacity: 0.5 }]}
                onPress={doCreate}
                testID="sal-create-submit"
              >
                {creating ? <ActivityIndicator color="#fff" />
                  : <>
                      <Ionicons name="checkmark" size={18} color="#fff" />
                      <Text style={styles.ctaText}>Crea torneo</Text>
                    </>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md,
  },
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  body: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 48 },

  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md, gap: theme.spacing.sm,
  },
  cardTitle: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 15 },
  input: {
    backgroundColor: theme.colors.surface, borderWidth: 1,
    borderColor: theme.colors.border, borderRadius: theme.radius.sm,
    padding: theme.spacing.sm, color: theme.colors.onSurface,
  },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: theme.spacing.sm, paddingVertical: 10, borderRadius: theme.radius.pill,
  },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  section: {
    color: theme.colors.onSurface, fontWeight: '800',
    fontSize: 15, marginTop: theme.spacing.md,
  },
  muted: { color: theme.colors.muted, fontSize: 13, fontStyle: 'italic' },

  tCard: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md, borderWidth: 1, padding: theme.spacing.md,
  },
  tName: { color: theme.colors.onSurface, fontWeight: '800', fontSize: 15 },
  tMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  trash: {
    padding: 6, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.error + '15',
  },
  hint: {
    color: theme.colors.onSurfaceSecondary, fontSize: 12,
    fontStyle: 'italic', lineHeight: 16,
  },

  archiveToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: theme.spacing.md,
  },
  aCard: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  aName: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 14 },
  aMeta: { color: theme.colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  aDate: { color: theme.colors.muted, fontSize: 11, marginTop: 2, fontStyle: 'italic' },

  modalOverlay: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: '#00000099',
  },
  modalCard: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.lg, borderTopRightRadius: theme.radius.lg,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center',
    padding: theme.spacing.lg,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  modalTitle: { color: theme.colors.onSurface, fontSize: 17, fontWeight: '800', flex: 1 },
  modalBody: { padding: theme.spacing.lg, gap: theme.spacing.md },
  field: { gap: 6 },
  fieldLabel: {
    color: theme.colors.muted, fontSize: 11, fontWeight: '800',
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
});
