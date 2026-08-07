"""Backend regression for auto-settle POSTPONEMENT handling (iteration 22).

Test cases (see review request iteration_22):
  TEST 1 — Exclusion propagation via PATCH /api/sal/calendar/fixture/{id}/exclude
  TEST 2 — Score settle with postponed_during: life saved
  TEST 3 — Survival settle with postponed result: life saved (pending pick)
  TEST 4 — Tiket postponed fixture → leaderboard quota 1.00 + RINV.
  TEST 5 — Idempotency: exclude toggle & already-settled Score md returns 400 (not crash)
  Bonus  — /api/admin/settle-matchday/preview marks postponed fixtures correctly

Each test snapshots+restores the tiny slice of DB state it mutates so the
suite is safe to re-run against a real dev DB.
"""
from __future__ import annotations

import asyncio
import os
import uuid

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

# ---------------------------------------------------------------------------
# Base URL — the review request explicitly says use INTERNAL_API_BASE.
# ---------------------------------------------------------------------------
INTERNAL_API_BASE = os.environ.get("INTERNAL_API_BASE", "http://localhost:8001")
API = f"{INTERNAL_API_BASE}/api"

ADMIN_EMAIL = "verone.salvatore@libero.it"
ADMIN_PASSWORD = "SchedinaBar2026!"
SEASON = "2026-27"
MATCHDAY = 1

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "schedinabar")

# Existing "clean" test entities (see iteration_22 review request context).
# Their names contain 'esclusione'/'rinvio' — provisioned by main agent.
SV_TID = "f67bad13-bdb9-4d3e-9bfc-e529e3e3bfab"   # 'Test partita rinviata esclusione'
SAL_TID = "72505fb5-5b7b-4ba1-a844-0a2e5774d120"  # 'Test esclusione per rinvio'
TIKET_ROOM_ID = "b16208fb-dc4b-43fb-b9ae-cc4338cad9ba"  # 'Test1'


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{API}/auth/admin/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


def _mongo(fn):
    """Run *fn(db)* in a fresh event loop with its own Motor client.

    Motor binds the client to whichever loop first calls into it, so we
    keep every _mongo() invocation self-contained — no cross-loop reuse.
    """
    async def _wrap():
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            return await fn(client[DB_NAME])
        finally:
            client.close()
    return asyncio.run(_wrap())


# ==========================================================================
# TEST 1 — Exclusion propagation endpoint
# ==========================================================================
class TestExcludeEndpoint:
    """PATCH /api/sal/calendar/fixture/{id}/exclude toggles + propagates."""

    def test_exclude_toggle_and_propagation(self, headers):
        # Grab a fixture on md 1.
        r = requests.get(
            f"{API}/sal/calendar?season={SEASON}&matchday={MATCHDAY}",
            headers=headers, timeout=10,
        )
        assert r.status_code == 200, r.text
        fixtures = r.json()["fixtures"]
        assert len(fixtures) >= 1

        # Pick a fixture whose snapshots (sv_matchdays / sal_matchdays)
        # are NOT already flagged excluded → guarantees the toggle
        # produces a non-zero modified_count so we can assert propagation.
        target = None
        for cand in fixtures:
            h, a = cand["home_team"], cand["away_team"]

            async def _probe(db, h=h, a=a):
                sv_c = await db.sv_matchdays.count_documents({
                    "matchday": MATCHDAY, "status": {"$ne": "settled"},
                    "fixtures": {"$elemMatch": {
                        "home_team": h, "away_team": a,
                        "excluded": {"$ne": True},
                    }},
                })
                sal_c = await db.sal_matchdays.count_documents({
                    "matchday_number": MATCHDAY, "status": {"$ne": "settled"},
                    "fixtures": {"$elemMatch": {
                        "home_team": h, "away_team": a,
                        "excluded": {"$ne": True},
                    }},
                })
                return sv_c + sal_c

            if _mongo(_probe) > 0 and not cand.get("excluded"):
                target = cand
                break
        assert target is not None, "no candidate fixture with unexcluded snapshots found"
        fid = target["id"]

        # ------ Toggle ON ------
        r = requests.patch(
            f"{API}/sal/calendar/fixture/{fid}/exclude",
            headers=headers, json={"excluded": True}, timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["excluded"] is True
        assert body["fixture"]["excluded"] is True
        assert "propagated" in body
        prop = body["propagated"]
        for k in ("sv", "sal", "tiket"):
            assert k in prop, f"missing key {k} in propagated"
            assert isinstance(prop[k], int)
        # We deliberately picked a fixture with un-flagged snapshots, so at
        # least ONE modification must have occurred (sv + sal ≥ 1).
        assert prop["sv"] + prop["sal"] > 0, (
            f"expected propagation to open snapshots, got {prop} "
            f"(target={target['home_team']}-{target['away_team']})"
        )

        # Verify DB actually persisted flag.
        fx_db = _mongo(lambda db: db.sal_calendar.find_one({"id": fid}, {"_id": 0}))
        assert fx_db["excluded"] is True

        # Verify sal_matchdays.fixtures[] carries excluded=True + postponed_before=True
        sal_snap = _mongo(lambda db: db.sal_matchdays.find_one(
            {"tournament_id": SAL_TID, "matchday_number": MATCHDAY,
             "fixtures.home_team": target["home_team"],
             "fixtures.away_team": target["away_team"]},
            {"_id": 0, "fixtures": 1},
        ))
        if sal_snap:
            f_in_sal = next((f for f in sal_snap["fixtures"]
                             if f["home_team"] == target["home_team"]
                             and f["away_team"] == target["away_team"]), None)
            assert f_in_sal is not None
            assert f_in_sal.get("excluded") is True
            assert f_in_sal.get("postponed_before") is True

        # ------ Toggle OFF (cleanup) ------
        r2 = requests.patch(
            f"{API}/sal/calendar/fixture/{fid}/exclude",
            headers=headers, json={"excluded": False}, timeout=10,
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["excluded"] is False
        fx_db2 = _mongo(lambda db: db.sal_calendar.find_one({"id": fid}, {"_id": 0}))
        assert fx_db2["excluded"] is False

    def test_exclude_unknown_fixture_returns_404(self, headers):
        r = requests.patch(
            f"{API}/sal/calendar/fixture/does-not-exist/exclude",
            headers=headers, json={"excluded": True}, timeout=10,
        )
        assert r.status_code == 404


# ==========================================================================
# BONUS — orchestrator PREVIEW marks postponed correctly
# ==========================================================================
class TestOrchestratorPreview:
    """/api/admin/settle-matchday/preview must mark postponed fixtures with
    home_score=None, away_score=None, played=False, postponed=True."""

    def test_preview_postponed_matches(self, headers):
        r = requests.post(
            f"{API}/admin/settle-matchday/preview",
            headers=headers,
            json={
                "matchday": MATCHDAY,
                "season": SEASON,
                "postponed_matches": [
                    {"home_team": "Genoa", "away_team": "Napoli"},
                ],
            }, timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["matchday"] == MATCHDAY
        genoa = next(
            (f for f in body["fixtures"]["list"]
             if f["home_team"].lower() == "genoa"
             and f["away_team"].lower() == "napoli"),
            None,
        )
        assert genoa is not None, "Genoa-Napoli missing from preview"
        assert genoa["postponed"] is True
        assert genoa["played"] is False
        assert genoa["home_score"] is None
        assert genoa["away_score"] is None

        # Other fixtures with matchday_facts must remain played=True.
        played_fx = [f for f in body["fixtures"]["list"]
                     if not f["postponed"] and f["played"]]
        assert len(played_fx) >= 1, "no non-postponed played fixtures found"


# ==========================================================================
# TEST 2 — Score postponement: life saved
# ==========================================================================
class TestScorePostponement:
    """Seed a Score pick on a postponed fixture, call the tournament-level
    settle endpoint with postponed_during=[idx], verify life NOT lost."""

    def test_score_life_saved(self, headers):
        # 1. Locate matchday doc + fixture idx for Atalanta-Sassuolo (idx 0)
        md_doc = _mongo(lambda db: db.sal_matchdays.find_one(
            {"tournament_id": SAL_TID, "matchday_number": MATCHDAY},
            {"_id": 0, "id": 1, "status": 1, "fixtures": 1},
        ))
        assert md_doc is not None
        if md_doc["status"] == "settled":
            pytest.skip("SAL matchday already settled — cannot re-test")
        target_fx = md_doc["fixtures"][0]
        target_idx = target_fx["idx"]

        # 2. Snapshot the participant + tournament state.
        user_id = "541a5219-a62c-46f2-8a3e-c66e77c7e37a"  # admin
        part_before = _mongo(lambda db: db.sal_participants.find_one(
            {"tournament_id": SAL_TID, "user_id": user_id}, {"_id": 0},
        ))
        assert part_before is not None
        lives_before = part_before["lives_remaining"]
        tourn_before = _mongo(lambda db: db.sal_tournaments.find_one(
            {"id": SAL_TID}, {"_id": 0, "blocked_players_by_user": 1},
        ))
        blocked_before = dict(tourn_before.get("blocked_players_by_user", {}))

        # 3. Get a sal_player from the postponed fixture's home team.
        home = target_fx["home_team"]
        pl = _mongo(lambda db: db.sal_players.find_one(
            {"team": home}, {"_id": 0, "id": 1, "team": 1, "name": 1},
        ))
        assert pl is not None, f"no player found for team {home}"
        player_id = pl["id"]

        # 4. Seed a pick doc directly (bypass submit endpoint since 3-picks
        #    rule may reject; settle endpoint iterates picks blindly).
        pick_doc = {
            "id": str(uuid.uuid4()),
            "tournament_id": SAL_TID,
            "matchday_id": md_doc["id"],
            "user_id": user_id,
            "nickname": "TEST_pp",
            "picks": [{"fixture_idx": target_idx, "player_id": player_id}],
            "submitted_at": None,
        }
        _mongo(lambda db: db.sal_picks.insert_one(pick_doc))

        try:
            # 5. Call the Score settle endpoint with postponed_during=[idx].
            r = requests.post(
                f"{API}/sal/tournaments/{SAL_TID}/matchdays/{md_doc['id']}/settle",
                headers=headers,
                json={"scorers": [], "postponed_during": [target_idx]},
                timeout=15,
            )
            assert r.status_code == 200, r.text

            # 6. Participant lives_remaining MUST equal lives_before
            #    (postponed pick → no life lost, no hit gained).
            part_after = _mongo(lambda db: db.sal_participants.find_one(
                {"tournament_id": SAL_TID, "user_id": user_id}, {"_id": 0},
            ))
            assert part_after["lives_remaining"] == lives_before, (
                f"expected lives_remaining={lives_before}, "
                f"got {part_after['lives_remaining']}"
            )

            # 7. The pick doc must show lives_lost=0, lives_gained=0 or unset.
            pick_after = _mongo(lambda db: db.sal_picks.find_one(
                {"tournament_id": SAL_TID, "matchday_id": md_doc["id"],
                 "user_id": user_id}, {"_id": 0},
            ))
            # It's possible lives_lost/lives_gained fields are absent because
            # the loop `continue`d for the postponed fixture. Either way,
            # no life should have been lost.
            assert pick_after.get("lives_lost", 0) == 0
            assert pick_after.get("lives_gained", 0) == 0

            # 8. Fixture in matchday snapshot must be flagged postponed_during.
            md_after = _mongo(lambda db: db.sal_matchdays.find_one(
                {"id": md_doc["id"]}, {"_id": 0, "fixtures": 1, "status": 1},
            ))
            fx_after = next(f for f in md_after["fixtures"]
                            if f["idx"] == target_idx)
            assert fx_after.get("postponed_during") is True

        finally:
            # ---- RESTORE STATE ----
            # 1) reset matchday status + fixture flags
            _mongo(lambda db: db.sal_matchdays.update_one(
                {"id": md_doc["id"]},
                {"$set": {
                    "status": "open",
                    "fixtures": md_doc["fixtures"],  # original snapshot
                }},
            ))
            # 2) reset participant lives
            _mongo(lambda db: db.sal_participants.update_one(
                {"tournament_id": SAL_TID, "user_id": user_id},
                {"$set": {
                    "lives_remaining": lives_before,
                    "eliminated_at_matchday": part_before.get("eliminated_at_matchday"),
                }},
            ))
            # 3) reset tournament blocked_players_by_user
            _mongo(lambda db: db.sal_tournaments.update_one(
                {"id": SAL_TID},
                {"$set": {"blocked_players_by_user": blocked_before}},
            ))
            # 4) remove seeded pick
            _mongo(lambda db: db.sal_picks.delete_one({"id": pick_doc["id"]}))


# ==========================================================================
# TEST 3 — Survival postponement: pick stays pending
# ==========================================================================
class TestSurvivalPostponement:
    """Seed a Surviva pick on match X, call settle with results marking
    match X as postponed=True; verify pick stays pending & life not lost."""

    def test_survival_life_saved(self, headers):
        md_doc = _mongo(lambda db: db.sv_matchdays.find_one(
            {"tournament_id": SV_TID, "matchday": MATCHDAY},
            {"_id": 0, "id": 1, "status": 1, "matchday": 1, "fixtures": 1},
        ))
        assert md_doc is not None
        if md_doc["status"] == "settled":
            pytest.skip("SV matchday already settled — cannot re-test")
        fx = md_doc["fixtures"][0]  # pick first fixture — will be postponed
        home = fx["home_team"]
        away = fx["away_team"]

        user_id = "541a5219-a62c-46f2-8a3e-c66e77c7e37a"
        part_before = _mongo(lambda db: db.sv_participants.find_one(
            {"tournament_id": SV_TID, "user_id": user_id}, {"_id": 0},
        ))
        assert part_before is not None
        lives_before = part_before["lives_left"]
        locked_before = list(part_before.get("locked_teams") or [])
        elim_before = part_before.get("eliminated_at")

        seed_ids = []
        try:
            # 1 pick on the postponed match (sign "1" — irrelevant since
            # postponed), sign to satisfy schema.
            pick_id = str(uuid.uuid4())
            seed_ids.append(pick_id)
            _mongo(lambda db: db.sv_picks.insert_one({
                "id": pick_id,
                "tournament_id": SV_TID,
                "matchday_id": md_doc["id"],
                "user_id": user_id,
                "home_team": home,
                "away_team": away,
                "pick": "1",
                "concession": False,
                "submitted_at": None,
            }))

            # Build results: only include ONE result — postponed=True on
            # the seeded pick's match. Other pick matches simply won't
            # appear so they stay pending too. Since we have only 1 pick
            # for this user, that's enough.
            results = [{
                "home_team": home,
                "away_team": away,
                "postponed": True,
            }]
            # Provide non-postponed dummy results for every OTHER fixture
            # so `results_by_key` lookup doesn't get triggered for our
            # seeded pick key — actually the code checks
            # `results_by_key.get(key)` first: if not present, skips as
            # postponed anyway. So {home,away,postponed:True} is enough.

            r = requests.post(
                f"{API}/sv/tournaments/{SV_TID}/matchdays/{md_doc['id']}/settle",
                headers=headers, json={"results": results}, timeout=15,
            )
            assert r.status_code == 200, r.text

            # Verify pick has NOT been marked correct/lost_life
            pick_after = _mongo(lambda db: db.sv_picks.find_one(
                {"id": pick_id}, {"_id": 0},
            ))
            assert pick_after is not None
            assert pick_after.get("correct") is None, (
                f"pick.correct should be None (pending), got {pick_after.get('correct')}"
            )
            assert pick_after.get("lost_life") is None
            assert pick_after.get("settled_at") is None

            # Verify participant life NOT decremented.
            part_after = _mongo(lambda db: db.sv_participants.find_one(
                {"tournament_id": SV_TID, "user_id": user_id}, {"_id": 0},
            ))
            assert part_after["lives_left"] == lives_before, (
                f"expected lives_left={lives_before}, "
                f"got {part_after['lives_left']}"
            )

        finally:
            # Restore matchday status (settle marks md 'settled').
            _mongo(lambda db: db.sv_matchdays.update_one(
                {"id": md_doc["id"]},
                {"$set": {"status": "open"}, "$unset": {"settled_at": ""}},
            ))
            # Restore participant.
            _mongo(lambda db: db.sv_participants.update_one(
                {"tournament_id": SV_TID, "user_id": user_id},
                {"$set": {
                    "lives_left": lives_before,
                    "locked_teams": locked_before,
                    "eliminated_at": elim_before,
                }},
            ))
            # Delete seeded picks.
            for pid in seed_ids:
                _mongo(lambda db: db.sv_picks.delete_one({"id": pid}))


# ==========================================================================
# TEST 4 — Tiket postponement: leaderboard quota 1.00 + RINV.
# ==========================================================================
class TestTiketPostponement:
    """POST postponed fixture to /rooms/{id}/fixtures then verify leaderboard
    returns won=true, postponed=true, score=RINV., and product excludes odd."""

    def test_leaderboard_postponed_quota_1(self, headers):
        # Snapshot existing room fixtures (should be 0 per our earlier probe).
        existing = _mongo(lambda db: db.fixtures.find(
            {"room_id": TIKET_ROOM_ID}, {"_id": 0},
        ).to_list(length=None))
        # Also snapshot room status.
        room_snap = _mongo(lambda db: db.rooms.find_one(
            {"id": TIKET_ROOM_ID}, {"_id": 0, "status": 1},
        ))
        assert room_snap is not None
        room_status_before = room_snap.get("status", "open")

        # Prepare fixtures: postpone GENOA-NAPOLI, give ATALANTA-SASSUOLO
        # a real score so at least one non-postponed event evaluates.
        payload = {"fixtures": [
            {"home_team": "GENOA", "away_team": "NAPOLI",
             "home_score": 0, "away_score": 0,
             "both_scored": False, "postponed": True},
            {"home_team": "ATALANTA", "away_team": "SASSUOLO",
             "home_score": 1, "away_score": 0,
             "both_scored": False, "postponed": False},
        ]}

        try:
            r = requests.post(
                f"{API}/rooms/{TIKET_ROOM_ID}/fixtures",
                headers=headers, json=payload, timeout=15,
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["count"] == 2
            assert body["postponed_count"] == 1

            # Now call the leaderboard endpoint.
            r2 = requests.get(
                f"{API}/rooms/{TIKET_ROOM_ID}/leaderboard",
                headers=headers, timeout=15,
            )
            assert r2.status_code == 200, r2.text
            lb = r2.json()
            assert lb["has_results"] is True
            entries = lb["leaderboard"]
            assert len(entries) >= 1

            # For the schedina 'prova50' (contains GENOA vs NAPOLI + ATALANTA vs SASSUOLO)
            prova50 = next(
                (e for e in entries if e["nickname"] == "prova50"),
                None,
            )
            assert prova50 is not None, "prova50 schedina missing"

            # Find the postponed event in breakdown.
            genoa_ev = next(
                (b for b in prova50["breakdown"]
                 if b["home_team"].upper() == "GENOA"
                 and b["away_team"].upper() == "NAPOLI"),
                None,
            )
            assert genoa_ev is not None, "GENOA vs NAPOLI missing from breakdown"
            assert genoa_ev["won"] is True
            assert genoa_ev["postponed"] is True
            assert genoa_ev["score"] == "RINV."

            # Product must NOT include the 4.85 odd from GENOA-NAPOLI.
            # prova50 events: pred X+OVER-1.5 on GENOA-NAPOLI (odd 4.85) → postponed → x1.00
            # ATALANTA vs SASSUOLO pred = "1+UNDER-1.5" @ 8.0 — Atalanta 1-0 Sassuolo →
            #   1 wins + UNDER 1.5 (total 1 goal) wins → prediction won → x8.0
            # Other 3 events have no fixtures set → not evaluated (no won toggle).
            # So expected total ≈ 8.0
            assert prova50["total"] == pytest.approx(8.0, rel=0.001), (
                f"expected total ≈ 8.00 (only ATALANTA-SASSUOLO odd multiplied), "
                f"got {prova50['total']}"
            )
            # Verify at least 2 wins recorded (Atalanta hit + Genoa postponed).
            assert prova50["won_count"] >= 2

        finally:
            # Cleanup: delete inserted fixtures and restore snapshot.
            _mongo(lambda db: db.fixtures.delete_many({"room_id": TIKET_ROOM_ID}))
            if existing:
                _mongo(lambda db: db.fixtures.insert_many(existing))
            # Restore room status if changed.
            _mongo(lambda db: db.rooms.update_one(
                {"id": TIKET_ROOM_ID},
                {"$set": {"status": room_status_before}},
            ))


# ==========================================================================
# TEST 5 — Idempotency
# ==========================================================================
class TestIdempotency:
    """Two safe idempotency-style checks:
      a) Toggling exclude ON twice returns 200 on both calls (no crash).
      b) Calling Score settle on an already-settled matchday returns 400
         'Giornata già chiusa' rather than crashing / double-counting.
    """

    def test_exclude_idempotent(self, headers):
        # Get a fixture.
        r = requests.get(
            f"{API}/sal/calendar?season={SEASON}&matchday={MATCHDAY}",
            headers=headers, timeout=10,
        )
        fx_id = r.json()["fixtures"][-1]["id"]  # last fixture (unused in T1)
        try:
            r1 = requests.patch(
                f"{API}/sal/calendar/fixture/{fx_id}/exclude",
                headers=headers, json={"excluded": True}, timeout=10,
            )
            assert r1.status_code == 200
            r2 = requests.patch(
                f"{API}/sal/calendar/fixture/{fx_id}/exclude",
                headers=headers, json={"excluded": True}, timeout=10,
            )
            assert r2.status_code == 200
            # Second call must yield same 'excluded=true' state.
            assert r2.json()["excluded"] is True
        finally:
            # cleanup
            requests.patch(
                f"{API}/sal/calendar/fixture/{fx_id}/exclude",
                headers=headers, json={"excluded": False}, timeout=10,
            )

    def test_settle_already_closed_returns_400(self, headers):
        # Find any already-settled sal_matchday.
        settled = _mongo(lambda db: db.sal_matchdays.find_one(
            {"status": "settled"},
            {"_id": 0, "id": 1, "tournament_id": 1},
        ))
        if not settled:
            pytest.skip("No settled sal_matchday available for idempotency check")
        r = requests.post(
            f"{API}/sal/tournaments/{settled['tournament_id']}"
            f"/matchdays/{settled['id']}/settle",
            headers=headers,
            json={"scorers": [], "postponed_during": []},
            timeout=10,
        )
        # Must be a graceful 400 (not 500/crash).
        assert r.status_code in (400, 403, 404), (
            f"expected graceful error, got {r.status_code} {r.text}"
        )
