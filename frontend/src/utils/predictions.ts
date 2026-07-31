/**
 * Prediction code utilities for SchedinaBar.
 *
 * Canonical prediction codes returned by the backend:
 *   Simple 1X2 / DC:    1  X  2  1X  X2  12
 *   First half:         HT-1  HT-X  HT-2  HT-1X  HT-X2  HT-12
 *   Both to score:      GOL  NOGOL
 *   Over/Under:         OVER-0.5 .. OVER-4.5   UNDER-0.5 .. UNDER-4.5
 *   Multigol totale:    MG-<a>-<b>          e.g. MG-1-3 (with optional "-NO")
 *   Multigol casa:      MGH-<a>-<b>[-NO]
 *   Multigol ospite:    MGA-<a>-<b>[-NO]
 *   Combos:             any of the above joined by '+', e.g. 1+GOL, 1X+OVER-2.5
 */

const BASE_LABELS: Record<string, string> = {
  '1': '1 (Casa)',
  'X': 'X (Pareggio)',
  '2': '2 (Trasferta)',
  '1X': '1X (Casa o Pareggio)',
  'X2': 'X2 (Pareggio o Trasferta)',
  '12': '12 (Casa o Trasferta)',
  'HT-1': '1° Tempo: 1 (Casa)',
  'HT-X': '1° Tempo: X (Pareggio)',
  'HT-2': '1° Tempo: 2 (Trasferta)',
  'HT-1X': '1° Tempo: 1X',
  'HT-X2': '1° Tempo: X2',
  'HT-12': '1° Tempo: 12',
  'GOL': 'GOL (Entrambe segnano)',
  'NOGOL': 'NO GOL',
};

/** Turn a canonical prediction code (possibly compound) into a human-readable
 *  Italian label. */
export function formatPrediction(code: string | undefined | null): string {
  if (!code) return '—';
  return code
    .split('+')
    .map((atom) => {
      const up = atom.toUpperCase();
      if (BASE_LABELS[up]) return BASE_LABELS[up];
      const ou = up.match(/^(OVER|UNDER)-(\d(?:\.\d)?)$/);
      if (ou) return `${ou[1] === 'OVER' ? 'Over' : 'Under'} ${ou[2]}`;
      const mg = up.match(/^(MG|MGH|MGA)-(\d)-(\d)(-NO)?$/);
      if (mg) {
        const kind = mg[1];
        const label =
          kind === 'MGH' ? 'Multigol Casa' : kind === 'MGA' ? 'Multigol Ospite' : 'Multigol';
        return `${label} ${mg[2]}-${mg[3]}${mg[4] ? ' (NO)' : ''}`;
      }
      return atom;
    })
    .join(' + ');
}

/** Category / group description used when choosing a prediction manually. */
export type PredictionOption = { code: string; short: string; label: string };
export type PredictionGroup = { title: string; options: PredictionOption[] };

export const PREDICTION_GROUPS: PredictionGroup[] = [
  {
    title: '1X2',
    options: [
      { code: '1', short: '1', label: 'Casa' },
      { code: 'X', short: 'X', label: 'Pareggio' },
      { code: '2', short: '2', label: 'Trasferta' },
    ],
  },
  {
    title: 'Doppia Chance',
    options: [
      { code: '1X', short: '1X', label: 'Casa o Pareggio' },
      { code: 'X2', short: 'X2', label: 'Pareggio o Trasferta' },
      { code: '12', short: '12', label: 'Casa o Trasferta' },
    ],
  },
  {
    title: '1° Tempo',
    options: [
      { code: 'HT-1', short: 'HT 1', label: 'Casa 1°T' },
      { code: 'HT-X', short: 'HT X', label: 'Pareggio 1°T' },
      { code: 'HT-2', short: 'HT 2', label: 'Trasferta 1°T' },
      { code: 'HT-1X', short: 'HT 1X', label: 'Casa o Pareggio 1°T' },
      { code: 'HT-X2', short: 'HT X2', label: 'Pareggio o Trasferta 1°T' },
      { code: 'HT-12', short: 'HT 12', label: 'Casa o Trasferta 1°T' },
    ],
  },
  {
    title: 'Gol / No Gol',
    options: [
      { code: 'GOL', short: 'GOL', label: 'Entrambe segnano' },
      { code: 'NOGOL', short: 'NOGOL', label: 'Almeno una non segna' },
    ],
  },
  {
    title: 'Over / Under',
    options: [
      { code: 'OVER-0.5', short: 'O 0.5', label: 'Over 0.5' },
      { code: 'OVER-1.5', short: 'O 1.5', label: 'Over 1.5' },
      { code: 'OVER-2.5', short: 'O 2.5', label: 'Over 2.5' },
      { code: 'OVER-3.5', short: 'O 3.5', label: 'Over 3.5' },
      { code: 'OVER-4.5', short: 'O 4.5', label: 'Over 4.5' },
      { code: 'UNDER-0.5', short: 'U 0.5', label: 'Under 0.5' },
      { code: 'UNDER-1.5', short: 'U 1.5', label: 'Under 1.5' },
      { code: 'UNDER-2.5', short: 'U 2.5', label: 'Under 2.5' },
      { code: 'UNDER-3.5', short: 'U 3.5', label: 'Under 3.5' },
      { code: 'UNDER-4.5', short: 'U 4.5', label: 'Under 4.5' },
    ],
  },
  {
    title: 'Multigol totale',
    options: [
      { code: 'MG-1-2', short: '1-2', label: '1 o 2 gol' },
      { code: 'MG-1-3', short: '1-3', label: '1, 2 o 3 gol' },
      { code: 'MG-1-4', short: '1-4', label: '1-4 gol' },
      { code: 'MG-1-5', short: '1-5', label: '1-5 gol' },
      { code: 'MG-2-3', short: '2-3', label: '2 o 3 gol' },
      { code: 'MG-2-4', short: '2-4', label: '2-4 gol' },
      { code: 'MG-3-4', short: '3-4', label: '3 o 4 gol' },
    ],
  },
  {
    title: 'Multigol Casa',
    options: [
      { code: 'MGH-0-1', short: 'C 0-1', label: 'Casa 0 o 1' },
      { code: 'MGH-0-2', short: 'C 0-2', label: 'Casa 0, 1 o 2' },
      { code: 'MGH-0-3', short: 'C 0-3', label: 'Casa 0-3' },
      { code: 'MGH-1-2', short: 'C 1-2', label: 'Casa 1 o 2' },
      { code: 'MGH-1-3', short: 'C 1-3', label: 'Casa 1-3' },
      { code: 'MGH-2-3', short: 'C 2-3', label: 'Casa 2 o 3' },
    ],
  },
  {
    title: 'Multigol Ospite',
    options: [
      { code: 'MGA-0-1', short: 'O 0-1', label: 'Ospite 0 o 1' },
      { code: 'MGA-0-2', short: 'O 0-2', label: 'Ospite 0-2' },
      { code: 'MGA-0-3', short: 'O 0-3', label: 'Ospite 0-3' },
      { code: 'MGA-1-2', short: 'O 1-2', label: 'Ospite 1 o 2' },
      { code: 'MGA-1-3', short: 'O 1-3', label: 'Ospite 1-3' },
      { code: 'MGA-2-3', short: 'O 2-3', label: 'Ospite 2 o 3' },
    ],
  },
];
