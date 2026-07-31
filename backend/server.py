"""SchedinaBar — mini-fantacalcio Serie A challenge among friends.

Flow:
1. Admin creates a Room for a matchday (with color + max_events per schedina)
2. Friends join with invite code + nickname (no password)
3. Each user uploads a betting-slip screenshot → OCR parses events + odds
4. User confirms/edits parsed events → stored in DB
5. Admin fetches or manually inputs the Serie A matchday results
6. System computes each user's product-of-odds on WON predictions only
7. Leaderboard: highest total wins, lowest pays.
"""
import os
import re
import io
import uuid
import base64
import string
import random
import logging
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Dict, Any

import jwt
import httpx
import pytesseract
from PIL import Image, ImageOps, ImageFilter
from fastapi import FastAPI, APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
from pydantic import BaseModel, Field, field_validator

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_MINUTES = int(os.environ.get("ACCESS_TOKEN_MINUTES", "20160"))
API_FOOTBALL_KEY = os.environ.get("API_FOOTBALL_KEY", "").strip()
API_FOOTBALL_BASE = os.environ.get("API_FOOTBALL_BASE", "https://v3.football.api-sports.io").rstrip("/")
SERIE_A_LEAGUE_ID = int(os.environ.get("SERIE_A_LEAGUE_ID", "135"))
CURRENT_SEASON = int(os.environ.get("CURRENT_SEASON", "2024"))
TESSERACT_LANG = os.environ.get("TESSERACT_LANG", "ita+eng")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="RinoMagic API")
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)
logger = logging.getLogger("schedinabar")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")


def _ensure_tesseract() -> bool:
    """Verify tesseract binary is available. If missing on a Debian-based
    container, attempt a best-effort install (idempotent). Returns True when
    the binary is usable after this call."""
    import shutil
    import subprocess
    if shutil.which("tesseract"):
        return True
    logger.warning("tesseract binary missing; attempting to install...")
    try:
        env = os.environ.copy()
        env.setdefault("DEBIAN_FRONTEND", "noninteractive")
        subprocess.run(
            ["apt-get", "install", "-y", "--no-install-recommends",
             "tesseract-ocr", "tesseract-ocr-ita"],
            check=True, env=env, capture_output=True, timeout=180,
        )
    except Exception as exc:  # pragma: no cover - environment dependent
        logger.error("Failed to auto-install tesseract: %s", exc)
        return False
    ok = shutil.which("tesseract") is not None
    if ok:
        logger.info("tesseract installed successfully")
    return ok


_ensure_tesseract()


# ============ Models ============
ROOM_COLORS = ["#00D95F", "#FFB300", "#EF4444", "#3B82F6", "#A855F7", "#EC4899", "#14B8A6", "#F97316"]

# Prediction codes we accept.
# Simple markets:
#   1  X  2  1X  X2  12          -> 1X2 + Double chance (final score)
#   GOL  NOGOL                     -> Both teams to score
#   OVER-0.5..OVER-4.5             -> Over goals with threshold
#   UNDER-0.5..UNDER-4.5           -> Under goals with threshold
#   MG-<a>-<b>                     -> Multigol totale (a..b inclusive, SI)
#   MG-<a>-<b>-NO                  -> Multigol totale NO
#   MGH-<a>-<b>[-NO]               -> Multigol casa
#   MGA-<a>-<b>[-NO]               -> Multigol ospite
# Combo: any of the above joined by '+', all conditions must be true, e.g.:
#   1+GOL          X+OVER-2.5      1X+MG-1-3       12+GOL+OVER-1.5
_SIMPLE_ATOM_RE = re.compile(
    r"^(?:"
    r"1X|X2|12|1|X|2"                    # 1X2 / Double chance (final score)
    r"|GOL|NOGOL"
    r"|(?:OVER|UNDER)-\d(?:\.\d)?"       # Over/Under with threshold
    r"|MG[HA]?-\d-\d(?:-NO)?"            # Multigol total/home/away
    r")$"
)


def _validate_prediction_code(code: str) -> str:
    """Validate and normalize a prediction code.

    Accepts legacy short forms and returns a canonical code:
        "OVER" -> "OVER-2.5"    "UNDER" -> "UNDER-2.5"
        "OVER2.5" or "OVER 2.5" -> "OVER-2.5"
    Combos joined by '+' are validated atom-by-atom.
    """
    if not code:
        raise ValueError("Pronostico mancante")

    def normalize_atom(a: str) -> str:
        a = a.strip().upper()
        # OVER/UNDER with optional threshold (spaces or no separator)
        m = re.match(r"^(OVER|UNDER)[\s-]*(\d(?:[.,]\d)?)?$", a)
        if m:
            side = m.group(1)
            thr = (m.group(2) or "2.5").replace(",", ".")
            if "." not in thr:
                thr = f"{thr}.5"
            return f"{side}-{thr}"
        return a

    atoms = [normalize_atom(a) for a in code.split("+")]
    canonical = "+".join(atoms)
    for a in atoms:
        if not _SIMPLE_ATOM_RE.match(a):
            raise ValueError(f"Mercato non ammesso: {code}")
    return canonical


class RoomCreate(BaseModel):
    name: str = Field(min_length=2, max_length=40)
    matchday: int = Field(ge=1, le=38)
    max_events: int = Field(ge=1, le=10, default=5)
    color: Optional[str] = None


class RoomUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=40)
    matchday: Optional[int] = Field(default=None, ge=1, le=38)
    max_events: Optional[int] = Field(default=None, ge=1, le=10)
    color: Optional[str] = None
    # ISO-8601 datetime string. Send an empty string to clear the deadline.
    deadline_at: Optional[str] = None


class RoomJoin(BaseModel):
    invite_code: str


class SchedinaEventIn(BaseModel):
    home_team: str
    away_team: str
    prediction: str
    odd: float = Field(gt=0, le=1000)

    @field_validator("prediction")
    @classmethod
    def _norm_pred(cls, v: str) -> str:
        return _validate_prediction_code(v.strip().upper().replace(" ", ""))


class SchedinaConfirm(BaseModel):
    # events are IGNORED by the confirm endpoint (server always uses the OCR
    # draft) but the field is kept for backward compatibility with older clients.
    events: Optional[List[SchedinaEventIn]] = None


class FixtureIn(BaseModel):
    home_team: str
    away_team: str
    home_score: int = Field(ge=0)
    away_score: int = Field(ge=0)
    both_scored: Optional[bool] = None  # if None, computed from scores


class FixturesIn(BaseModel):
    fixtures: List[FixtureIn]


# ============ Helpers ============
def gen_code(n: int = 6) -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=n))


# Auth router + current-user dep are built from the auth module below.
from auth import build_auth_router, seed_admin_if_missing  # noqa: E402

_auth_router, _current_user_dep = build_auth_router(db)
api.include_router(_auth_router)


async def current_user(user: dict = Depends(_current_user_dep)) -> dict:
    return user


async def require_admin(user: dict = Depends(_current_user_dep)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Solo admin")
    return user


def display_name(user: dict) -> str:
    """Return a friendly display name for a user (username or email prefix)."""
    if user.get("username"):
        return user["username"]
    email = user.get("email") or ""
    return email.split("@")[0] if email else "admin"


def _norm_team(name: str) -> str:
    """Aggressive team-name normalization for matching predictions vs results.

    Lowercase, strip punctuation, remove common suffixes (FC, AC, CF, US, ...).
    """
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(
        r"\b(fc|ac|cf|us|ss|calcio|football|club|serie|a)\b",
        " ",
        s,
    )
    return re.sub(r"\s+", " ", s).strip()


def _team_match(a: str, b: str) -> bool:
    na, nb = _norm_team(a), _norm_team(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    # Substring / token overlap heuristic
    if na in nb or nb in na:
        return True
    ta, tb = set(na.split()), set(nb.split())
    if not ta or not tb:
        return False
    overlap = ta & tb
    return len(overlap) >= 1 and len(overlap) >= min(len(ta), len(tb)) // 2


def _evaluate_prediction(pred: str, fx: dict) -> bool:
    """Return True if `pred` is correct given the fixture final score.

    Supports combos: multiple atoms joined by '+' — all must be true.
    `fx` must contain: home_score, away_score.
    """
    if not pred:
        return False
    home = int(fx.get("home_score", 0))
    away = int(fx.get("away_score", 0))
    total = home + away

    def eval_atom(atom: str) -> bool:
        atom = atom.upper().strip()
        # Risultato esatto (RE-<home>-<away>)
        m = re.match(r"^RE-(\d+)-(\d+)$", atom)
        if m:
            return home == int(m.group(1)) and away == int(m.group(2))
        # Multigol (total / home / away, optional NO suffix)
        m = re.match(r"^(MG|MGH|MGA)-(\d)-(\d)(-NO)?$", atom)
        if m:
            kind, a, b, no = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)
            if kind == "MG":
                value = total
            elif kind == "MGH":
                value = home
            else:  # MGA
                value = away
            in_range = a <= value <= b
            return (not in_range) if no else in_range
        # Over / Under with threshold
        m = re.match(r"^(OVER|UNDER)-(\d(?:\.\d)?)$", atom)
        if m:
            side, thr = m.group(1), float(m.group(2))
            return total > thr if side == "OVER" else total < thr
        # GOL / NOGOL
        if atom == "GOL":
            return home > 0 and away > 0
        if atom == "NOGOL":
            return home == 0 or away == 0
        # 1X2 / Double chance (final score)
        return _eval_1x2_dc(atom, home, away)

    for a in pred.split("+"):
        if not eval_atom(a):
            return False
    return True


def _eval_1x2_dc(pick: str, home: int, away: int) -> bool:
    pick = pick.upper()
    if pick == "1":
        return home > away
    if pick == "X":
        return home == away
    if pick == "2":
        return home < away
    if pick == "1X":
        return home >= away
    if pick == "X2":
        return home <= away
    if pick == "12":
        return home != away
    return False


# ============ OCR ============
def _preprocess_image(raw_bytes: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
    # Resize up if small
    w, h = img.size
    if w < 900:
        scale = 900 / w
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    # Convert to grayscale + increase contrast + slight sharpen
    gray = ImageOps.grayscale(img)
    gray = ImageOps.autocontrast(gray, cutoff=2)
    gray = gray.filter(ImageFilter.SHARPEN)
    return gray


# ---- staryes.it bet-slip parser --------------------------------------------
# Each event block on staryes.it looks like:
#   CALCIO - SERIE A | 18:30           <-- header line (competition + kickoff)
#   7965  FROSINONE  -  JUVENTUS       <-- optional event id + teams
#   1X2: 2                       1.46  <-- market + prediction + odd
STARYES_HEADER_RE = re.compile(
    r"CALCIO\s*[-–]\s*SERIE\s*A", re.IGNORECASE
)
# Team line: optional 3-5 digit event id, then TEAM_A - TEAM_B (uppercase words).
STARYES_TEAMS_RE = re.compile(
    r"^\s*(?:\d{3,5}\s+)?([A-ZÀ-Ú][A-ZÀ-Ú\s.'’]+?)\s+[-–]\s+([A-ZÀ-Ú][A-ZÀ-Ú\s.'’]+?)\s*$"
)
STARYES_ODD_TAIL_RE = re.compile(r"([1-9]\d?[.,]\d{1,3})\s*$")


def _titleize(name: str) -> str:
    """FROSINONE -> Frosinone;  HELLAS VERONA -> Hellas Verona."""
    parts = re.split(r"(\s+)", name.strip())
    return "".join(p if p.isspace() else (p[:1].upper() + p[1:].lower()) for p in parts)


def _normalize_ocr_token(token: str) -> str:
    """Fix common OCR misreads on staryes bet-slip picks and market labels."""
    if not token:
        return token
    t = token
    # Common OCR errors on the '1' character in double-chance tokens: the
    # digit "1" is frequently misread by tesseract depending on the font
    # weight and anti-aliasing. Observed real cases on staryes.it slips:
    #   1X -> 4X, IX, LX, TX, DX, JX, |X, iX, lX
    #   X1 -> X4, XI, XL, XT
    #   12 -> 42, I2, L2, T2, J2, |2
    # Apply the fix ONLY on typical bet tokens so we don't clobber legit
    # digits inside team names or odds.
    for wrong in ("4X", "IX", "LX", "TX", "DX", "JX", "|X", "iX", "lX"):
        if wrong in t:
            t = t.replace(wrong, "1X")
    for wrong in ("X4", "XI", "XL", "XT", "XJ", "X|"):
        if wrong in t:
            t = t.replace(wrong, "X1")
    for wrong in ("42", "I2", "L2", "T2", "J2", "|2"):
        # Only inside short bet tokens (avoid clobbering odds like "42.00")
        if wrong in t and len(t) <= 4:
            t = t.replace(wrong, "12")
    # 'O' misread as '0' when followed by other capitals ("0V" -> "OV").
    t = re.sub(r"\b0([A-Z])", r"O\1", t)
    return t


def _classify_bet(market_raw: str, pick_raw: str) -> Optional[str]:
    """Given the market label and pick as printed on staryes.it, return the
    canonical prediction code (or None if unrecognised).

    Examples:
        ("1X2", "2")                    -> "2"
        ("G/NG", "GOL")                 -> "GOL"
        ("U/O 1,5", "UNDER")            -> "UNDER-1.5"
        ("1X2 1°TEMPO", "X")            -> "HT-X"
        ("1X", "1X")                    -> "1X"
        ("MULTIGOL 0-1 OSPITE", "SI")   -> "MGA-0-1"
        ("MULTIGOL 0-2 CASA", "SI")     -> "MGH-0-2"
        ("MULTIGOL 1-3", "SI")          -> "MG-1-3"
        # Combo layouts observed on real staryes tickets
        ("1X + GG/NG", "1X + NG")       -> "1X+NOGOL"
        ("U/O 2,5 + GG/NG", "GG + OV")  -> "GOL+OVER-2.5"   (pick order swapped)
        ("1X + MULTIGOL 1 3", "SI")     -> "1X+MG-1-3"      (single pick, implicit)
        ("1X2 + U/O 1,5", "1 + UN")     -> "1+UNDER-1.5"    (UN alias)
    """
    if pick_raw is None:
        return None
    market = _normalize_ocr_token(market_raw.upper().replace("°", "").replace(",", "."))
    pick = _normalize_ocr_token(
        re.sub(r"[^A-Z0-9./,+-]", "", pick_raw.upper().replace(",", "."))
    )
    if not pick:
        return None

    market_atoms = [m.strip() for m in market.split("+") if m.strip()]
    pick_atoms = [p for p in pick.split("+") if p]

    # Combo: the market label lists more than one market joined by '+'
    if len(market_atoms) > 1:
        codes: List[str] = []
        used_picks: set = set()
        for ma in market_atoms:
            code = None
            # 1. Try each unused pick atom (semantic, not positional match)
            for k, pa in enumerate(pick_atoms):
                if k in used_picks:
                    continue
                c = _classify_bet(ma, pa)
                if c:
                    code = c
                    used_picks.add(k)
                    break
            # 2. Implicit: use the market atom as its own pick
            #    (e.g. market atom "1X" with implicit pick "1X")
            if not code:
                c = _classify_bet(ma, ma)
                if c:
                    code = c
            # 3. Default "SI" for Multigol markets (staryes often prints only "SI"
            #    for the whole combo confirmation)
            if not code and ("MULTIGOL" in ma or "MULTI GOL" in ma):
                c = _classify_bet(ma, "SI")
                if c:
                    code = c
            if not code:
                return None
            codes.append(code)
        return "+".join(codes)

    # Detect first-half markets — NOT SUPPORTED: any HT market returns None
    # so the frontend flags it as "MERCATO NON AMMESSO".
    if any(tag in market for tag in ("1TEMPO", "1 TEMPO", "PRIMO TEMPO", "1T ", " 1T", "1H", " HT ")):
        return None

    # Multigol (total / home / away). Accept both "1-3" and "1 3" separators;
    # tolerate OCR losing the separator entirely ("MULTIGOL 13" -> range 1-3).
    if "MULTIGOL" in market or "MULTI GOL" in market:
        rng = (
            re.search(r"(\d)\s*[-–]\s*(\d)", market)
            or re.search(r"(\d)\s+(\d)", market)
        )
        if not rng:
            # Concatenated 2-digit range like "13" (=1-3), "24" (=2-4), "03" (=0-3).
            # Only accept when the 2 digits form a plausible bet-slip range
            # (0..5, first digit <= second digit).
            m2 = re.search(r"\b(\d)(\d)\b", market)
            if m2:
                a, b = int(m2.group(1)), int(m2.group(2))
                if 0 <= a <= b <= 5:
                    rng = m2
        if not rng:
            return None
        a, b = rng.group(1), rng.group(2)
        if "CASA" in market or "HOME" in market:
            base = "MGH"
        elif "OSPITE" in market or "AWAY" in market or "TRASF" in market:
            base = "MGA"
        else:
            base = "MG"
        code = f"{base}-{a}-{b}"
        if pick in {"NO", "N"}:
            code += "-NO"
        elif pick not in {"SI", "S", "YES", "Y", "GOL", "1", ""}:
            # Unexpected pick for multigol
            return None
        return code

    # G/NG (both teams to score)
    if market in {"G/NG", "GG/NG", "GG", "NG"} or "GOL/NOGOL" in market or "GOL/NO GOL" in market:
        if pick in {"GOL", "GG", "SI", "S", "YES", "1"}:
            return "GOL"
        if pick in {"NOGOL", "NG", "NO", "N", "0"}:
            return "NOGOL"
        return None

    # Over / Under (threshold-aware). Tolerate the very common OCR misread
    # where the letter "O" is picked up as the digit "0" (e.g. "U/0 1,5").
    if (
        "U/O" in market or "O/U" in market
        or "U/0" in market or "0/U" in market
        or "OVER" in market or "UNDER" in market
        or "0VER" in market or "0/O" in market
    ):
        # Normalise "0" (digit) back to "O" (letter) inside the market label
        # so the threshold detection below doesn't accidentally pick up that
        # zero as the goals threshold.
        market_norm = (
            market.replace("U/0", "U/O").replace("0/U", "O/U")
            .replace("0VER", "OVER").replace("0/O", "O/O")
        )
        thr_match = re.search(r"(\d(?:\.\d)?)", market_norm)
        threshold = thr_match.group(1) if thr_match else "2.5"
        # normalise threshold to "X.5" or integer
        if "." not in threshold:
            threshold = f"{threshold}.5"
        if pick.startswith("OVER") or pick in {"O", "OV"}:
            return f"OVER-{threshold}"
        if pick.startswith("UNDER") or pick in {"U", "UN"}:
            return f"UNDER-{threshold}"
        return None

    # Draw No Bet (aka DNB): pick "1" -> home wins (draw refunded, treated as
    # loss in our binary win/loss model but semantically the closest code is
    # "1"). Same for "2". A pick of "X" makes no sense for DNB.
    if "DRAW NO BET" in market or market in {"DNB", "DRAW-NO-BET"}:
        if pick in {"1", "2"}:
            return pick
        return None

    # Risultato esatto (exact final score). Pick format on staryes: "0-2" or
    # "2:1"; sometimes OCR joins the digits ("02"). Accept a wide range.
    if (
        "RISULTATO ESATTO" in market or "ESATTO" in market
        or market in {"RE", "R.ESATTO", "R-ESATTO"}
    ):
        m = re.search(r"(\d+)\s*[-–:.]\s*(\d+)", pick)
        if not m:
            # Try two-digit compact form like "21" -> 2-1 (only for reasonable scores)
            m2 = re.search(r"\b(\d)(\d)\b", pick)
            if m2:
                a, b = int(m2.group(1)), int(m2.group(2))
                if a <= 9 and b <= 9:
                    return f"RE-{a}-{b}"
            return None
        a, b = int(m.group(1)), int(m.group(2))
        if a > 20 or b > 20:  # sanity guard
            return None
        return f"RE-{a}-{b}"

    # 1X2 / Double chance (final score only — no HT markets supported)
    # Market label may be "1X2", "1X", "X2", "12", "IX" (OCR of "1X"), etc.
    if pick in {"1", "X", "2"}:
        return pick
    if pick in {"1X", "X2", "12", "IX"}:
        return "1X" if pick == "IX" else pick
    # As a last resort, if the pick is GOL/NOGOL alone
    if pick in {"GOL", "NOGOL"}:
        return pick

    _ = pick_atoms  # kept for parity with combo branch
    return None


def _parse_staryes_slip(raw_text: str) -> List[dict]:
    """Parse a staryes.it bet slip out of raw OCR text.

    Strategy: use each TEAM line (e.g. `7965 FROSINONE - JUVENTUS`) as an
    event anchor. For each team line, look forward within its block (until
    the next team line) for a bet line ending with a decimal odd. This is
    resilient to:
      - The very first event missing the `CALCIO - SERIE A` header (image
        cropped at top).
      - Extra "trash" lines between events (icons, dates, IDs).
    """
    lines = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]
    if not lines:
        return []

    team_anchors: List[tuple[int, str, str]] = []
    for i, ln in enumerate(lines):
        m = STARYES_TEAMS_RE.match(ln)
        if m:
            team_anchors.append((i, m.group(1).strip(), m.group(2).strip()))
    if not team_anchors:
        return []

    events: List[dict] = []
    for k, (idx, home, away) in enumerate(team_anchors):
        end = team_anchors[k + 1][0] if k + 1 < len(team_anchors) else len(lines)
        for ln in lines[idx + 1:end]:
            om = STARYES_ODD_TAIL_RE.search(ln)
            if not om:
                continue
            try:
                candidate = float(om.group(1).replace(",", "."))
            except ValueError:
                continue
            if not (1.01 <= candidate <= 999):
                continue
            pred_fragment = ln[: om.start()].strip()
            if ":" in pred_fragment:
                market_raw, pick_raw = pred_fragment.rsplit(":", 1)
            else:
                tokens = pred_fragment.split()
                market_raw = " ".join(tokens[:-1]) if len(tokens) > 1 else ""
                pick_raw = tokens[-1] if tokens else ""
            pred = _classify_bet(market_raw, pick_raw)
            events.append({
                "home_team": _titleize(home),
                "away_team": _titleize(away),
                # Empty prediction signals "MERCATO NON AMMESSO" to the frontend
                # so the user can pick a valid market manually before saving.
                "prediction": pred or "",
                "odd": round(candidate, 3),
                "market_raw": pred_fragment.strip(),
            })
            break  # Only one bet line per event

    seen = set()
    dedup: List[dict] = []
    for e in events:
        key = (e["home_team"].lower(), e["away_team"].lower(), e["prediction"])
        if key in seen:
            continue
        seen.add(key)
        dedup.append(e)
    return dedup


async def ocr_screenshot(image_bytes: bytes) -> Dict[str, Any]:
    """Run OCR with two strategies (raw + preprocessed) and pick the best
    parsed result. The staryes.it slip uses light blue text over a dark blue
    background: heavy preprocessing sometimes wipes the coloured predictions,
    so keeping the raw image as a fallback is important."""
    if not _ensure_tesseract():
        raise HTTPException(
            status_code=503,
            detail="Motore OCR non disponibile sul server. Riprova tra qualche secondo o inserisci manualmente i pronostici.",
        )
    original = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    processed = _preprocess_image(image_bytes)

    best_text = ""
    best_events: List[dict] = []
    ocr_error: Optional[str] = None
    for candidate in (original, processed):
        try:
            text = pytesseract.image_to_string(candidate, lang=TESSERACT_LANG)
        except Exception as exc:
            ocr_error = str(exc)
            logger.warning("OCR failure: %s", exc)
            continue
        events = _parse_staryes_slip(text)
        # Debug logging: helps diagnose why a market is flagged as
        # "MERCATO NON AMMESSO" — writes the raw OCR text and the parsed
        # events (with market_raw) to the backend log.
        logger.info("OCR raw text (%d chars):\n%s", len(text), text)
        logger.info("OCR parsed events: %s", events)
        if len(events) > len(best_events):
            best_events = events
            best_text = text
        elif not best_text:
            best_text = text
    if not best_text and ocr_error:
        raise HTTPException(
            status_code=503,
            detail=f"OCR fallito: {ocr_error}. Riprova o inserisci manualmente i pronostici.",
        )
    return {"raw_text": best_text, "events": best_events}


# ============ Startup ============
@app.on_event("startup")
async def startup():
    await db.rooms.create_index("id", unique=True)
    await db.rooms.create_index("invite_code", unique=True)
    await db.memberships.create_index([("room_id", 1), ("user_id", 1)], unique=True)
    await db.schedine.create_index([("room_id", 1), ("user_id", 1)], unique=True)
    await db.fixtures.create_index([("room_id", 1), ("home_team", 1), ("away_team", 1)], unique=True)
    await db.users.create_index("id", unique=True)
    # Enforce uniqueness only when email/username are non-empty strings, so
    # missing fields never collide. This is safer than unique+sparse.
    await db.users.create_index(
        "email", unique=True,
        partialFilterExpression={"email": {"$type": "string"}},
    )
    await db.users.create_index(
        "username", unique=True,
        partialFilterExpression={"username": {"$type": "string"}},
    )
    await db.reset_tokens.create_index("token", unique=True)
    await db.reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.invites.create_index("code", unique=True)
    await db.invites.create_index([("room_id", 1), ("used_by_user_id", 1)])
    # Backfill: for legacy rooms that still have a single `invite_code` field
    # but no invite doc, create the corresponding invite record. This keeps
    # existing invite links working after the "one-shot invite" migration.
    async for r in db.rooms.find({"invite_code": {"$exists": True}}, {"id": 1, "invite_code": 1, "admin_user_id": 1, "created_at": 1, "_id": 0}):
        existing = await db.invites.find_one({"code": r["invite_code"]})
        if not existing:
            await db.invites.insert_one({
                "id": str(uuid.uuid4()),
                "room_id": r["id"],
                "code": r["invite_code"],
                "used_by_user_id": None,
                "used_at": None,
                "created_at": r.get("created_at") or datetime.now(timezone.utc).isoformat(),
                "created_by": r.get("admin_user_id"),
                "revoked_at": None,
            })
    await seed_admin_if_missing(db)
    logger.info("RinoMagic API started")


@app.on_event("shutdown")
async def shutdown():
    client.close()


# ============ Rooms ============
async def _room_dict(room: dict, viewer: Optional[dict] = None) -> dict:
    members_count = await db.memberships.count_documents({"room_id": room["id"]})
    settled = room.get("status") == "settled"
    is_admin_of_room = False
    if viewer:
        # Any user with role=admin controls all rooms; also room creators are admins.
        is_admin_of_room = viewer["role"] == "admin" or viewer["id"] == room.get("admin_user_id")
    # Invite stats: how many single-use invites exist and how many are still available.
    invites_total = await db.invites.count_documents({"room_id": room["id"], "revoked_at": None})
    invites_available = await db.invites.count_documents({"room_id": room["id"], "revoked_at": None, "used_by_user_id": None})
    # Deadline: after this instant, players cannot submit new bet slips.
    deadline_at = room.get("deadline_at")
    submissions_locked = _is_deadline_passed(deadline_at)
    return {
        "id": room["id"],
        "name": room["name"],
        "matchday": room["matchday"],
        "max_events": room["max_events"],
        "color": room["color"],
        "invite_code": room["invite_code"],  # legacy: initial code, may be used
        "admin_user_id": room.get("admin_user_id"),
        "status": room.get("status", "open"),
        "created_at": room["created_at"],
        "members_count": members_count,
        "invites_total": invites_total,
        "invites_available": invites_available,
        "deadline_at": deadline_at,
        "submissions_locked": submissions_locked,
        "settled": settled,
        "is_admin": is_admin_of_room,
    }


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        # Accept "2026-09-01T18:30" (datetime-local) and full ISO variants
        s = value.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            # Treat naive datetimes as UTC (frontend will always send UTC ISO)
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _is_deadline_passed(deadline_at: Optional[str]) -> bool:
    dt = _parse_iso_datetime(deadline_at)
    if not dt:
        return False
    return datetime.now(timezone.utc) >= dt


async def _ensure_submissions_open(room: dict) -> None:
    """Raise HTTPException if the room's submission deadline has passed."""
    if _is_deadline_passed(room.get("deadline_at")):
        raise HTTPException(
            status_code=403,
            detail="Termine per l'inserimento delle schedine scaduto",
        )


async def _ensure_member(room_id: str, user: dict) -> None:
    """Raise 403 if the user isn't a member of the room (admins bypass)."""
    if user["role"] == "admin":
        return
    m = await db.memberships.find_one({"room_id": room_id, "user_id": user["id"]})
    if not m:
        raise HTTPException(status_code=403, detail="Non sei nella stanza")


# ---------- ROOM: CRUD ----------
@api.post("/rooms")
async def create_room(data: RoomCreate, user: dict = Depends(require_admin)):
    for _ in range(10):
        code = gen_code()
        if not await db.rooms.find_one({"invite_code": code}) and not await db.invites.find_one({"code": code}):
            break
    room_id = str(uuid.uuid4())
    color = data.color if data.color in ROOM_COLORS else random.choice(ROOM_COLORS)
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": room_id,
        "name": data.name,
        "matchday": data.matchday,
        "max_events": data.max_events,
        "color": color,
        "invite_code": code,  # legacy field, still populated for backward compat
        "admin_user_id": user["id"],
        "status": "open",
        "created_at": now,
    }
    await db.rooms.insert_one(doc)
    # Create the first single-use invite (using the room's initial code)
    await db.invites.insert_one({
        "id": str(uuid.uuid4()),
        "room_id": room_id,
        "code": code,
        "used_by_user_id": None,
        "used_at": None,
        "created_at": now,
        "created_by": user["id"],
        "revoked_at": None,
    })
    # Auto-join the creating admin
    await db.memberships.insert_one({
        "room_id": room_id,
        "user_id": user["id"],
        "display_name": display_name(user),
        "joined_at": now,
    })
    return await _room_dict(doc, user)


@api.get("/rooms")
async def list_my_rooms(user: dict = Depends(current_user)):
    if user["role"] == "admin":
        cursor = db.rooms.find({}, {"_id": 0}).sort("created_at", -1)
    else:
        member_room_ids = [m["room_id"] async for m in db.memberships.find(
            {"user_id": user["id"]}, {"room_id": 1, "_id": 0})]
        cursor = db.rooms.find({"id": {"$in": member_room_ids}}, {"_id": 0}).sort("created_at", -1)
    rooms = []
    async for r in cursor:
        rooms.append(await _room_dict(r, user))
    return rooms


@api.get("/rooms/by-code/{invite_code}")
async def preview_room(invite_code: str):
    """Public preview of a room by invite code — used by the invite landing page.
    Does NOT require authentication. Returns only non-sensitive info.
    Rejects codes that are already used or revoked."""
    code = invite_code.upper().strip()
    invite = await db.invites.find_one({"code": code})
    if not invite:
        raise HTTPException(status_code=404, detail="Codice invito non valido")
    if invite.get("revoked_at"):
        raise HTTPException(status_code=410, detail="Codice invito revocato")
    if invite.get("used_by_user_id"):
        raise HTTPException(status_code=410, detail="Codice invito già utilizzato")
    room = await db.rooms.find_one({"id": invite["room_id"]}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Stanza non trovata")
    return {
        "id": room["id"],
        "name": room["name"],
        "matchday": room["matchday"],
        "max_events": room["max_events"],
        "color": room["color"],
        "invite_code": code,
        "status": room.get("status", "open"),
    }


@api.post("/rooms/join")
async def join_room(data: RoomJoin, user: dict = Depends(current_user)):
    code = data.invite_code.upper().strip()
    # Atomically claim the invite: find one that is unused & unrevoked, and
    # mark it as used by the current user in a single operation. This makes
    # the "one-shot invite" contract race-safe even under concurrent joins.
    now = datetime.now(timezone.utc).isoformat()
    claimed = await db.invites.find_one_and_update(
        {"code": code, "used_by_user_id": None, "revoked_at": None},
        {"$set": {"used_by_user_id": user["id"], "used_at": now}},
        return_document=ReturnDocument.AFTER,
    )
    if not claimed:
        # Distinguish "not found" from "already used" for a clearer message
        invite = await db.invites.find_one({"code": code})
        if not invite:
            raise HTTPException(status_code=404, detail="Codice invito non valido")
        if invite.get("revoked_at"):
            raise HTTPException(status_code=410, detail="Codice invito revocato")
        # Idempotence: if the current user is the one who already used this
        # invite, allow re-entry into the room (they might just be refreshing).
        if invite.get("used_by_user_id") == user["id"]:
            room = await db.rooms.find_one({"id": invite["room_id"]}, {"_id": 0})
            if room:
                return await _room_dict(room, user)
        raise HTTPException(status_code=410, detail="Codice invito già utilizzato")
    room = await db.rooms.find_one({"id": claimed["room_id"]}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Stanza non trovata")
    if room.get("status") == "settled":
        # Roll back the claim if the room is closed
        await db.invites.update_one({"id": claimed["id"]}, {"$set": {"used_by_user_id": None, "used_at": None}})
        raise HTTPException(status_code=400, detail="Stanza già chiusa")
    existing = await db.memberships.find_one({"room_id": room["id"], "user_id": user["id"]})
    if not existing:
        await db.memberships.insert_one({
            "room_id": room["id"],
            "user_id": user["id"],
            "display_name": display_name(user),
            "joined_at": now,
        })
    return await _room_dict(room, user)


@api.get("/rooms/{room_id}")
async def get_room(room_id: str, user: dict = Depends(current_user)):
    await _ensure_member(room_id, user)
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Stanza non trovata")
    return await _room_dict(room, user)


@api.patch("/rooms/{room_id}")
async def update_room(room_id: str, data: RoomUpdate, user: dict = Depends(require_admin)):
    patch = {k: v for k, v in data.model_dump(exclude_unset=True).items()}
    if not patch:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    if "color" in patch and patch["color"] not in ROOM_COLORS:
        patch.pop("color")
    # Handle deadline_at: empty string / None means "clear"; otherwise validate ISO
    if "deadline_at" in patch:
        raw = patch["deadline_at"]
        if raw in (None, ""):
            # Use $unset via a separate call for clarity
            await db.rooms.update_one({"id": room_id}, {"$unset": {"deadline_at": ""}})
            patch.pop("deadline_at")
        else:
            dt = _parse_iso_datetime(raw)
            if not dt:
                raise HTTPException(status_code=400, detail="Data/ora termine non valida")
            # Store normalised UTC ISO string (with timezone)
            patch["deadline_at"] = dt.astimezone(timezone.utc).isoformat()
    if patch:
        result = await db.rooms.update_one({"id": room_id}, {"$set": patch})
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Stanza non trovata")
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Stanza non trovata")
    return await _room_dict(room, user)


@api.delete("/rooms/{room_id}")
async def delete_room(room_id: str, user: dict = Depends(require_admin)):
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Stanza non trovata")
    await db.rooms.delete_one({"id": room_id})
    await db.memberships.delete_many({"room_id": room_id})
    await db.schedine.delete_many({"room_id": room_id})
    await db.fixtures.delete_many({"room_id": room_id})
    await db.invites.delete_many({"room_id": room_id})
    return {"ok": True}


# ---------- ROOM: INVITES (one-shot) ----------
async def _invite_dict(inv: dict) -> dict:
    used_by_nickname = None
    if inv.get("used_by_user_id"):
        u = await db.users.find_one({"id": inv["used_by_user_id"]}, {"_id": 0, "password_hash": 0})
        if u:
            used_by_nickname = u.get("username") or u.get("email")
    return {
        "id": inv["id"],
        "code": inv["code"],
        "used_by_user_id": inv.get("used_by_user_id"),
        "used_by_nickname": used_by_nickname,
        "used_at": inv.get("used_at"),
        "revoked_at": inv.get("revoked_at"),
        "created_at": inv.get("created_at"),
    }


@api.get("/rooms/{room_id}/invites")
async def list_invites(room_id: str, user: dict = Depends(require_admin)):
    room = await db.rooms.find_one({"id": room_id}, {"id": 1, "_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Stanza non trovata")
    invites = [i async for i in db.invites.find({"room_id": room_id}, {"_id": 0}).sort("created_at", 1)]
    return [await _invite_dict(i) for i in invites]


@api.post("/rooms/{room_id}/invites")
async def create_invite(room_id: str, user: dict = Depends(require_admin)):
    room = await db.rooms.find_one({"id": room_id}, {"id": 1, "_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Stanza non trovata")
    # Generate a unique code
    for _ in range(20):
        code = gen_code()
        if not await db.invites.find_one({"code": code}) and not await db.rooms.find_one({"invite_code": code}):
            break
    else:
        raise HTTPException(status_code=500, detail="Impossibile generare un codice univoco, riprova")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "room_id": room_id,
        "code": code,
        "used_by_user_id": None,
        "used_at": None,
        "created_at": now,
        "created_by": user["id"],
        "revoked_at": None,
    }
    await db.invites.insert_one(doc)
    return await _invite_dict(doc)


@api.delete("/rooms/{room_id}/invites/{invite_id}")
async def revoke_invite(room_id: str, invite_id: str, user: dict = Depends(require_admin)):
    inv = await db.invites.find_one({"id": invite_id, "room_id": room_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invito non trovato")
    if inv.get("used_by_user_id"):
        raise HTTPException(status_code=400, detail="Impossibile revocare: invito già utilizzato")
    if inv.get("revoked_at"):
        return await _invite_dict(inv)
    now = datetime.now(timezone.utc).isoformat()
    await db.invites.update_one({"id": invite_id}, {"$set": {"revoked_at": now}})
    inv["revoked_at"] = now
    return await _invite_dict(inv)


@api.get("/rooms/{room_id}/members")
async def list_members(room_id: str, user: dict = Depends(current_user)):
    await _ensure_member(room_id, user)
    memberships = [m async for m in db.memberships.find({"room_id": room_id}, {"_id": 0})]
    if not memberships:
        return []
    user_ids = [m["user_id"] for m in memberships]
    users_map = {}
    async for u in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0}):
        users_map[u["id"]] = u
    submitted_ids = set()
    async for s in db.schedine.find(
        {"room_id": room_id, "status": "confirmed"}, {"user_id": 1, "_id": 0}
    ):
        submitted_ids.add(s["user_id"])
    result = []
    for m in memberships:
        u = users_map.get(m["user_id"], {})
        result.append({
            "user_id": m["user_id"],
            "nickname": m.get("display_name") or u.get("username") or u.get("email") or "?",
            "role": u.get("role", "player"),
            "blocked": u.get("blocked", False),
            "submitted": m["user_id"] in submitted_ids,
        })
    return result


@api.post("/rooms/{room_id}/close")
async def close_room(room_id: str, user: dict = Depends(require_admin)):
    await db.rooms.update_one({"id": room_id}, {"$set": {"status": "closed"}})
    return {"ok": True}


# ============ Schedina / OCR ============
class ScreenshotIn(BaseModel):
    image_base64: str


@api.post("/rooms/{room_id}/schedina/ocr")
async def upload_schedina(room_id: str, data: ScreenshotIn, user: dict = Depends(current_user)):
    await _ensure_member(room_id, user)
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Stanza non trovata")
    if room.get("status") == "settled":
        raise HTTPException(status_code=400, detail="Stanza chiusa")
    await _ensure_submissions_open(room)

    b64 = data.image_base64
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Immagine base64 non valida")

    result = await ocr_screenshot(raw)
    parsed = result["events"]
    if len(parsed) > room["max_events"]:
        parsed = parsed[: room["max_events"]]

    await db.schedine.update_one(
        {"room_id": room_id, "user_id": user["id"]},
        {"$set": {
            "room_id": room_id,
            "user_id": user["id"],
            "nickname": display_name(user),
            "screenshot_base64": b64,
            "raw_text": result["raw_text"],
            "events": parsed,
            "status": "draft",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return {"events": parsed, "raw_text": result["raw_text"], "max_events": room["max_events"]}


@api.post("/rooms/{room_id}/schedina/confirm")
async def confirm_schedina(room_id: str, data: SchedinaConfirm, user: dict = Depends(current_user)):
    """Confirm the OCR draft as the player's final bet slip.

    IMPORTANT — anti-cheat: this endpoint IGNORES any events sent by the
    client and always uses the OCR-parsed events stored server-side during
    :func:`upload_schedina`. This prevents a player from tampering with
    odds or predictions in the client and cheating the leaderboard.
    """
    await _ensure_member(room_id, user)
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Stanza non trovata")
    if room.get("status") == "settled":
        raise HTTPException(status_code=400, detail="Stanza chiusa")
    await _ensure_submissions_open(room)

    # Load the OCR draft (must exist — created by upload_schedina)
    draft = await db.schedine.find_one({"room_id": room_id, "user_id": user["id"]}, {"_id": 0})
    if not draft or not draft.get("events"):
        raise HTTPException(
            status_code=400,
            detail="Nessuna schedina caricata. Carica prima uno screenshot.",
        )

    ocr_events = draft["events"]
    if len(ocr_events) > room["max_events"]:
        ocr_events = ocr_events[: room["max_events"]]

    # Validate that every event has a recognised prediction. If any event
    # has an empty/unknown prediction, the OCR failed to read it: the
    # player is asked to retake a cleaner screenshot rather than manually
    # patching a market (which would open a cheating window).
    bad = [e for e in ocr_events if not e.get("prediction")]
    if bad:
        raise HTTPException(
            status_code=400,
            detail=(
                f"L'OCR non ha riconosciuto {len(bad)} pronostici. "
                "Rifai lo screenshot con maggiore risoluzione."
            ),
        )
    # Also refuse zero/absurd odds
    for e in ocr_events:
        odd = e.get("odd") or 0
        if not (1.01 <= odd <= 999):
            raise HTTPException(
                status_code=400,
                detail=(
                    "L'OCR non ha letto correttamente le quote. "
                    "Rifai lo screenshot con maggiore risoluzione."
                ),
            )

    await db.schedine.update_one(
        {"room_id": room_id, "user_id": user["id"]},
        {"$set": {
            "room_id": room_id,
            "user_id": user["id"],
            "nickname": display_name(user),
            "events": ocr_events,
            "status": "confirmed",
            "confirmed_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    # Ignore the client-provided `data.events` entirely — see docstring.
    _ = data
    return {"ok": True, "events": ocr_events}


@api.get("/rooms/{room_id}/schedina")
async def my_schedina(room_id: str, user: dict = Depends(current_user)):
    await _ensure_member(room_id, user)
    s = await db.schedine.find_one(
        {"room_id": room_id, "user_id": user["id"]},
        {"_id": 0, "screenshot_base64": 0, "raw_text": 0},
    )
    return s or {"empty": True}


# ============ Fixtures / Results ============
@api.post("/rooms/{room_id}/fixtures")
async def set_fixtures(room_id: str, data: FixturesIn, user: dict = Depends(require_admin)):
    await db.fixtures.delete_many({"room_id": room_id})
    docs = []
    for f in data.fixtures:
        both = f.both_scored if f.both_scored is not None else (f.home_score > 0 and f.away_score > 0)
        docs.append({
            "room_id": room_id,
            "home_team": f.home_team.strip(),
            "away_team": f.away_team.strip(),
            "home_score": f.home_score,
            "away_score": f.away_score,
            "both_scored": both,
        })
    if docs:
        await db.fixtures.insert_many(docs)
    return {"ok": True, "count": len(docs)}


@api.get("/rooms/{room_id}/fixtures")
async def get_fixtures(room_id: str, user: dict = Depends(current_user)):
    await _ensure_member(room_id, user)
    cursor = db.fixtures.find({"room_id": room_id}, {"_id": 0})
    return [f async for f in cursor]


@api.post("/rooms/{room_id}/fixtures/sync")
async def sync_fixtures_from_api(room_id: str, season: Optional[int] = None, user: dict = Depends(require_admin)):
    if not API_FOOTBALL_KEY:
        raise HTTPException(status_code=400, detail="API_FOOTBALL_KEY non configurata")
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Stanza non trovata")
    target_season = season or CURRENT_SEASON
    headers = {"x-apisports-key": API_FOOTBALL_KEY}
    async with httpx.AsyncClient(timeout=20) as http:
        try:
            r = await http.get(
                f"{API_FOOTBALL_BASE}/fixtures",
                params={
                    "league": SERIE_A_LEAGUE_ID,
                    "season": target_season,
                    "round": f"Regular Season - {room['matchday']}",
                },
                headers=headers,
            )
            r.raise_for_status()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=400, detail=f"API-Football: {type(e).__name__}")
        data = r.json()
        errs = data.get("errors") or {}
        if isinstance(errs, dict) and errs:
            raise HTTPException(status_code=400, detail=f"API-Football: {next(iter(errs.values()))}")
        fixtures = data.get("response", [])
        if not fixtures:
            raise HTTPException(status_code=400, detail="Nessuna partita ricevuta dall'API")

    await db.fixtures.delete_many({"room_id": room_id})
    docs = []
    for f in fixtures:
        goals = f.get("goals", {}) or {}
        home_score = goals.get("home")
        away_score = goals.get("away")
        if home_score is None or away_score is None:
            continue
        teams = f.get("teams", {}) or {}
        home = teams.get("home", {}).get("name") or ""
        away = teams.get("away", {}).get("name") or ""
        if not home or not away:
            continue
        docs.append({
            "room_id": room_id,
            "home_team": home,
            "away_team": away,
            "home_score": int(home_score),
            "away_score": int(away_score),
            "both_scored": home_score > 0 and away_score > 0,
        })
    if docs:
        await db.fixtures.insert_many(docs)
    return {"ok": True, "count": len(docs)}


# ============ Leaderboard ============
def _match_prediction_to_fixture(event: dict, fixtures: list[dict]) -> Optional[dict]:
    for f in fixtures:
        if _team_match(event["home_team"], f["home_team"]) and _team_match(event["away_team"], f["away_team"]):
            return f
        if _team_match(event["home_team"], f["away_team"]) and _team_match(event["away_team"], f["home_team"]):
            return f
    return None


@api.get("/rooms/{room_id}/leaderboard")
async def leaderboard(room_id: str, user: dict = Depends(current_user)):
    await _ensure_member(room_id, user)
    fixtures = [f async for f in db.fixtures.find({"room_id": room_id}, {"_id": 0})]
    has_results = len(fixtures) > 0

    schedine_cur = db.schedine.find({"room_id": room_id, "status": "confirmed"}, {"_id": 0})
    entries = []
    async for s in schedine_cur:
        events = s.get("events", [])
        breakdown = []
        product = 1.0
        won_count = 0
        for e in events:
            info = {
                "home_team": e["home_team"],
                "away_team": e["away_team"],
                "prediction": e["prediction"],
                "odd": e["odd"],
                "won": False,
                "matched_fixture": None,
                "score": None,
            }
            if has_results:
                fx = _match_prediction_to_fixture(e, fixtures)
                if fx:
                    info["matched_fixture"] = f"{fx['home_team']} vs {fx['away_team']}"
                    info["score"] = f"{fx['home_score']}-{fx['away_score']}"
                    if _evaluate_prediction(e["prediction"], fx):
                        info["won"] = True
                        product *= e["odd"]
                        won_count += 1
            breakdown.append(info)
        total = round(product, 2) if won_count > 0 else 0.0
        entries.append({
            "user_id": s["user_id"],
            "nickname": s.get("nickname", "?"),
            "total": total,
            "won_count": won_count,
            "events_count": len(events),
            "breakdown": breakdown,
        })
    entries.sort(key=lambda x: (-x["total"], x["nickname"]))
    for i, r in enumerate(entries):
        r["rank"] = i + 1
    return {
        "has_results": has_results,
        "settled": has_results and len(entries) > 0,
        "leaderboard": entries,
    }


@api.get("/")
async def root():
    return {"service": "RinoMagic", "status": "ok"}


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
