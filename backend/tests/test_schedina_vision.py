"""Unit tests for `schedina_vision.py` — the AI Vision extractor.

We mock the LLM call, we only verify:
- prediction normalisation (upper-case, thresholds, aliases, combos)
- reply parsing (markdown fences, malformed JSON, mixed content)
- sanitize_events (missing fields, invalid odds, non-list input)
- image sanitisation (PIL passes on JPG/PNG, resizes big shots)
"""
from __future__ import annotations

import io
import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from schedina_vision import (  # noqa: E402
    _normalize_prediction,
    _parse_json_reply,
    _sanitize_events,
    _sanitize_image,
)


# =========================================================================
# Prediction normalisation
# =========================================================================
class TestNormalizePrediction:
    @pytest.mark.parametrize("raw, expected", [
        ("1", "1"), ("X", "X"), ("2", "2"),
        ("1x", "1X"), ("X 2", "X2"), ("12", "12"),
        ("GOL", "GOL"), ("gol", "GOL"), ("NOGOL", "NOGOL"),
        ("GG", "GOL"), ("BTTS", "GOL"),
        ("NG", "NOGOL"), ("NOBTTS", "NOGOL"),
        # Over/Under variants
        ("Over 2.5", "OVER-2.5"), ("over2,5", "OVER-2.5"),
        ("OVER", "OVER-2.5"),  # defaults to 2.5
        ("UNDER 1.5", "UNDER-1.5"),
        ("OVER-3.5", "OVER-3.5"),
        # Multigol
        ("MG-1-3", "MG-1-3"), ("MGH-2-4", "MGH-2-4"), ("MGA-1-2-NO", "MGA-1-2-NO"),
        # Combos
        ("1X+GOL", "1X+GOL"), ("2 + OVER 2.5", "2+OVER-2.5"),
        ("1+MG-1-3", "1+MG-1-3"),
    ])
    def test_valid(self, raw, expected):
        assert _normalize_prediction(raw) == expected

    @pytest.mark.parametrize("raw", [
        None, "", "  ", "RIS-2-1",           # exact score not supported
        "HANDICAP-1", "MARCATORE", "FOO",     # unknown atoms
        "1X+FOO",                             # partial combo rejected
    ])
    def test_rejected(self, raw):
        assert _normalize_prediction(raw) == ""


# =========================================================================
# JSON parsing
# =========================================================================
class TestParseJsonReply:
    def test_plain_json(self):
        s = '{"events": [{"a": 1}]}'
        assert _parse_json_reply(s) == {"events": [{"a": 1}]}

    def test_markdown_fenced(self):
        s = '```json\n{"events": []}\n```'
        assert _parse_json_reply(s) == {"events": []}

    def test_fenced_no_lang(self):
        s = '```\n{"events": []}\n```'
        assert _parse_json_reply(s) == {"events": []}

    def test_extra_prose_around(self):
        s = 'Ecco il risultato:\n{"events": [{"x": 1}]}\nGrazie!'
        assert _parse_json_reply(s) == {"events": [{"x": 1}]}

    def test_malformed_returns_empty(self):
        assert _parse_json_reply("not json at all") == {}
        assert _parse_json_reply("") == {}


# =========================================================================
# Sanitize events
# =========================================================================
class TestSanitizeEvents:
    def test_ok(self):
        raw = [{
            "home_team": "Juventus", "away_team": "Milan",
            "market_raw": "1X2", "prediction": "1", "odd": 1.85,
        }]
        out = _sanitize_events(raw)
        assert len(out) == 1
        e = out[0]
        assert e["home_team"] == "Juventus"
        assert e["away_team"] == "Milan"
        assert e["prediction"] == "1"
        assert e["odd"] == 1.85

    def test_missing_teams_dropped(self):
        raw = [
            {"home_team": "Juve", "away_team": "", "prediction": "1", "odd": 1.5},
            {"home_team": "Napoli", "away_team": "Roma", "prediction": "X", "odd": 3.2},
        ]
        out = _sanitize_events(raw)
        assert len(out) == 1
        assert out[0]["home_team"] == "Napoli"

    def test_odd_string_with_comma(self):
        raw = [{"home_team": "A", "away_team": "B", "prediction": "1", "odd": "1,85"}]
        out = _sanitize_events(raw)
        assert out[0]["odd"] == 1.85

    def test_invalid_odd_becomes_zero(self):
        raw = [{"home_team": "A", "away_team": "B", "prediction": "1", "odd": -5}]
        out = _sanitize_events(raw)
        assert out[0]["odd"] == 0.0

    def test_unknown_prediction_kept_empty(self):
        """Events with unrecognised markets are still returned (so the client
        can show them as 'MERCATO NON AMMESSO') but prediction is empty."""
        raw = [{"home_team": "A", "away_team": "B",
                "market_raw": "Risultato Esatto", "prediction": "2-1", "odd": 8.0}]
        out = _sanitize_events(raw)
        assert len(out) == 1
        assert out[0]["prediction"] == ""
        assert out[0]["market_raw"] == "Risultato Esatto"

    def test_non_list_returns_empty(self):
        assert _sanitize_events(None) == []
        assert _sanitize_events("nope") == []
        assert _sanitize_events({"events": []}) == []


# =========================================================================
# Image sanitisation
# =========================================================================
class TestSanitizeImage:
    def _make_png(self, w=100, h=100, color=(255, 0, 0)):
        from PIL import Image
        img = Image.new("RGB", (w, h), color)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    def _make_jpeg(self, w=100, h=100):
        from PIL import Image
        img = Image.new("RGB", (w, h), (0, 128, 0))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        return buf.getvalue()

    def test_png_passes_through(self):
        raw = self._make_png()
        mime, out = _sanitize_image(raw)
        assert mime == "image/png"
        # Should still be a valid PNG (re-encoded)
        from PIL import Image
        img = Image.open(io.BytesIO(out))
        assert img.format == "PNG"

    def test_jpeg_kept_as_jpeg(self):
        raw = self._make_jpeg()
        mime, out = _sanitize_image(raw)
        assert mime == "image/jpeg"

    def test_oversized_is_resized(self):
        raw = self._make_png(w=3000, h=2000)
        _mime, out = _sanitize_image(raw)
        from PIL import Image
        img = Image.open(io.BytesIO(out))
        assert max(img.size) <= 2000, f"Expected downscale, got {img.size}"

    def test_garbage_bytes_returns_passthrough(self):
        # PIL raises → helper should return the original bytes
        mime, out = _sanitize_image(b"\x00\x01\x02\x03garbage")
        assert out == b"\x00\x01\x02\x03garbage"
        assert mime == "image/png"


# =========================================================================
# End-to-end: mock the LLM reply and go through extract_events_from_image
# =========================================================================
def _fake_reply(text: str):
    """Object with a .content attribute so _stringify_reply picks it up."""
    class R:
        content = text
    return R()


@pytest.mark.asyncio
async def test_extract_events_from_image_happy_path(monkeypatch):
    """Full pipeline: image → mocked Gemini → structured events."""
    import schedina_vision as sv

    # Fake reply from the model
    reply_json = json.dumps({
        "events": [
            {"home_team": "Juventus", "away_team": "Milan",
             "market_raw": "1X2", "prediction": "1", "odd": 1.85},
            {"home_team": "Inter", "away_team": "Roma",
             "market_raw": "Gol/No Gol", "prediction": "GOL", "odd": 1.62},
            {"home_team": "Napoli", "away_team": "Lazio",
             "market_raw": "U/O 2.5", "prediction": "over 2,5", "odd": 1.75},
        ]
    })

    class FakeChat:
        def __init__(self, *a, **kw): pass
        def with_model(self, *a, **kw): return self
        async def send_message(self, *a, **kw):
            return _fake_reply(reply_json)

    monkeypatch.setattr(sv, "is_available", lambda: True)

    # Patch the import inside extract_events_from_image
    import emergentintegrations.llm.chat as chat_mod
    monkeypatch.setattr(chat_mod, "LlmChat", FakeChat, raising=False)

    # Feed a real PNG through so image sanitisation succeeds.
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (50, 50), (255, 255, 255)).save(buf, format="PNG")

    out = await sv.extract_events_from_image(buf.getvalue())
    assert out["error"] is None
    assert len(out["events"]) == 3
    assert out["events"][0]["prediction"] == "1"
    assert out["events"][2]["prediction"] == "OVER-2.5"  # normalised


@pytest.mark.asyncio
async def test_extract_events_from_image_no_key(monkeypatch):
    import schedina_vision as sv
    monkeypatch.setattr(sv, "is_available", lambda: False)
    out = await sv.extract_events_from_image(b"fake")
    assert out["events"] == []
    assert "EMERGENT_LLM_KEY" in (out["error"] or "")
