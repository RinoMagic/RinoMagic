"""Standalone test for the staryes.it bet-slip parser.

Runs OCR on the shipped sample image and validates the parsed events.
Execute with:  python -m tests.test_staryes_parser
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import ocr_screenshot  # noqa: E402
import asyncio  # noqa: E402


SAMPLE = Path(__file__).parent / "fixtures" / "staryes_sample.webp"

EXPECTED = [
    {"home_team": "Frosinone", "away_team": "Juventus", "prediction": "2", "odd": 1.46},
    {"home_team": "Parma", "away_team": "Cagliari", "prediction": "GOL", "odd": 1.94},
    {"home_team": "Genoa", "away_team": "Napoli", "prediction": "UNDER", "odd": 2.75},
    {"home_team": "Udinese", "away_team": "Como", "prediction": "12", "odd": 1.30},
    {"home_team": "Inter", "away_team": "Monza", "prediction": "X", "odd": 5.90},
]


def main() -> int:
    raw = SAMPLE.read_bytes()
    result = asyncio.run(ocr_screenshot(raw))
    events = result["events"]

    print("=== RAW OCR ===")
    print(result["raw_text"])
    print("=== PARSED EVENTS ===")
    for e in events:
        print(e)

    if len(events) != len(EXPECTED):
        print(f"FAIL: expected {len(EXPECTED)} events, got {len(events)}")
        return 1

    errors = 0
    for i, (got, exp) in enumerate(zip(events, EXPECTED)):
        for key in ("home_team", "away_team", "prediction", "odd"):
            if str(got.get(key)).lower() != str(exp[key]).lower():
                print(f"[{i}] MISMATCH on {key}: expected {exp[key]!r} got {got.get(key)!r}")
                errors += 1
    if errors:
        print(f"FAIL: {errors} mismatches")
        return 1
    print("PASS: all 5 events parsed correctly")
    return 0


if __name__ == "__main__":
    sys.exit(main())
