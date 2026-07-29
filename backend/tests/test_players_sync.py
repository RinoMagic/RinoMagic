"""
Tests for the new API-Football sync endpoints.
- GET /api/players/sync/status  (auth required)
- POST /api/players/sync[?dry_run=true] (auth required)

The user's api-football account is currently SUSPENDED (external condition).
So we expect POST /players/sync to return HTTP 502 with a detail string
prefixed by "API-Football:". The endpoint must NOT crash (no 500).
"""
import requests
import pytest
from conftest import API, auth_headers, _login, ADMIN_EMAIL, ADMIN_PASSWORD

INTERNAL_API = "http://localhost:8001/api"


def _assert_internal_sync_error_shape(query: str):
    """Directly hit the FastAPI process on 127.0.0.1:8001 (bypasses Cloudflare
    which mangles 5xx bodies) and verify the JSON error shape."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(
        f"{INTERNAL_API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=10,
    )
    assert r.status_code == 200
    tok = r.json()["access_token"]
    url = f"{INTERNAL_API}/players/sync"
    if query:
        url += f"?{query}"
    resp = s.post(url, headers={"Authorization": f"Bearer {tok}"}, timeout=60)
    assert resp.status_code == 502, f"internal expected 502 got {resp.status_code} {resp.text[:200]}"
    body = resp.json()
    detail = body.get("detail", "")
    assert isinstance(detail, str)
    assert "API-Football:" in detail, f"missing prefix, got {detail!r}"
    assert "suspend" in detail.lower(), f"expected 'suspended' hint, got {detail!r}"


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
        # Shape checks
        for key in ("total", "api_synced", "seasons", "api_key_configured", "current_season_env"):
            assert key in data, f"missing key {key} in {data}"
        assert isinstance(data["total"], int)
        assert isinstance(data["api_synced"], int)
        assert isinstance(data["seasons"], list)
        assert isinstance(data["api_key_configured"], bool)
        assert data["api_key_configured"] is True, "API_FOOTBALL_KEY should be configured in .env"
        assert isinstance(data["current_season_env"], int)
        # We seeded ~200+ players before any real sync
        assert data["total"] >= 1, f"expected some seeded players, got total={data['total']}"


class TestPlayersSyncEndpoint:
    """The upstream api-football account is suspended -> endpoint must return 502."""

    def test_sync_requires_auth(self):
        r = requests.post(f"{API}/players/sync?dry_run=true")
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code} {r.text}"

    def test_sync_invalid_token(self):
        r = requests.post(
            f"{API}/players/sync?dry_run=true",
            headers={"Authorization": "Bearer invalid.token.here"},
        )
        assert r.status_code == 401

    def test_sync_dry_run_returns_502_when_upstream_suspended(self, session, admin_token):
        r = session.post(
            f"{API}/players/sync?dry_run=true",
            headers=auth_headers(admin_token),
        )
        # Backend must translate upstream error to 502 (not crash)
        assert r.status_code == 502, f"expected 502 got {r.status_code} {r.text[:200]}"
        # Note: Cloudflare intercepts 5xx responses from origin and replaces the JSON body
        # with an HTML 'Bad gateway' page. So detail can only be verified via internal port.
        try:
            detail = r.json().get("detail", "")
            assert "API-Football:" in detail
        except Exception:
            # Public edge returned HTML - verify via internal port instead
            _assert_internal_sync_error_shape("dry_run=true")

    def test_sync_no_dry_run_returns_502_when_upstream_suspended(self, session, admin_token):
        r = session.post(f"{API}/players/sync", headers=auth_headers(admin_token))
        assert r.status_code == 502, f"expected 502 got {r.status_code} {r.text[:200]}"
        try:
            detail = r.json().get("detail", "")
            assert "API-Football:" in detail
        except Exception:
            _assert_internal_sync_error_shape("")

    def test_sync_error_detail_via_internal_backend(self):
        """Verify the FastAPI JSON error shape directly on 127.0.0.1:8001 (bypasses
        Cloudflare which replaces 5xx bodies with an HTML error page)."""
        _assert_internal_sync_error_shape("dry_run=true")

    def test_sync_does_not_wipe_seed_data_on_upstream_error(self, session, admin_token):
        """After a failed sync attempt, seed players must still exist (endpoint must fail
        BEFORE calling db.players.delete_many)."""
        r = session.get(f"{API}/players/sync/status", headers=auth_headers(admin_token))
        assert r.status_code == 200
        total_before = r.json()["total"]

        # trigger a failed sync
        r2 = session.post(f"{API}/players/sync", headers=auth_headers(admin_token))
        assert r2.status_code == 502

        # verify players are still there
        r3 = session.get(f"{API}/players/sync/status", headers=auth_headers(admin_token))
        assert r3.status_code == 200
        total_after = r3.json()["total"]
        assert total_after == total_before, (
            f"seed data changed after failed sync: before={total_before} after={total_after}"
        )


class TestRegressionAfterSyncRefactor:
    """Ensure the /teams refactor (uses db.players.distinct('team')) and other
    endpoints still work after the sync refactor."""

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
