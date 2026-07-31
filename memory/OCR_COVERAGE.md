# Copertura OCR & Classificatore mercati — RinoMagic

**Data**: 31 luglio 2026  
**Fonte**: `/app/backend/tests/test_staryes_parser.py` + `/app/backend/tests/fixtures/*.webp`

Questo documento elenca **tutti i mercati e le giocate attualmente testati** dal parser OCR di staryes.it. Usalo per identificare i mercati **non ancora coperti** e segnalarmeli, così li testo.

---

## ✅ 1. TEST OCR END-TO-END (con immagine reale)

Due schedine reali di staryes.it vengono passate all'OCR e ogni evento viene confrontato con il valore atteso.

### Sample 1 (`staryes_sample.webp`)
| # | Partita | Mercato | Giocata | Quota | Status |
|---|---------|---------|---------|-------|--------|
| 1 | Frosinone - Juventus | 1X2 | **2** (vittoria trasferta) | 1.46 | ✅ |
| 2 | Parma - Cagliari | G/NG | **GOL** | 1.94 | ✅ |
| 3 | Genoa - Napoli | U/O 1.5 | **UNDER** | 2.75 | ✅ |
| 4 | Udinese - Como | 12 (Doppia chance) | **12** | 1.30 | ✅ |
| 5 | Inter - Monza | 1X2 | **X** (pareggio) | 5.90 | ✅ |

### Sample 2 (`staryes_markets.webp`)
| # | Partita | Mercato | Giocata | Quota | Status |
|---|---------|---------|---------|-------|--------|
| 1 | Frosinone - Juventus | Multigol Ospite | **0-1 SI** | 2.15 | ✅ |
| 2 | Parma - Cagliari | Multigol Casa | **0-2 SI** | 1.08 | ✅ |
| 3 | Genoa - Napoli | Multigol Totale | **1-3 SI** | 1.30 | ✅ |
| 4 | Udinese - Como | **1° Tempo** (HT) | qualunque | 2.06 | ⛔ Rifiutato (corretto) |
| 5 | Inter - Monza | Doppia chance | **1X** | 1.04 | ✅ |

---

## ✅ 2. UNIT TEST del classificatore `_classify_bet(mercato, giocata)`

Test isolati senza rumore OCR: verificano che il parser normalizzi correttamente i vari formati e li mappi a codici interni.

### Mercato semplice
| Mercato | Giocata | Codice interno | ✔️ |
|---------|---------|----------------|-----|
| 1X2 | 1 | `1` | ✅ |
| 1X2 | X | `X` | ✅ |
| 1X2 | 2 | `2` | ✅ |
| 1X | 1X | `1X` (doppia chance casa/pari) | ✅ |
| X2 | X2 | `X2` (doppia chance pari/trasferta) | ✅ |
| 12 | 12 | `12` (doppia chance casa/trasferta) | ✅ |
| G/NG | GOL | `GOL` | ✅ |
| G/NG | NOGOL | `NOGOL` | ✅ |
| U/O 1,5 | UNDER | `UNDER-1.5` | ✅ |
| U/O 2,5 | OVER | `OVER-2.5` | ✅ |
| U/O 3,5 | OVER | `OVER-3.5` | ✅ |

### Multigol
| Mercato | Giocata | Codice interno | ✔️ |
|---------|---------|----------------|-----|
| MULTIGOL 1-3 | SI | `MG-1-3` | ✅ |
| MULTIGOL 2-4 | SI | `MG-2-4` | ✅ |
| MULTIGOL 1-3 | NO | `MG-1-3-NO` | ✅ |
| MULTIGOL 0-2 CASA | SI | `MGH-0-2` | ✅ |
| MULTIGOL 0-1 OSPITE | SI | `MGA-0-1` | ✅ |

### Mercati **rifiutati** (comportamento corretto)
| Mercato | Motivo | ✔️ |
|---------|--------|-----|
| 1X2 1° TEMPO | Non ammesso | ⛔ |
| 1X 1° TEMPO | Non ammesso | ⛔ |

### Combo (mercati combinati con `+`)
| Mercato | Giocata | Codice interno | ✔️ |
|---------|---------|----------------|-----|
| 1X2 + G/NG | 1 + GOL | `1+GOL` | ✅ |
| 1X + U/O 2,5 | 1X + OVER | `1X+OVER-2.5` | ✅ |
| 1X + GG/NG | 1X + NG | `1X+NOGOL` | ✅ |
| 1X2 + GG/NG | 1 + NG | `1+NOGOL` | ✅ |
| U/O 2,5 + GG/NG | GG + OV | `OVER-2.5+GOL` | ✅ |
| 1X2 + G/NG | 2 + GOL | `2+GOL` | ✅ |
| 1X + MULTIGOL 1-3 | SI | `1X+MG-1-3` | ✅ |
| 1X2 + U/O 1.5 | 1 + UN | `1+UNDER-1.5` | ✅ |

### Robustezza a errori OCR
| Input OCR | Interpretato come | ✔️ |
|-----------|-------------------|-----|
| `IX` (I al posto di 1) | `1X` | ✅ |
| `4X + MULTIGOL 13` (SI) | `1X+MG-1-3` | ✅ |
| `GG+0V` (0 al posto di O) | `OVER-2.5+GOL` | ✅ |
| `TX / DX` (fix ultimo aggiornamento) | `1X` | ✅ |
| `U/0 1,5` (0 al posto di O) | riconosciuto Over/Under | ✅ |

---

## ✅ 3. UNIT TEST dell'evaluator `_evaluate_prediction(codice, risultato)`

Verifica che dato un risultato finale (es. 2-1) il codice interno sia calcolato vincente/perdente correttamente.

### 1X2
- `1` con 2-1 → ✅ vinto
- `1` con 1-1 → ❌ perso
- `X` con 1-1 → ✅ vinto
- `2` con 0-3 → ✅ vinto

### Doppia chance
- `1X` con 1-1 → ✅ vinto
- `1X` con 0-2 → ❌ perso
- `X2` con 1-1 → ✅ vinto
- `12` con 1-1 → ❌ perso
- `12` con 2-0 → ✅ vinto

### GOL / NOGOL
- `GOL` con 1-1 → ✅ vinto
- `GOL` con 2-0 → ❌ perso
- `NOGOL` con 2-0 → ✅ vinto

### Over/Under
- `OVER-2.5` con 2-1 → ✅ vinto
- `OVER-2.5` con 1-1 → ❌ perso
- `UNDER-2.5` con 1-1 → ✅ vinto
- `OVER-0.5` con 0-0 → ❌ perso
- `OVER-0.5` con 1-0 → ✅ vinto

### Multigol
- `MG-1-3` (totale) con 1-2 → ✅ vinto
- `MG-1-3` con 2-2 → ❌ perso (4 gol)
- `MG-1-3` con 0-0 → ❌ perso
- `MG-1-3-NO` con 2-2 → ✅ vinto (fuori range = vinto)
- `MGH-0-2` (casa) con 2-5 → ✅ vinto (casa in range)
- `MGH-0-2` con 3-0 → ❌ perso
- `MGA-0-1` (ospite) con 4-1 → ✅ vinto
- `MGA-0-1` con 0-2 → ❌ perso

### Combos
- `1+GOL` con 2-1 → ✅
- `1+GOL` con 2-0 → ❌
- `1X+OVER-2.5` con 2-1 → ✅
- `X+UNDER-1.5` con 1-1 → ❌
- `X+UNDER-2.5` con 1-1 → ✅

---

## ⚠️ MERCATI POTENZIALMENTE NON COPERTI / DA TESTARE

Ecco l'elenco di ciò che **NON è ancora testato** ma è comunque parte del bookmaker italiano:

### Under/Over — soglie mancanti
- [ ] `OVER 0.5` (già evaluator OK, ma manca test OCR)
- [ ] `UNDER 0.5`
- [ ] `UNDER 1.5` (evaluator OK, no test OCR)
- [ ] `UNDER 3.5`, `UNDER 4.5`, `OVER 4.5`, `OVER 5.5`

### Multigol — range mancanti
- [ ] `MULTIGOL 0-1` totale (SI/NO)
- [ ] `MULTIGOL 0-3`, `1-4`, `2-3`, `2-5`
- [ ] `MULTIGOL 3+`, `4+`, `5+` (Multigol aperto/minimo)
- [ ] `MULTIGOL CASA 1-2`, `0-3`, `2+`, `3+`
- [ ] `MULTIGOL OSPITE 1-2`, `0-3`, `2+`, `3+`

### Combo non testati
- [ ] `12 + GOL`, `X2 + OVER`, `X + GOL`, `2 + UNDER` (variazioni simmetriche)
- [ ] `1X2 + MULTIGOL` (es. `1 + MG 2-4`)
- [ ] Combo con tre mercati (raro)

### Mercati **non ancora supportati** dal parser
Se compaiono, l'OCR li rifiuta correttamente come "MERCATO NON AMMESSO":
- ⛔ **Risultato esatto** (es. 2-1)
- ⛔ **Testa a Testa (H2H)**
- ⛔ **Marcatori** (Chi segna, Primo marcatore, Segna e vince, ecc.)
- ⛔ **Handicap** europeo e asiatico
- ⛔ **Somma gol esatta** (es. 3 gol totali)
- ⛔ **Squadra che segna per prima**
- ⛔ **Ribaltone Casa/Ospite**
- ⛔ **Rimonta**
- ⛔ **Cartellini / Corner**
- ⛔ Tutti i mercati **1° Tempo** e **2° Tempo** (per scelta)

---

## 📋 Come procedere

1. Guarda l'elenco delle **soglie/range mancanti** sopra
2. Trova sul tuo staryes una schedina che li contenga
3. Fanne lo screenshot e caricalo → segnalami quali sono
4. Aggiungerò il test specifico e — se serve — estenderò il parser
