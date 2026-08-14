/*
 * Surviva 2.1 — Regolamento pubblico.
 *
 * Accessibile a qualsiasi utente autenticato dall'header della hub
 * Survival. Il contenuto è sintetico ma completo, pensato per essere
 * letto in meno di 1 minuto.
 */
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { theme } from '@/src/theme';

const COLOR = '#EF4444';

export default function SurvivaRules() {
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={theme.colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Regolamento Survival</Text>
            <Text style={styles.subtitle}>Versione 2.1 · Giugno 2026</Text>
          </View>
          <Ionicons name="book" size={22} color={COLOR} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.body}>

        <Rule
          icon="heart"
          title="Vite iniziali"
          body="Ogni giocatore inizia con un numero di vite scelto dall'admin alla creazione del torneo (default: 3, min: 1, max: 10)."
        />

        <Rule
          icon="dice"
          title="1 pronostico per ogni vita"
          body="Ogni giornata devi inviare esattamente tanti pronostici quante sono le tue vite rimaste. Con 3 vite → 3 pronostici, con 1 vita → 1 pronostico."
        />

        <Rule
          icon="football"
          title="Come si gioca"
          body="Scegli partite diverse della giornata e per ognuna il segno 1 (casa) / X (pareggio) / 2 (trasferta). Puoi cambiare i pronostici finché la giornata non si blocca (calcio d'inizio della prima partita)."
        />

        <Rule
          icon="close-circle"
          title="Pronostico sbagliato = -1 vita"
          body="Per ogni pronostico errato perdi una vita. Se sbagli tutti (es. con 3 vite sbagli 3 pick) sei eliminato immediatamente."
        />

        <Rule
          icon="lock-closed"
          title="Team lock: una squadra usata una volta sola"
          body="Ogni squadra usata in un pronostico VINTO (segno 1 o 2) viene 'lockata' e NON potrai più usarla nei prossimi turni. Il segno X (pareggio) NON blocca nessuna squadra."
        />

        <Rule
          icon="git-merge"
          title="Concessione (entrambe lockate)"
          body="Se in una partita ENTRAMBE le squadre sono già state lockate, puoi giocarla comunque con qualsiasi segno: è una 'concessione' e non introduce nuovi lock. Ti permette di continuare a giocare anche a fine torneo con molte squadre bloccate."
        />

        <Rule
          icon="gift"
          title="Bonus Big Match (+1 vita)"
          body="Ogni giornata l'admin può indicare una 'Big Match'. Se indovini il risultato esatto (es. 2-1) guadagni +1 vita nel torneo (bonus applicato solo se sei ancora vivo al momento della liquidazione)."
        />

        <Rule
          icon="alarm"
          title="Se non giochi (auto-fill)"
          body="Se non invii pronostici entro la scadenza, il sistema genera picks di default per te (sempre segno 1 sulla prima partita libera, poi 2, poi X con concessioni). Così eviti di 'salvare' vite non giocando."
        />

        <Rule
          icon="eye-off"
          title="Privacy: giocatori pochi"
          body="Quando restate in 4 o meno, PRIMA del calcio d'inizio i contatori aggregati per partita vengono nascosti. Altrimenti chiunque potrebbe dedurre chi ha scelto cosa."
        />

        <Rule
          icon="refresh"
          title="Pareggio → Resurrezione"
          body="Se in una giornata TUTTI i giocatori vivi muoiono contemporaneamente (e ce n'erano almeno 2), il sistema li ripristina allo stato pre-turno e passa alla giornata successiva. Si ripete finché non ne resta uno solo."
        />

        <Rule
          icon="trophy"
          title="Vincitore & Round successivo"
          body="Vince il torneo l'ultimo giocatore vivo. Quando il torneo finisce, il sistema crea automaticamente un 'Round 2' con lo stesso nome — pronto per una nuova stagione."
        />

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

function Rule({ icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <View style={styles.ruleCard}>
      <View style={styles.ruleIconWrap}>
        <Ionicons name={icon} size={20} color={COLOR} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.ruleTitle}>{title}</Text>
        <Text style={styles.ruleBody}>{body}</Text>
      </View>
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
  body: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 32 },
  ruleCard: {
    flexDirection: 'row', gap: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  ruleIconWrap: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: theme.radius.pill,
    backgroundColor: COLOR + '18',
    borderWidth: 1, borderColor: COLOR + '55',
  },
  ruleTitle: {
    color: theme.colors.onSurface, fontSize: 14, fontWeight: '800',
    marginBottom: 4,
  },
  ruleBody: {
    color: theme.colors.onSurfaceSecondary, fontSize: 13, lineHeight: 18,
  },
  footer: {
    color: theme.colors.muted, fontSize: 12, textAlign: 'center',
    fontStyle: 'italic', lineHeight: 18,
  },
});
