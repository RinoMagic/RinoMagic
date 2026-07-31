"""
Tests for the API-Football sync endpoints (iteration 4).
- GET /api/players/sync/status  (auth required)
- POST /api/players/sync[?dry_run=true] (auth required)

The user's api-football account is currently SUSPENDED (external condition).
So we expect POST /players/sync to return HTTP 400 with a JSON detail string
prefixed by "API-Football:". The endpoint must NOT crash (no 500) and the
JSON body must be preserved through Cloudflare (previous 502 was replaced by
Cloudflare with an HTML "Bad gateway" page).
"""
import requests
from conftest import API, auth_headers


class TestPlayersSyncStatus:
    def test_status_requires_auth(self):
        r = requests.get(f"{API}/players/sync/status")
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code} {r.text}"

    def test_status_invalid_token(self):
        r = requests.get(
            f"{API}/players/sync/status",
            headers={"Authorization": "Bearer invalid.token.here"},
        )
        assert r.status_code == 401

    def test_status_ok_with_auth(self, session, admin_token):
        r = session.get(f"{API}/players/sync/status", headers=auth_headers(admin_token))
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        for key in ("total", "api_synced", "seasons", "api_key_configured", "current_season_env"):
            assert key in data, f"missing key {key} in {data}"
        assert isinstance(data["total"], int)
        assert isinstance(data["api_synced"], int)
        assert isinstance(data["seasons"], list)
        assert isinstance(data["api_key_configured"], bool)
        assert data["api_key_configured"] is True, "API_FOOTBALL_KEY should be configured in .env"
        assert isinstance(data["current_season_env"], int)
        assert data["total"] >= 1, f"expected some seeded players, got total={data['total']}"


class TestPlayersSyncEndpoint:
    """Upstream api-football account is suspended -> endpoint must return HTTP 400
    with a clean JSON body {'detail': 'API-Football: ...'} preserved through Cloudflare."""

    def test_sync_requires_auth(self):
        r = requests.post(f"{API}/players/sync?dry_run=true")
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code} {r.text}"

    def test_sync_invalid_token(self):
        r = requests.post(
            f"{API}/players/sync?dry_run=true",
            headers={"Authorization": "Bearer invalid.token.here"},
        )
        assert r.status_code == 401

    def test_sync_dry_run_returns_400_json_via_public_url(self, session, admin_token):
        r = session.post(
            f"{API}/players/sync?dry_run=true",
            headers=auth_headers(admin_token),
        )
        assert r.status_code == 400, f"expected 400 got {r.status_code} body={r.text[:300]}"
        # Ensure Cloudflare did NOT swap JSON for HTML.
        ct = r.headers.get("content-type", "")
        assert "application/json" in ct.lower(), f"expected JSON content-type got {ct!r} body={r.text[:300]}"
        body = r.json()
        detail = body.get("detail", "")
        assert isinstance(detail, str), f"detail must be a string, got {body!r}"
        assert detail.startswith("API-Football:"), f"expected 'API-Football:' prefix, got {detail!r}"

    def test_sync_no_dry_run_returns_400_json_via_public_url(self, session, admin_token):
        r = session.post(f"{API}/players/sync", headers=auth_headers(admin_token))
        assert r.status_code == 400, f"expected 400 got {r.status_code} body={r.text[:300]}"
        ct = r.headers.get("content-type", "")
        assert "application/json" in ct.lower(), f"expected JSON content-type got {ct!r} body={r.text[:300]}"
        body = r.json()
        detail = body.get("detail", "")
        assert isinstance(detail, str)
        assert detail.startswith("API-Football:"), f"expected 'API-Football:' prefix, got {detail!r}"

    def test_sync_error_body_is_not_html(self, session, admin_token):
        """Regression for the previous Cloudflare 502-body-replacement bug:
        response must be JSON, not HTML."""
        r = session.post(
            f"{API}/players/sync?dry_run=true",
            headers=auth_headers(admin_token),
        )
        text = r.text.lstrip().lower()
        assert not text.startswith("<!doctype"), "Cloudflare returned HTML instead of JSON"
        assert not text.startswith("<html"), "Cloudflare returned HTML instead of JSON"
        assert "bad gateway" not in text, "Cloudflare hijacked the body with a Bad gateway page"

    def test_sync_does_not_wipe_seed_data_on_upstream_error(self, session, admin_token):
        """After a failed sync attempt, seed players must still exist (endpoint must fail
        BEFORE calling db.players.delete_many)."""
        r = session.get(f"{API}/players/sync/status", headers=auth_headers(admin_token))
        assert r.status_code == 200
        total_before = r.json()["total"]

        r2 = session.post(f"{API}/players/sync", headers=auth_headers(admin_token))
        assert r2.status_code == 400

        r3 = session.get(f"{API}/players/sync/status", headers=auth_headers(admin_token))
        assert r3.status_code == 200
        total_after = r3.json()["total"]
        assert total_after == total_before, (
            f"seed data changed after failed sync: before={total_before} after={total_after}"
        )


class TestRegressionAfterSyncRefactor:
    """Ensure /teams (uses db.players.distinct('team')) and other endpoints still work."""

    def test_teams_still_returns_20(self, session, admin_token):
        r = session.get(f"{API}/teams", headers=auth_headers(admin_token))
        assert r.status_code == 200
        teams = r.json()
        assert isinstance(teams, list)
        assert len(teams) == 20, f"expected 20 Serie A teams got {len(teams)}: {teams}"
        assert "Inter" in teams

    def test_players_list_still_ok(self, session, admin_token):
        r = session.get(f"{API}/players", headers=auth_headers(admin_token))
        assert r.status_code == 200
        players = r.json()
        assert len(players) >= 200

    def test_me_still_ok(self, session, admin_token):
        r = session.get(f"{API}/auth/me", headers=auth_headers(admin_token))
        assert r.status_code == 200
        assert r.json()["email"] == "admin@fantagiornata.it"
