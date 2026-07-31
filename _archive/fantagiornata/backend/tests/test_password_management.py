"""Iteration 7 — Password management endpoints tests.

Covers:
- POST /api/users/me/password (self-service password change)
- GET  /api/admin/users (admin-only user list with pagination + q)
- POST /api/admin/users/reset-password (admin-only password reset)
"""
import uuid
import pytest
import requests

from conftest import API, ADMIN_EMAIL, ADMIN_PASSWORD, auth_headers, _login, _register


# ---------- Fresh user helper (function-scoped so tests can mutate passwords) ----------
@pytest.fixture
def fresh_user():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    suffix = uuid.uuid4().hex[:8]
    email = f"test_pwd_{suffix}@test.com"
    username = f"TESTpwd{suffix}"
    password = "Passw0rd!"
    r = _register(s, email, password, username)
    assert r.status_code == 201, r.text
    return {
        "email": email,
        "username": username,
        "password": password,
        "token": r.json()["access_token"],
        "session": s,
    }


# ============================================================
# POST /api/users/me/password
# ============================================================
class TestChangeOwnPassword:
    def test_unauth_returns_401(self):
        r = requests.post(f"{API}/users/me/password", json={
            "current_password": "whatever",
            "new_password": "newpass1",
        })
        assert r.status_code in (401, 403), r.text

    def test_wrong_current_returns_400(self, fresh_user):
        r = requests.post(
            f"{API}/users/me/password",
            headers=auth_headers(fresh_user["token"]),
            json={"current_password": "WRONG_pwd!", "new_password": "brandnew1"},
        )
        assert r.status_code == 400, r.text

    def test_same_new_as_current_returns_400(self, fresh_user):
        r = requests.post(
            f"{API}/users/me/password",
            headers=auth_headers(fresh_user["token"]),
            json={"current_password": fresh_user["password"], "new_password": fresh_user["password"]},
        )
        assert r.status_code == 400, r.text

    def test_short_new_password_returns_422(self, fresh_user):
        r = requests.post(
            f"{API}/users/me/password",
            headers=auth_headers(fresh_user["token"]),
            json={"current_password": fresh_user["password"], "new_password": "abc"},
        )
        assert r.status_code == 422, r.text

    def test_change_password_success_then_login(self, fresh_user):
        new_pwd = "Newpass9!"
        r = requests.post(
            f"{API}/users/me/password",
            headers=auth_headers(fresh_user["token"]),
            json={"current_password": fresh_user["password"], "new_password": new_pwd},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Old password no longer works
        r_old = _login(fresh_user["session"], fresh_user["email"], fresh_user["password"])
        assert r_old.status_code == 401

        # New password works
        r_new = _login(fresh_user["session"], fresh_user["email"], new_pwd)
        assert r_new.status_code == 200, r_new.text
        assert "access_token" in r_new.json()


# ============================================================
# GET /api/admin/users
# ============================================================
class TestAdminListUsers:
    def test_unauth_returns_401(self):
        r = requests.get(f"{API}/admin/users")
        assert r.status_code in (401, 403)

    def test_non_admin_returns_403(self, fresh_user):
        r = requests.get(f"{API}/admin/users", headers=auth_headers(fresh_user["token"]))
        assert r.status_code == 403, r.text

    def test_admin_list_ok_and_shape(self, admin_token, fresh_user):
        r = requests.get(f"{API}/admin/users", headers=auth_headers(admin_token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(["items", "page", "limit", "total"]).issubset(body.keys())
        assert body["page"] == 1
        assert body["limit"] == 50
        assert isinstance(body["items"], list)
        assert body["total"] >= 2  # at least admin + fresh_user

        # No password_hash / _id leak; required fields present
        for item in body["items"]:
            assert "password_hash" not in item
            assert "_id" not in item
            assert "id" in item and "email" in item and "username" in item and "created_at" in item

        # fresh_user must appear somewhere in results (may span pages if >50 users)
        emails_page1 = {u["email"] for u in body["items"]}
        if fresh_user["email"] not in emails_page1:
            # Confirm via search
            rs = requests.get(
                f"{API}/admin/users",
                headers=auth_headers(admin_token),
                params={"q": fresh_user["username"]},
            )
            assert rs.status_code == 200
            assert any(u["email"] == fresh_user["email"] for u in rs.json()["items"])

    def test_pagination_page2(self, admin_token):
        r = requests.get(
            f"{API}/admin/users",
            headers=auth_headers(admin_token),
            params={"page": 2, "limit": 1},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["page"] == 2
        assert body["limit"] == 1
        assert len(body["items"]) <= 1

    def test_query_filter_by_username(self, admin_token, fresh_user):
        r = requests.get(
            f"{API}/admin/users",
            headers=auth_headers(admin_token),
            params={"q": fresh_user["username"]},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] >= 1
        assert any(u["username"] == fresh_user["username"] for u in body["items"])

    def test_query_filter_by_email_case_insensitive(self, admin_token, fresh_user):
        # Use uppercase substring; regex is case-insensitive
        substr = fresh_user["email"].split("@")[0].upper()
        r = requests.get(
            f"{API}/admin/users",
            headers=auth_headers(admin_token),
            params={"q": substr},
        )
        assert r.status_code == 200, r.text
        assert any(u["email"] == fresh_user["email"] for u in r.json()["items"])


# ============================================================
# POST /api/admin/users/reset-password
# ============================================================
class TestAdminResetPassword:
    def test_unauth_returns_401(self):
        r = requests.post(f"{API}/admin/users/reset-password", json={
            "email": "someone@test.com", "new_password": "abcdef1",
        })
        assert r.status_code in (401, 403)

    def test_non_admin_returns_403(self, fresh_user):
        r = requests.post(
            f"{API}/admin/users/reset-password",
            headers=auth_headers(fresh_user["token"]),
            json={"email": fresh_user["email"], "new_password": "abcdef1"},
        )
        assert r.status_code == 403, r.text

    def test_admin_reset_own_password_returns_400(self, admin_token):
        r = requests.post(
            f"{API}/admin/users/reset-password",
            headers=auth_headers(admin_token),
            json={"email": ADMIN_EMAIL, "new_password": "Abcdef12!"},
        )
        assert r.status_code == 400, r.text
        # sanity: admin login still works with original password
        s = requests.Session(); s.headers.update({"Content-Type": "application/json"})
        rl = _login(s, ADMIN_EMAIL, ADMIN_PASSWORD)
        assert rl.status_code == 200, rl.text

    def test_unknown_email_returns_404(self, admin_token):
        r = requests.post(
            f"{API}/admin/users/reset-password",
            headers=auth_headers(admin_token),
            json={"email": f"nonexistent_{uuid.uuid4().hex[:8]}@nowhere.example.com", "new_password": "abcdef1"},
        )
        assert r.status_code == 404, r.text

    def test_short_new_password_returns_422(self, admin_token, fresh_user):
        r = requests.post(
            f"{API}/admin/users/reset-password",
            headers=auth_headers(admin_token),
            json={"email": fresh_user["email"], "new_password": "abc"},
        )
        assert r.status_code == 422, r.text

    def test_admin_resets_user_password_then_login(self, admin_token, fresh_user):
        new_pwd = "AdminSet9!"
        r = requests.post(
            f"{API}/admin/users/reset-password",
            headers=auth_headers(admin_token),
            json={"email": fresh_user["email"], "new_password": new_pwd},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("email") == fresh_user["email"]
        assert body.get("username") == fresh_user["username"]

        # Old password no longer works
        s = fresh_user["session"]
        r_old = _login(s, fresh_user["email"], fresh_user["password"])
        assert r_old.status_code == 401

        # Admin-set password works
        r_new = _login(s, fresh_user["email"], new_pwd)
        assert r_new.status_code == 200, r_new.text
        assert "access_token" in r_new.json()

        # Admin's own password still works — untouched
        s2 = requests.Session(); s2.headers.update({"Content-Type": "application/json"})
        r_admin = _login(s2, ADMIN_EMAIL, ADMIN_PASSWORD)
        assert r_admin.status_code == 200, r_admin.text
