"""End-to-end stress test of Surviva 2.0 v2 rules.

Runs against the live backend (localhost:8001). Prints each step so a human
can validate the flow. NO test data is left behind — all created records
are cleaned up at the end.

Scenario
========
  1. Admin creates a Survival tournament (season 2026-27, start MD 1)
  2. A test player joins
  3. Player submits 3 picks on MD1 (Atalanta-Sassuolo → 1, Bologna-Lazio → X,
     Genoa-Napoli → 2)
  4. Admin settles MD1 with results:
       Atalanta 2-0 Sassuolo   (pick 1 → CORRECT → Atalanta LOCKED)
       Bologna  1-1 Lazio      (pick X → CORRECT → nothing locked)
       Genoa    3-0 Napoli     (pick 2 → WRONG   → -1 life)
     Expected participant state: lives_left=2, locked_teams=[Atalanta]
  5. On MD2 (Atalanta-Bologna) player tries "1" (Atalanta home wins) →
     should be REJECTED (Atalanta already locked)
  6. Force-lock Bologna to trigger concession, then try MD2
     Atalanta-Bologna → "1" → should now be ACCEPTED (concession)
"""
import os, sys, uuid, requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

API = os.environ.get("API_BASE_URL", "http://localhost:8001") + "/api"
ADMIN_EMAIL = "verone.salvatore@libero.it"
ADMIN_PASSWORD = "SchedinaBar2026!"


def h(tok): return {"Authorization": f"Bearer {tok}"}


def step(n, msg): print(f"\n\033[1;36m▶ STEP {n}: {msg}\033[0m")
def ok(msg):     print(f"  \033[32m✓ {msg}\033[0m")
def bad(msg):    print(f"  \033[31m✗ {msg}\033[0m"); sys.exit(1)
def info(msg):   print(f"  · {msg}")


# ----------------------------- 1. Login admin ------------------------------
step(1, "Admin login")
r = requests.post(f"{API}/auth/admin/login",
                  json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
if r.status_code != 200:
    bad(f"admin login failed: {r.status_code} {r.text}")
admin_tok = r.json()["token"]
ok("admin authenticated")


# --------------------- 2. Create a test player -----------------------------
step(2, "Register a test player")
player_email = f"stress_{uuid.uuid4().hex[:6]}@test.local"
player_pwd = "test1234"
player_username = f"stress_{uuid.uuid4().hex[:4]}"
r = requests.post(f"{API}/auth/player/register",
                  json={"email": player_email, "password": player_pwd,
                        "username": player_username})
if r.status_code != 200:
    bad(f"register failed: {r.text}")
player_tok = r.json()["token"]
player_id = r.json()["user"]["id"]
ok(f"player {player_email} registered")


# --------------------- 3. Admin creates SV tournament ----------------------
step(3, "Admin creates Survival tournament")
r = requests.post(f"{API}/sv/tournaments", headers=h(admin_tok), json={
    "name": f"StressTest_{uuid.uuid4().hex[:4]}", "season": "2026-27",
    "initial_lives": 3, "start_matchday": 1,
})
if r.status_code != 200:
    bad(f"create failed: {r.text}")
t = r.json()
tid = t["id"]
invite_code = t["invite_code"]
ok(f"tournament created id={tid[:8]}… invite={invite_code}")


# --------------------- 4. Player joins tournament --------------------------
step(4, f"Player joins with invite code {invite_code}")
r = requests.post(f"{API}/sv/tournaments/join", headers=h(player_tok),
                  json={"invite_code": invite_code})
if r.status_code != 200:
    bad(f"join failed: {r.text}")
ok(f"player joined, lives=3")


# --------------------- 5. Fetch current matchday (MD1) ---------------------
step(5, "Fetch current matchday (MD1)")
md1 = requests.get(f"{API}/sv/tournaments/{tid}/matchdays/current",
                   headers=h(player_tok)).json()
info(f"MD1 id={md1['id'][:8]}… fixtures={len(md1['fixtures'])} "
     f"picks_required={md1.get('picks_required')}")
if md1.get('picks_required') != 3:
    bad(f"picks_required expected 3, got {md1.get('picks_required')}")
ok("matchday advertises picks_required=3")


# --------------------- 6. Submit 3 picks -----------------------------------
step(6, "Player submits 3 picks: Atalanta→1, Bologna→X, Genoa→2")
picks = [
    {"home_team": "Atalanta", "away_team": "Sassuolo", "pick": "1"},
    {"home_team": "Bologna",  "away_team": "Lazio",    "pick": "X"},
    {"home_team": "Genoa",    "away_team": "Napoli",   "pick": "2"},
]
r = requests.post(f"{API}/sv/tournaments/{tid}/matchdays/{md1['id']}/picks",
                  headers=h(player_tok), json={"picks": picks})
if r.status_code != 200:
    bad(f"submit picks failed: {r.text}")
ok(f"3 picks accepted ({r.json()})")


# --------------------- 7. Verify picks readable back -----------------------
step(7, "GET /my-picks returns the 3 submitted picks")
r = requests.get(f"{API}/sv/tournaments/{tid}/matchdays/{md1['id']}/my-picks",
                 headers=h(player_tok)).json()
if len(r["picks"]) != 3:
    bad(f"expected 3 picks readable, got {len(r['picks'])}")
ok(f"{len(r['picks'])} picks readable back")


# --------------------- 8. Reject WRONG submissions (validation) ------------
step(8, "Validation: submitting only 2 picks must FAIL")
r = requests.post(f"{API}/sv/tournaments/{tid}/matchdays/{md1['id']}/picks",
                  headers=h(player_tok), json={"picks": picks[:2]})
if r.status_code == 200:
    bad("2 picks were accepted but should not be")
ok(f"2 picks rejected ({r.status_code})")

step(8.5, "Validation: submitting 3 picks on 2 different matches must FAIL")
dup = [picks[0], picks[0], picks[1]]
r = requests.post(f"{API}/sv/tournaments/{tid}/matchdays/{md1['id']}/picks",
                  headers=h(player_tok), json={"picks": dup})
if r.status_code == 200:
    bad("duplicate fixture allowed!")
ok(f"duplicate fixture rejected ({r.status_code}: {r.json().get('detail','')[:60]})")


# --------------------- 9. Admin settles MD1 --------------------------------
step(9, "Admin settles MD1 with results")
settle_body = {"results": [
    {"home_team": "Atalanta", "away_team": "Sassuolo", "home_score": 2, "away_score": 0},
    {"home_team": "Bologna",  "away_team": "Lazio",    "home_score": 1, "away_score": 1},
    {"home_team": "Genoa",    "away_team": "Napoli",   "home_score": 3, "away_score": 0},
]}
r = requests.post(f"{API}/sv/tournaments/{tid}/matchdays/{md1['id']}/settle",
                  headers=h(admin_tok), json=settle_body)
if r.status_code != 200:
    bad(f"settle failed: {r.text}")
info(f"settle stats: {r.json()['stats']}")
ok("MD1 settled")


# --------------------- 10. Verify: lives=2, locked_teams=[Atalanta] --------
step(10, "Verify: -1 life, Atalanta locked, X and wrong pick DID NOT lock")
r = requests.get(f"{API}/sv/tournaments/{tid}/locked-teams",
                 headers=h(player_tok)).json()
info(f"lives_left={r['lives_left']}, locked_teams={r['locked_teams']}")
assert r["lives_left"] == 2, f"expected 2 lives, got {r['lives_left']}"
assert r["locked_teams"] == ["Atalanta"], \
    f"expected [Atalanta] only, got {r['locked_teams']}"
ok("lives=2 (−1 for Genoa wrong pick)")
ok("locked_teams=['Atalanta'] (X pick did NOT lock Bologna/Lazio, wrong pick did NOT lock Genoa/Napoli)")


# --------------------- 11. On MD2, Atalanta cannot be picked as "1" --------
step(11, "MD2: player tries Atalanta→1 (Atalanta locked) — must REJECT")
md2 = requests.get(f"{API}/sv/tournaments/{tid}/matchdays/current",
                   headers=h(player_tok)).json()
info(f"MD2 id={md2['id'][:8]}… number={md2['matchday']}")
picks_bad = [
    {"home_team": "Atalanta",   "away_team": "Bologna",  "pick": "1"},
    {"home_team": "Cagliari",   "away_team": "Inter",    "pick": "1"},
    {"home_team": "Juventus",   "away_team": "Parma",    "pick": "1"},
]
r = requests.post(f"{API}/sv/tournaments/{tid}/matchdays/{md2['id']}/picks",
                  headers=h(player_tok), json={"picks": picks_bad})
if r.status_code == 200:
    bad(f"Atalanta re-pick was accepted (should reject): {r.json()}")
ok(f"rejected ({r.status_code}): {r.json()['detail'][:100]}")


# --------------------- 12. Concession: force Bologna locked too ------------
step(12, "Force-lock Bologna → concession must allow Atalanta-Bologna→1")
mongo = MongoClient(os.environ["MONGO_URL"])
db = mongo[os.environ.get("DB_NAME", "schedinabar")]
db.sv_participants.update_one(
    {"tournament_id": tid, "user_id": player_id},
    {"$addToSet": {"locked_teams": "Bologna"}},
)
info("Bologna added to locked_teams via DB")

r = requests.post(f"{API}/sv/tournaments/{tid}/matchdays/{md2['id']}/picks",
                  headers=h(player_tok), json={"picks": picks_bad})
if r.status_code != 200:
    bad(f"concession did NOT work: {r.status_code} {r.text}")
ok(f"concession works: 3 picks accepted (Atalanta-Bologna, "
   f"both locked, played as '1')")

# Verify the pick was stored as concession=True
pk = db.sv_picks.find_one({"tournament_id": tid, "matchday_id": md2["id"],
                           "user_id": player_id,
                           "fixture_key": "Atalanta||Bologna"})
if not pk:
    bad("concession pick not persisted")
if not pk.get("concession"):
    bad("concession flag NOT set on the pick")
ok("concession flag stored correctly on the pick")


# --------------------- 13. Cleanup ----------------------------------------
step(13, "Cleanup: delete tournament + test player")
db.sv_picks.delete_many({"tournament_id": tid})
db.sv_matchdays.delete_many({"tournament_id": tid})
db.sv_participants.delete_many({"tournament_id": tid})
db.sv_tournaments.delete_one({"id": tid})
db.sv_invites.delete_many({"tournament_id": tid})
db.users.delete_one({"id": player_id})
mongo.close()
ok("cleaned up")

print("\n\033[1;32m✅ TUTTI I TEST SUPERATI\033[0m")
print("Le nuove regole Survival 2.0 v2 funzionano correttamente end-to-end.")
