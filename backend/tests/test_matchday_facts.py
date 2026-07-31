"""End-to-end tests for the Matchday Facts (Voti/Marcatori PDF) module."""
import os
import pathlib
import requests
import pytest


API = os.environ.get("API_BASE_URL", "http://localhost:8001") + "/api"

ADMIN_EMAIL = "verone.salvatore@libero.it"
ADMIN_PASSWORD = "SchedinaBar2026!"

FIXTURE_PDF = pathlib.Path(__file__).parent / "fixtures" / "voti_giornata_38.pdf"


def _login(email, password):
    r = requests.post(f"{API}/auth/admin/login",
                      json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_tok():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module", autouse=True)
def _fixture_exists():
    assert FIXTURE_PDF.exists(), f"Missing sample PDF: {FIXTURE_PDF}"


# -----------------------------------------------------------------------
# Auth
# -----------------------------------------------------------------------

def test_upload_requires_admin():
    with FIXTURE_PDF.open("rb") as f:
        r = requests.post(
            f"{API}/admin/voti/upload-pdf",
            files={"file": ("voti.pdf", f, "application/pdf")},
            timeout=30,
        )
    # 401 unauthenticated (no token)
    assert r.status_code in (401, 403), r.text


# -----------------------------------------------------------------------
# Dry-run parsing
# -----------------------------------------------------------------------

def test_dry_run_extraction(admin_tok):
    with FIXTURE_PDF.open("rb") as f:
        r = requests.post(
            f"{API}/admin/voti/upload-pdf",
            params={"dry_run": "true"},
            files={"file": ("voti.pdf", f, "application/pdf")},
            headers=_h(admin_tok),
            timeout=60,
        )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["dry_run"] is True
    assert data["matchday"] == 38
    assert data["teams"] == 20
    # 17 rows per team × 20 teams = 340 players
    assert data["players"] == 340
    # We know from manual inspection: 24 scorers, 26 goals total
    assert data["scorers_count"] == 24
    assert data["total_goals"] == 26
    # Structure sanity
    for s in data["scorers"]:
        assert "team" in s and "player_name" in s and "goals" in s
    # Roles present
    assert set(data["by_role"].keys()) >= {"P", "D", "C", "A", "ALL"}


def test_rejects_non_pdf(admin_tok):
    r = requests.post(
        f"{API}/admin/voti/upload-pdf",
        files={"file": ("nope.txt", b"hello world", "text/plain")},
        headers=_h(admin_tok),
        timeout=10,
    )
    assert r.status_code == 400
    assert "pdf" in r.json()["detail"].lower()


# -----------------------------------------------------------------------
# Persistence
# -----------------------------------------------------------------------

def test_actual_import_and_read_back(admin_tok):
    # 1. Clean slate for matchday 38
    r = requests.delete(f"{API}/admin/voti/38", headers=_h(admin_tok), timeout=10)
    assert r.status_code == 200

    # 2. Import for real
    with FIXTURE_PDF.open("rb") as f:
        r = requests.post(
            f"{API}/admin/voti/upload-pdf",
            params={"dry_run": "false", "replace": "true"},
            files={"file": ("voti.pdf", f, "application/pdf")},
            headers=_h(admin_tok),
            timeout=60,
        )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["dry_run"] is False
    assert data["matchday"] == 38
    assert data["stored_total"] == 340

    # 3. Read back all facts
    r = requests.get(f"{API}/admin/voti/38", headers=_h(admin_tok), timeout=15)
    assert r.status_code == 200
    lst = r.json()
    assert lst["matchday"] == 38
    assert lst["count"] == 340

    # 4. Scorers endpoint
    r = requests.get(f"{API}/admin/voti/38/scorers", headers=_h(admin_tok), timeout=15)
    assert r.status_code == 200
    sc = r.json()
    assert sc["count"] == 24
    assert sc["total_goals"] == 26
    # Da Cunha (Como) scored 2 in this matchday
    da_cunha = [x for x in sc["scorers"] if "Da Cunha" in x["player_name"]]
    assert len(da_cunha) == 1
    assert da_cunha[0]["team"] == "Como"
    assert da_cunha[0]["total_goals"] == 2
    # Bonazzoli (Cremonese) — 1 gol da rigore (gf=0 rf=1)
    bonaz = [x for x in sc["scorers"] if "Bonazzoli" in x["player_name"]]
    assert len(bonaz) == 1
    assert bonaz[0]["rf"] == 1 and bonaz[0]["gf"] == 0

    # 5. Idempotent re-import (replace=true) does not duplicate
    with FIXTURE_PDF.open("rb") as f:
        r = requests.post(
            f"{API}/admin/voti/upload-pdf",
            params={"dry_run": "false", "replace": "true"},
            files={"file": ("voti.pdf", f, "application/pdf")},
            headers=_h(admin_tok),
            timeout=60,
        )
    assert r.status_code == 200
    assert r.json()["stored_total"] == 340


def test_list_matchdays(admin_tok):
    r = requests.get(f"{API}/admin/voti", headers=_h(admin_tok), timeout=15)
    assert r.status_code == 200
    data = r.json()
    mds = {m["matchday"]: m for m in data["matchdays"]}
    assert 38 in mds
    assert mds[38]["players"] == 340
    assert mds[38]["total_goals"] == 26


def test_delete_matchday(admin_tok):
    # Import once more to have something to delete cleanly
    with FIXTURE_PDF.open("rb") as f:
        requests.post(
            f"{API}/admin/voti/upload-pdf",
            params={"dry_run": "false", "replace": "true"},
            files={"file": ("voti.pdf", f, "application/pdf")},
            headers=_h(admin_tok),
            timeout=60,
        )
    r = requests.delete(f"{API}/admin/voti/38", headers=_h(admin_tok), timeout=10)
    assert r.status_code == 200
    assert r.json()["deleted"] == 340

    # Confirm empty
    r = requests.get(f"{API}/admin/voti/38", headers=_h(admin_tok), timeout=10)
    assert r.status_code == 200
    assert r.json()["count"] == 0


def test_bad_matchday_range(admin_tok):
    r = requests.get(f"{API}/admin/voti/0", headers=_h(admin_tok), timeout=10)
    assert r.status_code == 400
    r = requests.get(f"{API}/admin/voti/39", headers=_h(admin_tok), timeout=10)
    assert r.status_code == 400
