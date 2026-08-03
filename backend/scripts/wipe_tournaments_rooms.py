"""Wipe ALL rooms + tournaments + leagues + bonus data.

Keeps STRUCTURAL data intact:
- users (admin + real players)
- sal_calendar (Serie A calendar)
- sal_players (players roster)
- matchday_facts (Serie A facts/results cache)
- fixtures (legacy fixtures)
- reset_tokens (auth)

Everything a user can create (rooms/tournaments/leagues) plus all bonus
configs/picks/credits and their dependents (memberships/participants/
matchdays/picks/invites) is DELETED.

Usage:
    python scripts/wipe_tournaments_rooms.py --dry-run
    python scripts/wipe_tournaments_rooms.py --apply
"""
import asyncio
import os
import argparse
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

# Collections that will be FULLY wiped (delete_many({}))
WIPE_COLLECTIONS = [
    # Tiket (rooms)
    "rooms", "memberships", "schedine", "invites",
    # ScoreAndLive
    "sal_tournaments", "sal_participants", "sal_matchdays",
    "sal_picks", "sal_invites",
    # Survival 2.0
    "sv_tournaments", "sv_participants", "sv_matchdays",
    "sv_picks", "sv_invites",
    # FantaGiornata
    "fg_leagues", "fg_memberships", "fg_lineups",
    "fg_matchday_results", "fg_invites", "fg_teams",
    # Bonus
    "bonus_configs", "bonus_picks", "bonus_credits",
]

# Collections that are KEPT untouched
KEEP_COLLECTIONS = [
    "users", "sal_calendar", "sal_players", "matchday_facts",
    "fixtures", "reset_tokens",
]


async def main(apply: bool):
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "test_database")]

    print("=" * 60)
    print("WIPE PLAN (dry-run)" if not apply else "APPLYING WIPE")
    print("=" * 60)

    print("\n🗑️  WILL DELETE:")
    total_del = 0
    for c in WIPE_COLLECTIONS:
        try:
            n = await db[c].count_documents({})
        except Exception:
            n = 0
        total_del += n
        print(f"  {c:.<45} {n:>6}")
    print(f"  {'TOTAL':.<45} {total_del:>6}")

    print("\n✅ WILL KEEP:")
    for c in KEEP_COLLECTIONS:
        try:
            n = await db[c].count_documents({})
        except Exception:
            n = 0
        print(f"  {c:.<45} {n:>6}")

    print("=" * 60)

    if not apply:
        print("\nRun with --apply to execute the wipe.")
        return

    print("\nExecuting deletions...")
    for c in WIPE_COLLECTIONS:
        try:
            r = await db[c].delete_many({})
            print(f"  {c:.<45} deleted={r.deleted_count}")
        except Exception as e:
            print(f"  {c:.<45} SKIPPED ({e})")

    print("\n✅ Wipe complete. Users, calendar and structural data are intact.")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true",
                   help="actually delete (default: dry-run)")
    args = p.parse_args()
    asyncio.run(main(args.apply))
