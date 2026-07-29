# FantaGiornata — Product Requirements

## Vision
Un'app mobile fantacalcio in cui ogni giornata i partecipanti creano una formazione **senza limiti di crediti**. Chi ottiene il fantavoto totale piu alto vince la giornata e il premio simbolico (badge trofeo + 3 punti classifica).

## Utenti
- Partecipante (crea formazioni, entra in leghe)
- Admin di lega (proprietario che crea la lega; inserisce i voti giornata)

## Funzionalita MVP (implementate)
1. **Autenticazione JWT** — registrazione/login email+password con bcrypt
2. **Leghe** — creazione lega, invito con codice a 6 caratteri, listing leghe personali
3. **Rosa Serie A** — 200+ giocatori 2024/25 (10 per squadra, 20 squadre) con filtri ruolo/squadra/ricerca. Pulsante "Aggiorna" per sync completo da API-Football (~500 giocatori).
4. **Costruzione Formazione** — 6 moduli (4-3-3, 4-4-2, 3-5-2, 3-4-3, 4-5-1, 5-3-2), pitch grafico, 11 titolari + 8 panchina (2P+2D+2C+2A), selezione via bottom sheet
5. **Sostituzioni automatiche**: se un titolare non ha voto (non ha giocato), viene sostituito automaticamente dal primo giocatore di panchina dello stesso ruolo che ha giocato
6. **Voti**:
   - **Sync automatico**: pulsante "Scarica voti da API" (owner) che scarica i voti reali dalla API-Football per la giornata
   - **Inserimento manuale**: alternativa completa (voto + gol/assist/rigori/ammoniz/espuls/autogol/gol_subiti)
7. **Classifica giornata** — punteggi ordinati con sostituzioni applicate, vincitore evidenziato con trofeo dorato
8. **Storico vincitori giornate** — lista giornate giocate con vincitori
9. **Avanzamento giornata** — l'admin di lega puo passare alla giornata successiva

## Rimosso dall'MVP
- ~~Classifica generale~~ (il gioco e basato su ogni singola giornata, non c'e classifica cumulativa)

## Regole Fantavoto
- Base: 6.0
- Gol: +3 · Assist: +1 · Rigore segnato: +3 · Rigore sbagliato: -3
- Ammonizione: -0.5 · Espulsione: -1 · Autogol: -2
- Portiere: -1 ogni 2 gol subiti

## Stack Tecnico
- **Backend**: FastAPI + MongoDB (motor async), JWT (PyJWT + bcrypt/passlib)
- **Frontend**: Expo SDK 54, expo-router (file-based), TypeScript, React Native
- **Storage token**: expo-secure-store (native) / AsyncStorage (web)
- **Design**: Dark-first, verde Serie A (#00D95F), oro trofeo (#FFB300)

## Endpoints principali (`/api`)
- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- `GET /players`, `GET /teams`
- `POST /leagues`, `GET /leagues`, `GET /leagues/{id}`
- `POST /leagues/join`, `POST /leagues/{id}/advance`
- `POST /leagues/{id}/lineups`, `GET /leagues/{id}/lineups/{md}`
- `POST /leagues/{id}/votes`, `GET /leagues/{id}/votes/{md}`
- `GET /leagues/{id}/results/{md}`, `GET /leagues/{id}/leaderboard`, `GET /leagues/{id}/history`

## Future Enhancements (post-MVP)
- Integrazione API voti reali (nessuna API pubblica affidabile Serie A oggi disponibile)
- Capitano/vice capitano con voto x2
- Chat di lega e commenti
- Notifiche push su chiusura giornata
- Statistiche avanzate (grafici, MVP stagione)
- Montepremi personalizzabile per lega
- Drag & drop giocatori sul campo
- Cambi automatici dalla panchina
