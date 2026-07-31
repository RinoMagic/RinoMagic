"""Standalone tests for the staryes.it bet-slip parser.

Runs OCR on the shipped sample images and validates parsing + scoring.
Execute with:  python -m tests.test_staryes_parser
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import ocr_screenshot, _evaluate_prediction, _classify_bet  # noqa: E402
import asyncio  # noqa: E402


FIX = Path(__file__).parent / "fixtures"

# Sample 1: mix of 1X2, G/NG, U/O, DC (12), 1X2 pareggio
SAMPLE_1 = FIX / "staryes_sample.webp"
EXPECTED_1 = [
    {"home_team": "Frosinone", "away_team": "Juventus", "prediction": "2", "odd": 1.46},
    {"home_team": "Parma", "away_team": "Cagliari", "prediction": "GOL", "odd": 1.94},
    {"home_team": "Genoa", "away_team": "Napoli", "prediction": "UNDER-1.5", "odd": 2.75},
    {"home_team": "Udinese", "away_team": "Como", "prediction": "12", "odd": 1.30},
    {"home_team": "Inter", "away_team": "Monza", "prediction": "X", "odd": 5.90},
]

# Sample 2: Multigol totale + casa + ospite, doppia chance 1X, e un mercato
# non supportato (1° Tempo) — deve essere emesso con prediction="".
SAMPLE_2 = FIX / "staryes_markets.webp"
EXPECTED_2 = [
    {"home_team": "Frosinone", "away_team": "Juventus", "prediction": "MGA-0-1", "odd": 2.15},
    {"home_team": "Parma", "away_team": "Cagliari", "prediction": "MGH-0-2", "odd": 1.08},
    {"home_team": "Genoa", "away_team": "Napoli", "prediction": "MG-1-3", "odd": 1.30},
    {"home_team": "Udinese", "away_team": "Como", "prediction": "", "odd": 2.06},  # HT — rejected
    {"home_team": "Inter", "away_team": "Monza", "prediction": "1X", "odd": 1.04},
]


def run_ocr_test(sample_path: Path, expected: list) -> int:
    raw = sample_path.read_bytes()
    result = asyncio.run(ocr_screenshot(raw))
    events = result["events"]

    print(f"\n=== SAMPLE {sample_path.name} ===")
    for e in events:
        print(e)

    if len(events) != len(expected):
        print(f"FAIL: expected {len(expected)} events, got {len(events)}")
        print("--- RAW OCR ---")
        print(result["raw_text"])
        return 1
    errors = 0
    for i, (got, exp) in enumerate(zip(events, expected)):
        for key in ("home_team", "away_team", "prediction", "odd"):
            if str(got.get(key)).lower() != str(exp[key]).lower():
                print(f"[{i}] MISMATCH on {key}: expected {exp[key]!r} got {got.get(key)!r}")
                errors += 1
    if errors:
        return 1
    print(f"PASS ({len(events)} events)")
    return 0


def test_classifier() -> int:
    """Unit tests for _classify_bet without OCR noise."""
    cases = [
        (("1X2", "2"), "2"),
        (("1X2", "X"), "X"),
        (("1X2", "1"), "1"),
        (("1X", "1X"), "1X"),
        (("X2", "X2"), "X2"),
        (("12", "12"), "12"),
        (("G/NG", "GOL"), "GOL"),
        (("G/NG", "NOGOL"), "NOGOL"),
        (("U/O 1,5", "UNDER"), "UNDER-1.5"),
        (("U/O 2,5", "OVER"), "OVER-2.5"),
        (("U/O 3,5", "OVER"), "OVER-3.5"),
        # HT markets are NOT SUPPORTED anymore — must return None
        (("1X2 1°TEMPO", "X"), None),
        (("1X 1°TEMPO", "1X"), None),
        (("MULTIGOL 1-3", "SI"), "MG-1-3"),
        (("MULTIGOL 2-4", "SI"), "MG-2-4"),
        (("MULTIGOL 1-3", "NO"), "MG-1-3-NO"),
        (("MULTIGOL 0-2 CASA", "SI"), "MGH-0-2"),
        (("MULTIGOL 0-1 OSPITE", "SI"), "MGA-0-1"),
        # OCR-corrupted "IX" for "1X"
        (("IX", "1X"), "1X"),
        # Combo (hypothetical layout: pick has '+')
        (("1X2+G/NG", "1+GOL"), "1+GOL"),
        (("1X+U/O 2,5", "1X+OVER"), "1X+OVER-2.5"),
        # Real staryes combo layouts observed by the user
        (("1X + GG/NG", "1X + NG"), "1X+NOGOL"),
        (("1X2 + GG/NG", "1 + NG"), "1+NOGOL"),
        (("U/O 2,5 + GG/NG", "GG + OV"), "OVER-2.5+GOL"),  # ordered by market
        (("1X2 + G/NG", "2 + GOL"), "2+GOL"),
        # Combo with a single pick (staryes shortcut, e.g. "1X + MULTIGOL 1 3: SI")
        (("1X + MULTIGOL 1 3", "SI"), "1X+MG-1-3"),
        (("1X2 + U/O 1.5", "1 + UN"), "1+UNDER-1.5"),
        (("U/O 2.5 + GG/NG", "GG+OV"), "OVER-2.5+GOL"),
        # OCR errors
        (("4X + MULTIGOL 13", "SI"), "1X+MG-1-3"),  # 4X → 1X, "13" → 1-3
        (("U/O 2.5 + GG/NG", "GG+0V"), "OVER-2.5+GOL"),  # 0V → OV
    ]
    fails = 0
    for (market, pick), expected in cases:
        got = _classify_bet(market, pick)
        ok = got == expected
        print(f"  {'OK' if ok else 'FAIL'}  ({market!r}, {pick!r}) -> {got!r}   expected {expected!r}")
        if not ok:
            fails += 1
    print(f"Classifier: {len(cases) - fails}/{len(cases)} pass")
    return 0 if fails == 0 else 1
    fails = 0
    for (market, pick), expected in cases:
        got = _classify_bet(market, pick)
        ok = got == expected
        print(f"  {'OK' if ok else 'FAIL'}  ({market!r}, {pick!r}) -> {got!r}   expected {expected!r}")
        if not ok:
            fails += 1
    print(f"Classifier: {len(cases) - fails}/{len(cases)} pass")
    return 0 if fails == 0 else 1
    fails = 0
    for (market, pick), expected in cases:
        got = _classify_bet(market, pick)
        ok = got == expected
        print(f"  {'OK' if ok else 'FAIL'}  ({market!r}, {pick!r}) -> {got!r}   expected {expected!r}")
        if not ok:
            fails += 1
    print(f"Classifier: {len(cases) - fails}/{len(cases)} pass")
    return 0 if fails == 0 else 1


def test_evaluator() -> int:
    """Unit tests for _evaluate_prediction covering all markets."""
    def fx(h, a):
        return {"home_score": h, "away_score": a}

    cases = [
        # 1X2
        ("1", fx(2, 1), True),
        ("1", fx(1, 1), False),
        ("X", fx(1, 1), True),
        ("2", fx(0, 3), True),
        # DC
        ("1X", fx(1, 1), True),
        ("1X", fx(0, 2), False),
        ("X2", fx(1, 1), True),
        ("12", fx(1, 1), False),
        ("12", fx(2, 0), True),
        # GOL/NOGOL
        ("GOL", fx(1, 1), True),
        ("GOL", fx(2, 0), False),
        ("NOGOL", fx(2, 0), True),
        # Over/Under
        ("OVER-2.5", fx(2, 1), True),
        ("OVER-2.5", fx(1, 1), False),
        ("UNDER-2.5", fx(1, 1), True),
        ("OVER-0.5", fx(0, 0), False),
        ("OVER-0.5", fx(1, 0), True),
        # Multigol totale
        ("MG-1-3", fx(1, 2), True),
        ("MG-1-3", fx(2, 2), False),
        ("MG-1-3", fx(0, 0), False),
        ("MG-1-3-NO", fx(2, 2), True),
        # Multigol casa
        ("MGH-0-2", fx(2, 5), True),
        ("MGH-0-2", fx(3, 0), False),
        # Multigol ospite
        ("MGA-0-1", fx(4, 1), True),
        ("MGA-0-1", fx(0, 2), False),
        # Combos
        ("1+GOL", fx(2, 1), True),
        ("1+GOL", fx(2, 0), False),
        ("1X+OVER-2.5", fx(2, 1), True),
        ("X+UNDER-1.5", fx(1, 1), False),
        ("X+UNDER-2.5", fx(1, 1), True),
    ]
    fails = 0
    for pred, fixture, expected in cases:
        got = _evaluate_prediction(pred, fixture)
        ok = got == expected
        marker = "OK" if ok else "FAIL"
        print(f"  {marker}  eval({pred}, {fixture['home_score']}-{fixture['away_score']})"
              f" -> {got}   expected {expected}")
        if not ok:
            fails += 1
    print(f"Evaluator: {len(cases) - fails}/{len(cases)} pass")
    return 0 if fails == 0 else 1


def main() -> int:
    rc = 0
    rc |= run_ocr_test(SAMPLE_1, EXPECTED_1)
    rc |= run_ocr_test(SAMPLE_2, EXPECTED_2)
    print("\n=== CLASSIFIER UNIT TESTS ===")
    rc |= test_classifier()
    print("\n=== EVALUATOR UNIT TESTS ===")
    rc |= test_evaluator()
    print("\n" + ("ALL TESTS PASSED" if rc == 0 else "SOME TESTS FAILED"))
    return rc


if __name__ == "__main__":
    sys.exit(main())
