/*
 * Surviva 2.0 — home.
 *
 * Layout mirrors ScoreAndLive:
 *  - Header with home button + title + admin actions
 *  - Active tournaments (with "join by code" for players, create modal for admins)
 *  - Archive of finished tournaments (visible to everyone)
 *
 * Rules recap:
 *  - Each player starts with N lives (default 3).
 *  - Every matchday the player picks ONE fixture and predicts 1/X/2.
 *  - Wrong pick → -1 life. Correct pick → the team+outcome combo becomes
 *    permanently blocked (e.g. after guessing "Inter → Vittoria", the player
 *    cannot pick that outcome for Inter again, whether home or away).
 *  - 0 lives ⇒ eliminated. Auto-progression to the next matchday.
 */
import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  TextInput, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, session } from '@/src/api';
import { theme } from '@/src/theme';
import { confirmDialog } from '@/src/utils/confirm';

const COLOR = '#EF4444'; // Surviva 2.0 red

type T = {
  id: string;
  name: string;
  status: string;
  is_admin: boolean;
  joined: boolean;
  players_total: number;
  players_alive: number;
  initial_lives: number;
  current_matchday: number;
  invite_code: string;
  season?: string;
  finished_at?: string | null;
};

export default function SurvivaHome() {
  const router = useRouter();
  const [items, setItems] = useState<T[]>([]);
  const [archive, setArchive] = useState<T[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [showArchive, setShowArchive] = useState(false);
  const [role, setRole] = useState<'admin' | 'player' | null>(null);

  // Create tournament (admin)
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
        api<T[]>('/sv/tournaments'),
        api<T[]>('/sv/tournaments/history'),
      ]);
      setItems(list.filter((t) => t.status !== 'finished'));
      setArchive(arch);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };
  useFocusEffect(useCallback(() => { load(); }, []));

  const doJoin = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    try {
      await api('/sv/tournaments/join', {
        method: 'POST',
        body: { invite_code: code },
      });
      setJoinCode('');
      await load();
    } catch (e: any) {
      alert(e.message);
    }
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
      await api('/sv/tournaments', {
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
      alert(e.message);
    } finally {
      setCreating(false);
    }
  };

  const deleteTournament = async (t: T) => {
    if (!await confirmDialog(
      'Elimina torneo',
      `Sicuro di eliminare "${t.name}"? Verranno cancellati partecipanti, giornate e pronostici.`,
      { destructive: true, confirmLabel: 'Elimina' },
    )) return;
    try {
      await api(`/sv/tournaments/${t.id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      alert(e.message || 'Errore eliminazione');
    }
  };

  const isAdmin = role === 'admin';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.replace('/hub')} hitSlop={12}>
            <Ionicons name="home" size={22} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Survival 2.0</Text>
            <Text style={styles.subtitle}>3 vite iniziali · 1 pronostico per ogni vita</Text>
          </View>
          <Pressable
            onPress={() => router.push('/surviva/rules')}
            hitSlop={12}
            testID="sv-rules"
          >
            <Ionicons name="book" size={22} color={COLOR} />
          </Pressable>
          {isAdmin && (
            <Pressable onPress={() => setCreateOpen(true)} hitSlop={12} testID="sv-create">
              <Ionicons name="add-circle" size={26} color={COLOR} />
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
                <TextInput
                  style={styles.input}
                  placeholder="Codice invito"
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="characters"
                  value={joinCode}
                  onChangeText={setJoinCode}
                  testID="sv-join-code"
                />
                <Pressable
                  style={[styles.cta, { backgroundColor: COLOR }]}
                  onPress={doJoin}
                  testID="sv-join-btn"
                >
                  <Ionicons name="log-in" size={18} color="#fff" />
                  <Text style={styles.ctaText}>Entra</Text>
                </Pressable>
              </View>
            )}

            <Text style={styles.section}>Tornei attivi ({items.length})</Text>
            {items.length === 0 && (
              <Text style={styles.muted}>
                {isAdmin
                  ? 'Nessun torneo attivo. Tocca ➕ per crearne uno.'
                  : 'Nessun torneo attivo. Chiedi un codice invito all\u2019admin.'}
              </Text>
            )}
            {items.map((t) => (
              <View key={t.id} style={[styles.tCard, { borderColor: COLOR + '55' }]}>
                <Pressable
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
                  onPress={() => router.push(`/surviva/${t.id}`)}
                  testID={`sv-t-${t.id}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tName}>{t.name}</Text>
                    <Text style={styles.tMeta}>
                      ❤️ {t.players_alive}/{t.players_total} vivi · Giornata {t.current_matchday}
                      {t.is_admin ? ' · admin' : ''}
                    </Text>
                    {(isAdmin || t.is_admin) && (
                      <Text style={styles.tCode}>Codice invito: {t.invite_code}</Text>
                    )}
                  </View>
                </Pressable>
                {t.is_admin && (
                  <Pressable
                    onPress={() => deleteTournament(t)}
                    hitSlop={10}
                    testID={`sv-delete-${t.id}`}
                    style={styles.trash}
                  >
                    <Ionicons name="trash" size={18} color={theme.colors.error} />
                  </Pressable>
                )}
                <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
              </View>
            ))}

            <Pressable
              style={styles.archiveToggle}
              onPress={() => setShowArchive((v) => !v)}
              testID="sv-archive-toggle"
            >
              <Ionicons
                name={showArchive ? 'chevron-down' : 'chevron-forward'}
                size={18}
                color={theme.colors.onSurface}
              />
              <Text style={styles.section}>Archivio storico ({archive.length})</Text>
            </Pressable>

            {showArchive && archive.length === 0 && (
              <Text style={styles.muted}>Nessun torneo concluso ancora.</Text>
            )}
            {showArchive && archive.map((a) => (
              <View key={a.id} style={styles.aCard}>
                <Pressable
                  style={{ flex: 1 }}
                  onPress={() => router.push(`/surviva/${a.id}/history`)}
                  testID={`sv-archived-${a.id}`}
                >
                  <Text style={styles.aName}>{a.name}</Text>
                  <Text style={styles.aMeta}>
                    Stagione {a.season || '?'} · {a.players_total} partecipanti
                  </Text>
                  <Text style={styles.aDate}>
                    Concluso {a.finished_at ? new Date(a.finished_at).toLocaleDateString('it-IT') : '—'}
                  </Text>
                </Pressable>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* Create tournament modal (admin only) */}
      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalBody}>
            <Text style={styles.modalTitle}>Nuovo torneo Survival</Text>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Nome torneo</Text>
              <TextInput
                style={styles.input}
                placeholder="es. Champions Table 2026"
                placeholderTextColor={theme.colors.muted}
                value={newName}
                onChangeText={setNewName}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Vite iniziali</Text>
              <TextInput
                style={styles.input}
                placeholder="1-10"
                placeholderTextColor={theme.colors.muted}
                value={newLives}
                onChangeText={setNewLives}
                keyboardType="number-pad"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Stagione</Text>
              <TextInput
                style={styles.input}
                placeholder="2026-27"
                placeholderTextColor={theme.colors.muted}
                value={newSeason}
                onChangeText={setNewSeason}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Giornata di partenza (1-38)</Text>
              <TextInput
                style={styles.input}
                placeholder="1"
                placeholderTextColor={theme.colors.muted}
                value={newStartMd}
                onChangeText={setNewStartMd}
                keyboardType="number-pad"
                testID="sv-start-md"
              />
              <Text style={styles.fieldHint}>
                Le giornate precedenti verranno ignorate. Utile per iniziare un torneo a stagione già in corso.
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
              <Pressable
                style={[styles.cta, { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, flex: 1 }]}
                onPress={() => setCreateOpen(false)}
              >
                <Text style={[styles.ctaText, { color: theme.colors.onSurface }]}>Annulla</Text>
              </Pressable>
              <Pressable
                style={[styles.cta, { backgroundColor: COLOR, flex: 1, opacity: creating ? 0.6 : 1 }]}
                disabled={creating}
                onPress={doCreate}
                testID="sv-create-submit"
              >
                {creating ? <ActivityIndicator color="#fff" size="small" /> : (
                  <>
                    <Ionicons name="rocket" size={18} color="#fff" />
                    <Text style={styles.ctaText}>Crea</Text>
                  </>
                )}
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
  tCode: {
    color: COLOR, fontSize: 11, marginTop: 4, fontWeight: '700',
    letterSpacing: 0.5,
  },
  trash: {
    padding: 6, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.error + '15',
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
  modalBg: {
    flex: 1, backgroundColor: '#000000AA',
    justifyContent: 'flex-end',
  },
  modalBody: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    gap: theme.spacing.md,
  },
  modalTitle: {
    color: theme.colors.onSurface, fontWeight: '800', fontSize: 18,
  },
  field: { gap: 6 },
  fieldLabel: {
    color: COLOR, fontSize: 12, fontWeight: '700',
    letterSpacing: 0.4, textTransform: 'uppercase', marginLeft: 2,
  },
  fieldHint: {
    color: theme.colors.muted, fontSize: 11, marginTop: 2,
    fontStyle: 'italic', lineHeight: 15,
  },
});
