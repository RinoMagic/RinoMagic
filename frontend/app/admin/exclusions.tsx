/*
 * /admin/exclusions — Pre-round match exclusion management.
 *
 * Admin flow:
 *   • Select a matchday number.
 *   • For every fixture in the season calendar, toggle "Escludi" to prevent
 *     users from selecting that match in ANY game (Score, Survival, Tiket).
 *   • Exclusions propagate immediately to all open (non-settled) tournament
 *     matchdays and Tiket rooms via the backend endpoint.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

const COLOR = '#EF4444';

type CalFixture = {
  id: string;
  matchday: number;
  home_team: string;
  away_team: string;
  kickoff_iso?: string | null;
  excluded?: boolean;
};

export default function ExclusionsScreen() {
  const router = useRouter();
  const [matchday, setMatchday] = useState('1');
  const [fixtures, setFixtures] = useState<CalFixture[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [propagatedInfo, setPropagatedInfo] = useState<string | null>(null);

  const load = async (md: number) => {
    setLoading(true);
    try {
      const r = await api<{ fixtures: CalFixture[] }>(
        `/sal/calendar?matchday=${md}&season=2026-27`,
      );
      const sorted = (r.fixtures || []).slice().sort((a, b) =>
        (a.kickoff_iso || '').localeCompare(b.kickoff_iso || '')
        || a.home_team.localeCompare(b.home_team),
      );
      setFixtures(sorted);
    } catch (e: any) {
      setFixtures([]);
      alert(e.message || 'Errore caricamento calendario');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const md = parseInt(matchday, 10) || 1;
    load(md);
  }, [matchday]);

  const toggleExcluded = async (fx: CalFixture) => {
    setSavingId(fx.id);
    setPropagatedInfo(null);
    try {
      const next = !fx.excluded;
      const resp = await api<{ propagated?: { sv: number; sal: number; tiket: number } }>(
        `/sal/calendar/fixture/${fx.id}/exclude`,
        { method: 'PATCH', body: { excluded: next } },
      );
      setFixtures(list => list.map(f =>
        f.id === fx.id ? { ...f, excluded: next } : f,
      ));
      const p = resp?.propagated;
      if (p && (p.sv + p.sal + p.tiket) > 0) {
        setPropagatedInfo(
          `✓ Aggiornati ${p.sv} tornei Survival, ${p.sal} tornei Score, ${p.tiket} stanze Tiket`,
        );
        setTimeout(() => setPropagatedInfo(null), 4000);
      }
    } catch (e: any) {
      alert(e.message || 'Errore');
    } finally { setSavingId(null); }
  };

  const excludedCount = fixtures.filter(f => f.excluded).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.title}>Escludi Partite</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        {/* Info card */}
        <View style={styles.infoCard}>
          <Ionicons name="information-circle" size={18} color={COLOR} />
          <Text style={styles.infoText}>
            Escludi le partite <Text style={{ fontWeight: '900' }}>prima</Text> dell&apos;inizio del turno
            per rinvii annunciati o annullamenti. Una partita esclusa
            <Text style={{ fontWeight: '900' }}> sparisce immediatamente</Text> dalle scelte utente
            in tutti i giochi (Score, Survival, Tiket) e dal dropdown Big Match nei Bonus.
          </Text>
        </View>

        {/* Matchday selector */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Giornata</Text>
          <TextInput
            testID="exclusions-matchday"
            style={styles.input}
            keyboardType="numeric"
            value={matchday}
            onChangeText={setMatchday}
            placeholder="1"
            placeholderTextColor={theme.colors.muted}
            maxLength={2}
          />
          <Text style={styles.help}>
            {loading ? 'Caricamento…'
              : fixtures.length === 0 ? 'Nessuna partita in calendario per questa giornata.'
              : `${fixtures.length} partite · ${excludedCount} escluse`}
          </Text>
        </View>

        {propagatedInfo && (
          <View style={styles.propBanner}>
            <Text style={styles.propBannerText}>{propagatedInfo}</Text>
          </View>
        )}

        {/* Fixtures list */}
        {!loading && fixtures.map((fx) => (
          <View
            key={fx.id}
            style={[
              styles.row,
              fx.excluded && { backgroundColor: '#7F1D1D', borderColor: COLOR },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.rowTeams,
                  fx.excluded && { color: '#FEE2E2', textDecorationLine: 'line-through' },
                ]}
              >
                {fx.home_team} vs {fx.away_team}
              </Text>
              {fx.kickoff_iso && (
                <Text style={[styles.rowKickoff, fx.excluded && { color: '#FCA5A5' }]}>
                  {new Date(fx.kickoff_iso).toLocaleString('it-IT', {
                    weekday: 'short', day: '2-digit', month: 'short',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </Text>
              )}
            </View>
            <Pressable
              onPress={() => toggleExcluded(fx)}
              disabled={savingId === fx.id}
              style={[
                styles.btn,
                fx.excluded
                  ? { backgroundColor: COLOR }
                  : { backgroundColor: theme.colors.surfaceSecondary, borderWidth: 1, borderColor: theme.colors.border },
                savingId === fx.id && { opacity: 0.6 },
              ]}
              testID={`exclusions-toggle-${fx.home_team}`}
            >
              {savingId === fx.id ? (
                <ActivityIndicator color={fx.excluded ? '#fff' : COLOR} size="small" />
              ) : (
                <>
                  <Ionicons
                    name={fx.excluded ? 'close-circle' : 'radio-button-off'}
                    size={16}
                    color={fx.excluded ? '#fff' : theme.colors.text}
                  />
                  <Text
                    style={[
                      styles.btnText,
                      { color: fx.excluded ? '#fff' : theme.colors.text },
                    ]}
                  >
                    {fx.excluded ? 'ESCLUSA' : 'Escludi'}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        ))}

        {!loading && fixtures.length === 0 && (
          <View style={styles.emptyBox}>
            <Ionicons name="calendar-outline" size={32} color={theme.colors.muted} />
            <Text style={styles.emptyText}>
              Nessuna partita per la giornata {matchday}.
            </Text>
            <Text style={styles.emptyHint}>
              Carica prima il calendario da ScoreAndLive → Calendario.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border,
  },
  title: { color: theme.colors.text, fontWeight: '800', fontSize: 17 },
  card: {
    padding: 14, borderRadius: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border, gap: 8,
  },
  cardLabel: {
    color: theme.colors.muted, fontSize: 11, fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  input: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border,
    padding: 10, color: theme.colors.text, fontSize: 15,
  },
  help: { color: theme.colors.muted, fontSize: 12, lineHeight: 16 },
  infoCard: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    padding: 12, borderRadius: 12,
    backgroundColor: COLOR + '10',
    borderWidth: 1, borderColor: COLOR + '55',
  },
  infoText: {
    color: theme.colors.text, fontSize: 12, lineHeight: 17, flex: 1,
  },
  propBanner: {
    padding: 10, borderRadius: 8,
    backgroundColor: '#10B98110',
    borderWidth: 1, borderColor: '#10B98155',
  },
  propBannerText: { color: '#10B981', fontSize: 12, fontWeight: '700' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 10,
    backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  rowTeams: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  rowKickoff: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  btn: {
    flexDirection: 'row', gap: 4, alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    minWidth: 100, justifyContent: 'center',
  },
  btnText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  emptyBox: {
    padding: 24, alignItems: 'center', gap: 6,
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  emptyText: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  emptyHint: { color: theme.colors.muted, fontSize: 12, textAlign: 'center' },
});
