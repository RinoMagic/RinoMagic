"""Matchday Facts — universal source of truth for match ratings, goals & bookings.

This module ingests the "Voti Fantacalcio" PDF (weekly report distributed by
fantacalcio.it) and stores structured per-player facts for a given Serie A
matchday. These facts feed multiple RinoMagic sub-games:

* **ScoreAndLive** — uses the scorers list to auto-settle picks.
* **TheBestTiket** — uses the fixtures (derived from goals + team layout) to
  settle bet slips (planned).
* **FantaGiornata** — uses the full ratings (voto + bonuses/mali) to compute
  fantavoto (planned).

MongoDB collection: ``matchday_facts``

Document schema::

    {
      id: str,                # uuid
      matchday: int,          # 1..38 (Serie A giornata)
      team: str,              # canonical Italian team name
      player_code: int,       # fantacalcio.it stable player ID ("Cod.")
      player_name: str,       # last name (as in the PDF)
      role: str,              # P | D | C | A | ALL (allenatore)
      voto: float | None,     # fantavoto (None if not graded)
      sv: bool,               # senza voto (marked with * in the PDF)
      gf: int,                # gol fatti (open play)
      gs: int,                # gol subiti (portieri)
      rp: int,                # rigori parati (portieri)
      rs: int,                # rigori sbagliati
      rf: int,                # rigori segnati
      au: int,                # autogol
      amm: int,               # ammonizioni
      esp: int,               # espulsioni
      ass: int,               # assist
      total_goals: int,       # gf + rf (used to identify scorers)
      created_at: iso str,
      updated_at: iso str,
    }

Unique index on (matchday, team, player_code).
"""
from __future__ import annotations

import io
import re
import uuid
import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any, Callable, Tuple

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

logger = logging.getLogger("matchday_facts")

# Serie A 2025-26 + variants encountered in the PDF header row.
SERIE_A_TEAMS = {
    "Atalanta", "Bologna", "Cagliari", "Como", "Cremonese", "Fiorentina",
    "Genoa", "Inter", "Juventus", "Lazio", "Lecce", "Milan", "Napoli",
    "Parma", "Pisa", "Roma", "Sassuolo", "Torino", "Udinese", "Verona",
    # historical / possibly-recurring variants
    "Hellas Verona", "Empoli", "Monza", "Frosinone", "Salernitana", "Venezia",
}

# Canonicalize team labels (e.g. "Hellas Verona" -> "Verona") if desired later.
TEAM_ALIASES = {
    "Hellas Verona": "Verona",
}

ROLE_TOKENS = {"P", "D", "C", "A", "ALL"}


# =========================================================================
# PDF Parser
# =========================================================================

# Player row: <code> <role> <name...> <voto> <gf> <gs> <rp> <rs> <rf> <au> <amm> <esp> <ass>
# `voto` supports comma decimals and optional trailing `*` (senza voto marker).
_ROW_RE = re.compile(
    r"^(\d+)\s+(P|D|C|A|ALL)\s+(.+?)\s+([\d]+(?:[.,]\d+)?\*?)\s+"
    r"(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$"
)
_MATCHDAY_RE = re.compile(r"(\d+)\s*[ªa°]?\s*giornata", re.IGNORECASE)


def _canonical_team(name: str) -> str:
    return TEAM_ALIASES.get(name, name)


def _parse_voti_pdf(pdf_bytes: bytes) -> Tuple[Optional[int], List[dict]]:
    """Parse a fantacalcio.it "Voti" PDF.

    Returns ``(matchday, rows)`` where ``matchday`` is detected from the header
    ("38ª giornata di campionato") if present, and ``rows`` is a list of
    per-player dicts matching the ``matchday_facts`` schema (minus ids and
    timestamps).

    Rows that do not match the strict row regex are silently skipped (headers,
    team labels, page banners...).
    """
    try:
        import pdfplumber
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"pdfplumber non installato: {e}") from e

    matchday: Optional[int] = None
    current_team: Optional[str] = None
    rows: List[dict] = []
    seen: set = set()  # (team, code) dedupe across pages

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for raw_line in text.split("\n"):
                line = raw_line.strip()
                if not line:
                    continue

                # Detect matchday from header ("Voti Fantacalcio 38ª giornata di campionato")
                if matchday is None:
                    m = _MATCHDAY_RE.search(line)
                    if m:
                        try:
                            matchday = int(m.group(1))
                        except ValueError:
                            pass

                # Team header line = a full known team name
                if line in SERIE_A_TEAMS:
                    current_team = _canonical_team(line)
                    continue

                # Skip column-header lines
                if line.startswith("Cod."):
                    continue

                # Try player row
                pm = _ROW_RE.match(line)
                if not pm or not current_team:
                    continue

                (code, role, name, voto_raw,
                 gf, gs, rp, rs, rf, au, amm, esp, ass) = pm.groups()

                voto_txt = voto_raw.replace("*", "").replace(",", ".")
                try:
                    voto_val: Optional[float] = float(voto_txt)
                except ValueError:
                    voto_val = None

                code_int = int(code)
                dedupe_key = (current_team, code_int)
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)

                gf_i = int(gf); rf_i = int(rf)
                rows.append({
                    "matchday": matchday or 0,
                    "team": current_team,
                    "player_code": code_int,
                    "player_name": name.strip(),
                    "role": role,
                    "voto": voto_val,
                    "sv": "*" in voto_raw,
                    "gf": gf_i,
                    "gs": int(gs),
                    "rp": int(rp),
                    "rs": int(rs),
                    "rf": rf_i,
                    "au": int(au),
                    "amm": int(amm),
                    "esp": int(esp),
                    "ass": int(ass),
                    "total_goals": gf_i + rf_i,
                })

    return matchday, rows


def summarize(rows: List[dict]) -> Dict[str, Any]:
    """Return quick sanity-check aggregates for a parsed matchday."""
    by_team: Dict[str, int] = {}
    by_role: Dict[str, int] = {}
    scorers: List[dict] = []
    total_goals = 0
    for r in rows:
        by_team[r["team"]] = by_team.get(r["team"], 0) + 1
        by_role[r["role"]] = by_role.get(r["role"], 0) + 1
        if r["total_goals"] > 0:
            scorers.append({
                "team": r["team"],
                "player_name": r["player_name"],
                "goals": r["total_goals"],
                "voto": r["voto"],
            })
            total_goals += r["total_goals"]
    return {
        "players": len(rows),
        "teams": len(by_team),
        "by_team": dict(sorted(by_team.items())),
        "by_role": dict(sorted(by_role.items())),
        "scorers_count": len(scorers),
        "total_goals": total_goals,
        "scorers": scorers,
    }


# =========================================================================
# MongoDB indexes
# =========================================================================

async def ensure_indexes(db) -> None:
    try:
        await db.matchday_facts.create_index(
            [("matchday", 1), ("team", 1), ("player_code", 1)], unique=True
        )
        await db.matchday_facts.create_index([("matchday", 1)])
        await db.matchday_facts.create_index([("matchday", 1), ("total_goals", -1)])
    except Exception:  # pragma: no cover
        logger.exception("Failed to create matchday_facts indexes")


# =========================================================================
# Router factory
# =========================================================================

def build_router(
    db,
    current_user: Callable,
    require_admin: Callable,
) -> APIRouter:
    router = APIRouter(prefix="/admin/voti")

    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    # --- Upload ------------------------------------------------------------

    @router.post("/upload-pdf")
    async def upload_voti_pdf(
        file: UploadFile = File(...),
        dry_run: bool = True,
        replace: bool = True,
        matchday_override: Optional[int] = None,
        user: dict = Depends(require_admin),
    ):
        """Upload a "Voti Fantacalcio" PDF for a Serie A matchday.

        Params:
            dry_run: if ``true`` (default) only returns a preview.
            replace: if ``true`` (default) removes previous facts for the same
                matchday before inserting the new ones (idempotent re-uploads).
            matchday_override: force a matchday number if the parser cannot
                detect it from the header.
        """
        if not file.filename or not file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Serve un file .pdf")
        raw = await file.read()
        if len(raw) > 20 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="PDF troppo grande (max 20MB)")

        try:
            matchday, rows = _parse_voti_pdf(raw)
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("PDF parse error")
            raise HTTPException(status_code=400, detail=f"Errore nell'analisi del PDF: {e}")

        if matchday_override is not None:
            matchday = matchday_override
            for r in rows:
                r["matchday"] = matchday

        if not rows:
            raise HTTPException(
                status_code=400,
                detail="Nessun giocatore riconosciuto nel PDF. Verifica il formato.",
            )
        if not matchday:
            raise HTTPException(
                status_code=400,
                detail="Giornata non rilevata dal PDF. Passa 'matchday_override' esplicito.",
            )

        summary = summarize(rows)
        result: Dict[str, Any] = {
            "matchday": matchday,
            "dry_run": dry_run,
            **summary,
        }

        if dry_run:
            return result

        now = _now()
        if replace:
            await db.matchday_facts.delete_many({"matchday": matchday})

        # Prepare docs with stable id
        docs = []
        for r in rows:
            docs.append({
                "id": str(uuid.uuid4()),
                **r,
                "created_at": now,
                "updated_at": now,
            })
        # Idempotent upserts (if replace=False and a doc already exists for the
        # same (matchday, team, player_code) we skip; if replace=True we already
        # cleared the matchday above).
        inserted = 0
        for d in docs:
            try:
                await db.matchday_facts.update_one(
                    {
                        "matchday": d["matchday"],
                        "team": d["team"],
                        "player_code": d["player_code"],
                    },
                    {"$setOnInsert": d},
                    upsert=True,
                )
                inserted += 1
            except Exception:  # pragma: no cover
                logger.exception("Upsert failed for %s / %s", d["team"], d["player_name"])

        result["inserted"] = inserted
        result["stored_total"] = await db.matchday_facts.count_documents({"matchday": matchday})
        return result

    # --- Read --------------------------------------------------------------

    @router.get("/{matchday}")
    async def list_facts(matchday: int, user: dict = Depends(require_admin)):
        if matchday < 1 or matchday > 38:
            raise HTTPException(status_code=400, detail="matchday deve essere 1..38")
        docs = await db.matchday_facts.find(
            {"matchday": matchday}, {"_id": 0}
        ).sort([("team", 1), ("role", 1), ("player_name", 1)]).to_list(length=None)
        return {
            "matchday": matchday,
            "count": len(docs),
            "items": docs,
        }

    @router.get("/{matchday}/scorers")
    async def list_scorers(matchday: int, user: dict = Depends(require_admin)):
        """Return only players with ``total_goals > 0`` for a matchday.

        Used by ScoreAndLive auto-settlement (future).
        """
        if matchday < 1 or matchday > 38:
            raise HTTPException(status_code=400, detail="matchday deve essere 1..38")
        docs = await db.matchday_facts.find(
            {"matchday": matchday, "total_goals": {"$gt": 0}},
            {"_id": 0},
        ).sort([("total_goals", -1), ("team", 1)]).to_list(length=None)
        return {
            "matchday": matchday,
            "count": len(docs),
            "total_goals": sum(d.get("total_goals", 0) for d in docs),
            "scorers": docs,
        }

    @router.get("")
    async def list_matchdays(user: dict = Depends(require_admin)):
        """List which matchdays already have facts stored."""
        pipeline = [
            {"$group": {
                "_id": "$matchday",
                "players": {"$sum": 1},
                "total_goals": {"$sum": "$total_goals"},
                "updated_at": {"$max": "$updated_at"},
            }},
            {"$sort": {"_id": 1}},
        ]
        agg = await db.matchday_facts.aggregate(pipeline).to_list(length=None)
        return {
            "matchdays": [
                {
                    "matchday": row["_id"],
                    "players": row["players"],
                    "total_goals": row["total_goals"],
                    "updated_at": row.get("updated_at"),
                }
                for row in agg
            ]
        }

    # --- Delete ------------------------------------------------------------

    @router.delete("/{matchday}")
    async def delete_matchday(matchday: int, user: dict = Depends(require_admin)):
        if matchday < 1 or matchday > 38:
            raise HTTPException(status_code=400, detail="matchday deve essere 1..38")
        r = await db.matchday_facts.delete_many({"matchday": matchday})
        return {"matchday": matchday, "deleted": r.deleted_count}

    return router
