/**
 * Prediction code utilities for SchedinaBar.
 *
 * Canonical prediction codes returned by the backend (final score only):
 *   1X2 / DC:           1  X  2  1X  X2  12
 *   Both to score:      GOL  NOGOL
 *   Over/Under:         OVER-0.5 .. OVER-4.5   UNDER-0.5 .. UNDER-4.5
 *   Multigol totale:    MG-<a>-<b>          e.g. MG-1-3 (with optional "-NO")
 *   Multigol casa:      MGH-<a>-<b>[-NO]
 *   Multigol ospite:    MGA-<a>-<b>[-NO]
 *   Combos:             any of the above joined by '+', e.g. 1+GOL, 1X+OVER-2.5
 *
 * If the OCR could not classify the market, the backend returns prediction = ""
 * and the frontend must show "MERCATO NON AMMESSO" while forcing the user to
 * pick a valid market before saving.
 */

const BASE_LABELS: Record<string, string> = {
  '1': '1 (Casa)',
  'X': 'X (Pareggio)',
  '2': '2 (Trasferta)',
  '1X': '1X (Casa o Pareggio)',
  'X2': 'X2 (Pareggio o Trasferta)',
  '12': '12 (Casa o Trasferta)',
  'GOL': 'GOL (Entrambe segnano)',
  'NOGOL': 'NO GOL',
};

/** Turn a canonical prediction code (possibly compound) into a human-readable
 *  Italian label. An empty/unknown code becomes "MERCATO NON AMMESSO". */
export function formatPrediction(code: string | undefined | null): string {
  if (!code || !code.trim()) return 'MERCATO NON AMMESSO';
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

/** Check if a prediction code is "unknown / rejected". */
export function isUnknownPrediction(code: string | undefined | null): boolean {
  return !code || !code.trim();
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
  {
    title: 'Combo — 1X2 + GOL',
    options: [
      { code: '1+GOL', short: '1+G', label: 'Casa + Gol' },
      { code: 'X+GOL', short: 'X+G', label: 'Pareggio + Gol' },
      { code: '2+GOL', short: '2+G', label: 'Trasferta + Gol' },
      { code: '1+NOGOL', short: '1+NG', label: 'Casa + No Gol' },
      { code: 'X+NOGOL', short: 'X+NG', label: 'Pareggio + No Gol' },
      { code: '2+NOGOL', short: '2+NG', label: 'Trasferta + No Gol' },
    ],
  },
  {
    title: 'Combo — DC + GOL',
    options: [
      { code: '1X+GOL', short: '1X+G', label: '1X + Gol' },
      { code: 'X2+GOL', short: 'X2+G', label: 'X2 + Gol' },
      { code: '12+GOL', short: '12+G', label: '12 + Gol' },
      { code: '1X+NOGOL', short: '1X+NG', label: '1X + No Gol' },
      { code: 'X2+NOGOL', short: 'X2+NG', label: 'X2 + No Gol' },
      { code: '12+NOGOL', short: '12+NG', label: '12 + No Gol' },
    ],
  },
  {
    title: 'Combo — 1X2 + Over/Under',
    options: [
      { code: '1+OVER-2.5', short: '1+O2.5', label: 'Casa + Over 2.5' },
      { code: 'X+OVER-2.5', short: 'X+O2.5', label: 'Pareggio + Over 2.5' },
      { code: '2+OVER-2.5', short: '2+O2.5', label: 'Trasferta + Over 2.5' },
      { code: '1+UNDER-2.5', short: '1+U2.5', label: 'Casa + Under 2.5' },
      { code: 'X+UNDER-2.5', short: 'X+U2.5', label: 'Pareggio + Under 2.5' },
      { code: '2+UNDER-2.5', short: '2+U2.5', label: 'Trasferta + Under 2.5' },
    ],
  },
  {
    title: 'Combo — GOL + Over/Under',
    options: [
      { code: 'GOL+OVER-2.5', short: 'G+O2.5', label: 'Gol + Over 2.5' },
      { code: 'GOL+OVER-1.5', short: 'G+O1.5', label: 'Gol + Over 1.5' },
      { code: 'GOL+UNDER-3.5', short: 'G+U3.5', label: 'Gol + Under 3.5' },
      { code: 'NOGOL+UNDER-2.5', short: 'NG+U2.5', label: 'No Gol + Under 2.5' },
      { code: 'NOGOL+OVER-1.5', short: 'NG+O1.5', label: 'No Gol + Over 1.5' },
    ],
  },
];
