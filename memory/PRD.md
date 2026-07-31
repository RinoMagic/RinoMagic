# SchedinaBar — Product Requirements

## Vision
App/sito mobile per sfida di scommesse virtuali sulla Serie A tra amici. Ogni stanza corrisponde a una giornata + gruppo. Chi ottiene la quota totale piu bassa paga da bere.

## Flow
1. Admin crea una stanza (nome, giornata Serie A 1-38, max_events 3-8, colore, admin_nickname) → riceve **codice invito 6 caratteri**
2. Amici entrano con codice invito + nickname (no password, no email). Ogni stanza ha nickname unici (case-insensitive).
3. Ogni utente compone la propria schedina su **Staryes.it**, screenshotta lo schermo
4. Nell'app: tocca "Carica screenshot" → seleziona dalla galleria → OCR Tesseract legge il testo
5. Sistema restituisce eventi parsati (squadra casa, squadra trasferta, pronostico 1/X/2/1X/X2/12/GOL/NOGOL/OVER/UNDER, quota)
6. Utente **rivede e corregge** manualmente prima di confermare
7. Admin inserisce risultati partite (manuale o via API-Football sync se piano Pro attivo)
8. Sistema calcola per ogni utente: **PRODOTTO** delle quote SOLO dei pronostici azzeccati (chi ne indovina 0 = 0)
9. Classifica per stanza: piu alto vince, ultimo paga da bere

## Stack
- Backend: FastAPI + MongoDB + PyJWT + Pillow + pytesseract (Tesseract 5.3 con lingua ITA installata a livello di sistema)
- Frontend: Expo SDK 54 + expo-router + expo-image-picker
- Auth: JWT con claims (room_id, nickname, is_admin). Nessuna registrazione persistente.
- OCR: Tesseract Python nel backend con preprocessing (grayscale + autocontrast + sharpen)
- Team matching: normalizzazione aggressiva (lowercase, rimozione FC/AC/CF/etc, token overlap) per matching pronostici vs risultati

## Endpoints
- `POST /api/rooms` — crea stanza, no auth, ritorna token admin
- `POST /api/rooms/join` — entra con codice + nickname, no auth, ritorna token utente
- `GET /api/rooms/{id}` — dettagli stanza (auth)
- `GET /api/rooms/{id}/members` — lista partecipanti con flag "consegnata"
- `POST /api/rooms/{id}/schedina/ocr` — upload screenshot base64 → OCR → eventi parsati draft
- `POST /api/rooms/{id}/schedina/confirm` — conferma eventi finali
- `GET /api/rooms/{id}/schedina` — la mia schedina
- `POST /api/rooms/{id}/fixtures` — admin: risultati manuali
- `POST /api/rooms/{id}/fixtures/sync` — admin: sync via API-Football (Pro plan)
- `GET /api/rooms/{id}/fixtures` — lista risultati
- `GET /api/rooms/{id}/leaderboard` — classifica calcolata con moltiplicazione quote

## Pronostici supportati
- 1 (casa), X (pareggio), 2 (trasferta)
- 1X, X2, 12 (doppie)
- GOL (entrambe segnano), NOGOL
- OVER (over 2.5), UNDER (under 2.5)

## Note
- Rimosso vecchio progetto FantaGiornata, archiviato in `/app/_archive/fantagiornata/`
- DB name: `schedinabar` (isolato dal db FantaGiornata)
- Tesseract binary + tessdata-ita installati a livello di sistema (apt)
- Bookmaker target: Staryes.it (OCR generico, funziona su altri bookmaker con precisione minore)
- API-Football key predisposta ma piano free non copre stagione corrente

## Non implementato (future)
- Notifiche quando l'admin chiude la stanza
- Multi-lingua (attualmente solo italiano)
- Persistenza cross-device del nickname (attualmente locale via SecureStore)
- Reset/rimozione partecipante da parte dell'admin
