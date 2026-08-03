"""Color-signature anti-cheat: only Star Yes bet slips are accepted.

Verifies :func:`thebesttiket._is_staryes_by_color` on:
  • All 12 real Star Yes fixtures under tests/fixtures/staryes_*
  • Synthetic non-staryes samples (Goldbet green, Sisal red, Snai white,
    Bet365 yellow, PlanetWin green, a plain dark-blue image that lacks
    the specific #102040 tone).

Runs OFFLINE — no HTTP, no LLM, no OCR.
"""
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from thebesttiket import _is_staryes_by_color  # noqa: E402

FIX = Path(__file__).parent / "fixtures"


def _bytes(img: Image.Image, fmt: str = "PNG") -> bytes:
    buf = BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


def _load(name: str) -> bytes:
    return (FIX / name).read_bytes()


# --------------------------------------------------------------------- STARYES
class TestRealStaryesFixtures:
    """All real staryes fixtures MUST pass the color gate."""

    FIXTURES = [
        "staryes_1x2_gg.webp",
        "staryes_combo.webp",
        "staryes_combo_real.png",
        "staryes_dc_gg_only.webp",
        "staryes_dnb_dc.webp",
        "staryes_full.png",
        "staryes_gg_combo_full.png",
        "staryes_markets.webp",
        "staryes_re_multigol.webp",
        "staryes_sample.webp",
        "staryes_sistemi_multigol.webp",
        "staryes_uo_dc.webp",
    ]

    def test_all_real_staryes_pass(self):
        failed = []
        for name in self.FIXTURES:
            ok, reason, _m = _is_staryes_by_color(_load(name))
            if not ok:
                failed.append(f"{name}: {reason}")
        assert not failed, "Real staryes slips MUST pass but did not:\n" + "\n".join(failed)


# ---------------------------------------------------------------- NON-STARYES
def _fake(bg, fg, w=200, h=400) -> bytes:
    """Small synthetic bet-slip lookalike."""
    img = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(img)
    for y in range(30, h - 20, 40):
        d.text((10, y), "MATCH X vs Y  1.85", fill=fg)
    return _bytes(img)


class TestNonStaryesRejection:

    def test_goldbet_green_rejected(self):
        ok, reason, _ = _is_staryes_by_color(_fake((5, 88, 33), (255, 255, 255)))
        assert not ok
        assert "sfondo" in reason.lower() or "blu" in reason.lower()

    def test_sisal_red_rejected(self):
        ok, _reason, _ = _is_staryes_by_color(_fake((200, 20, 30), (255, 255, 255)))
        assert not ok

    def test_snai_white_rejected(self):
        ok, _reason, _ = _is_staryes_by_color(_fake((255, 255, 255), (30, 30, 30)))
        assert not ok

    def test_bet365_yellow_rejected(self):
        ok, _reason, _ = _is_staryes_by_color(_fake((20, 60, 20), (255, 240, 0)))
        assert not ok

    def test_planetwin_dark_green_rejected(self):
        ok, _reason, _ = _is_staryes_by_color(_fake((18, 40, 22), (255, 255, 255)))
        assert not ok

    def test_wrong_dark_blue_rejected(self):
        # A dark blue that's NOT the staryes #102040 (too shifted toward
        # teal/purple) must be rejected — the gate is tonally strict.
        ok, reason, _ = _is_staryes_by_color(_fake((10, 25, 45), (255, 255, 255)))
        assert not ok
        assert "blu" in reason.lower()

    def test_empty_image_rejected(self):
        img = Image.new("RGB", (200, 400), (255, 255, 255))
        ok, _reason, _ = _is_staryes_by_color(_bytes(img))
        assert not ok

    def test_corrupt_bytes_rejected(self):
        ok, reason, _ = _is_staryes_by_color(b"not-a-real-image")
        assert not ok
        assert "leggibile" in reason.lower() or "sfondo" in reason.lower()
