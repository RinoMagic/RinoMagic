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

app = FastAPI(title="SchedinaBar API")
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
    admin_nickname: str = Field(min_length=2, max_length=20)


class RoomJoin(BaseModel):
    invite_code: str
    nickname: str = Field(min_length=2, max_length=20)


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
    events: List[SchedinaEventIn]


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


def create_token(room_id: str, nickname: str, is_admin: bool) -> str:
    payload = {
        "room_id": room_id,
        "nickname": nickname,
        "is_admin": is_admin,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def current_session(cred: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> dict:
    if not cred:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(cred.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    # Sanity: verify membership still exists
    m = await db.memberships.find_one(
        {"room_id": payload["room_id"], "nickname": payload["nickname"]}, {"_id": 0}
    )
    if not m:
        raise HTTPException(status_code=401, detail="Session invalid")
    return payload


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
    # Common OCR errors on the '1' character: often read as '4', 'l' or 'I'.
    # Apply the fix ONLY on typical bet tokens so we don't clobber legit digits.
    for wrong in ("4X", "IX", "LX"):
        if wrong in t:
            t = t.replace(wrong, "1X")
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

    # Over / Under (threshold-aware)
    if "U/O" in market or "O/U" in market or "OVER" in market or "UNDER" in market:
        thr_match = re.search(r"(\d(?:\.\d)?)", market)
        threshold = thr_match.group(1) if thr_match else "2.5"
        # normalise threshold to "X.5" or integer
        if "." not in threshold:
            threshold = f"{threshold}.5"
        if pick.startswith("OVER") or pick in {"O", "OV"}:
            return f"OVER-{threshold}"
        if pick.startswith("UNDER") or pick in {"U", "UN"}:
            return f"UNDER-{threshold}"
        return None

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
    await db.memberships.create_index([("room_id", 1), ("nickname", 1)], unique=True)
    await db.schedine.create_index([("room_id", 1), ("nickname", 1)], unique=True)
    await db.fixtures.create_index([("room_id", 1), ("home_team", 1), ("away_team", 1)], unique=True)
    logger.info("SchedinaBar API started")


@app.on_event("shutdown")
async def shutdown():
    client.close()


# ============ Rooms ============
async def _room_dict(room: dict, viewer_nickname: Optional[str] = None) -> dict:
    members_count = await db.memberships.count_documents({"room_id": room["id"]})
    settled = room.get("status") == "settled"
    return {
        "id": room["id"],
        "name": room["name"],
        "matchday": room["matchday"],
        "max_events": room["max_events"],
        "color": room["color"],
        "invite_code": room["invite_code"],
        "admin_nickname": room["admin_nickname"],
        "status": room.get("status", "open"),
        "created_at": room["created_at"],
        "members_count": members_count,
        "settled": settled,
        "is_admin": viewer_nickname == room["admin_nickname"] if viewer_nickname else False,
    }


@api.post("/rooms")
async def create_room(data: RoomCreate):
    for _ in range(10):
        code = gen_code()
        if not await db.rooms.find_one({"invite_code": code}):
            break
    room_id = str(uuid.uuid4())
    color = data.color if data.color in ROOM_COLORS else random.choice(ROOM_COLORS)
    doc = {
        "id": room_id,
        "name": data.name,
        "matchday": data.matchday,
        "max_events": data.max_events,
        "color": color,
        "invite_code": code,
        "admin_nickname": data.admin_nickname.strip(),
        "status": "open",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.rooms.insert_one(doc)
    await db.memberships.insert_one({
        "room_id": room_id,
        "nickname": data.admin_nickname.strip(),
        "is_admin": True,
        "joined_at": datetime.now(timezone.utc).isoformat(),
    })
    token = create_token(room_id, data.admin_nickname.strip(), True)
    return {
        "token": token,
        "room": await _room_dict(doc, data.admin_nickname.strip()),
    }


@api.post("/rooms/join")
async def join_room(data: RoomJoin):
    room = await db.rooms.find_one({"invite_code": data.invite_code.upper()}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Codice invito non valido")
    if room.get("status") == "settled":
        raise HTTPException(status_code=400, detail="Stanza gia chiusa")
    nickname = data.nickname.strip()
    existing = await db.memberships.find_one(
        {"room_id": room["id"], "nickname": nickname}
    )
    if not existing:
        # Enforce uniqueness of nickname in the room (case-insensitive)
        conflict = await db.memberships.find_one({
            "room_id": room["id"],
            "nickname": {"$regex": f"^{re.escape(nickname)}$", "$options": "i"},
        })
        if conflict:
            raise HTTPException(status_code=409, detail="Nickname gia usato in questa stanza")
        await db.memberships.insert_one({
            "room_id": room["id"],
            "nickname": nickname,
            "is_admin": False,
            "joined_at": datetime.now(timezone.utc).isoformat(),
        })
    is_admin = nickname == room["admin_nickname"]
    token = create_token(room["id"], nickname, is_admin)
    return {"token": token, "room": await _room_dict(room, nickname)}


@api.get("/rooms/{room_id}")
async def get_room(room_id: str, session: dict = Depends(current_session)):
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Stanza non trovata")
    return await _room_dict(room, session["nickname"])


@api.get("/rooms/{room_id}/members")
async def list_members(room_id: str, session: dict = Depends(current_session)):
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
    cursor = db.memberships.find({"room_id": room_id}, {"_id": 0})
    members = [m async for m in cursor]
    # Enrich with schedina submitted flag
    submitted = set()
    async for s in db.schedine.find({"room_id": room_id, "status": "confirmed"}, {"nickname": 1, "_id": 0}):
        submitted.add(s["nickname"])
    for m in members:
        m["submitted"] = m["nickname"] in submitted
    return members


@api.post("/rooms/{room_id}/close")
async def close_room(room_id: str, session: dict = Depends(current_session)):
    if not session.get("is_admin"):
        raise HTTPException(status_code=403, detail="Solo l'admin puo chiudere la stanza")
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
    await db.rooms.update_one({"id": room_id}, {"$set": {"status": "closed"}})
    return {"ok": True}


# ============ Schedina / OCR ============
class ScreenshotIn(BaseModel):
    image_base64: str


@api.post("/rooms/{room_id}/schedina/ocr")
async def upload_schedina(room_id: str, data: ScreenshotIn, session: dict = Depends(current_session)):
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Stanza non trovata")
    if room.get("status") == "settled":
        raise HTTPException(status_code=400, detail="Stanza chiusa")

    b64 = data.image_base64
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Immagine base64 non valida")

    # Persist draft with screenshot + parsed events
    result = await ocr_screenshot(raw)
    parsed = result["events"]
    if len(parsed) > room["max_events"]:
        parsed = parsed[: room["max_events"]]

    await db.schedine.update_one(
        {"room_id": room_id, "nickname": session["nickname"]},
        {"$set": {
            "room_id": room_id,
            "nickname": session["nickname"],
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
async def confirm_schedina(room_id: str, data: SchedinaConfirm, session: dict = Depends(current_session)):
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Stanza non trovata")
    if room.get("status") == "settled":
        raise HTTPException(status_code=400, detail="Stanza chiusa")
    if not data.events:
        raise HTTPException(status_code=400, detail="La schedina deve avere almeno un pronostico")
    if len(data.events) > room["max_events"]:
        raise HTTPException(status_code=400, detail=f"Massimo {room['max_events']} pronostici")

    events = [e.model_dump() for e in data.events]
    await db.schedine.update_one(
        {"room_id": room_id, "nickname": session["nickname"]},
        {"$set": {
            "room_id": room_id,
            "nickname": session["nickname"],
            "events": events,
            "status": "confirmed",
            "confirmed_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return {"ok": True, "events": events}


@api.get("/rooms/{room_id}/schedina")
async def my_schedina(room_id: str, session: dict = Depends(current_session)):
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
    s = await db.schedine.find_one(
        {"room_id": room_id, "nickname": session["nickname"]},
        {"_id": 0, "screenshot_base64": 0, "raw_text": 0},
    )
    return s or {"empty": True}


# ============ Fixtures / Results ============
@api.post("/rooms/{room_id}/fixtures")
async def set_fixtures(room_id: str, data: FixturesIn, session: dict = Depends(current_session)):
    if not session.get("is_admin"):
        raise HTTPException(status_code=403, detail="Solo l'admin puo inserire i risultati")
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
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
async def get_fixtures(room_id: str, session: dict = Depends(current_session)):
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
    cursor = db.fixtures.find({"room_id": room_id}, {"_id": 0})
    return [f async for f in cursor]


@api.post("/rooms/{room_id}/fixtures/sync")
async def sync_fixtures_from_api(room_id: str, season: Optional[int] = None, session: dict = Depends(current_session)):
    if not session.get("is_admin"):
        raise HTTPException(status_code=403, detail="Solo l'admin")
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
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
        # Also try swapped (in case OCR got them backwards)
        if _team_match(event["home_team"], f["away_team"]) and _team_match(event["away_team"], f["home_team"]):
            return f
    return None


@api.get("/rooms/{room_id}/leaderboard")
async def leaderboard(room_id: str, session: dict = Depends(current_session)):
    if session["room_id"] != room_id:
        raise HTTPException(status_code=403, detail="Accesso negato")
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
            "nickname": s["nickname"],
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
    return {"service": "SchedinaBar", "status": "ok"}


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
