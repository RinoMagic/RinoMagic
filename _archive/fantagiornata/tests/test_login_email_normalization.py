"""Regression tests for the "Credenziali non valide" admin login bug.

Bug: Mobile keyboards auto-capitalize/trim; backend used exact match on email
so `Admin@fantagiornata.it` (auto-cap A) returned 401 while the stored value
is lowercase. Fix normalizes login/register/admin-reset email to strip().lower()
plus a case-insensitive regex fallback for legacy records.
"""

import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    os.environ.get("EXPO_BACKEND_URL", "https://fantasy-calcio-15.preview.emergentagent.com"),
).rstrip("/")
ADMIN_EMAIL = "admin@fantagiornata.it"
ADMIN_PASSWORD = "Admin1234!"


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- Bug reproduction: admin login must accept case + whitespace ----------

@pytest.mark.parametrize("email_variant", [
    "admin@fantagiornata.it",         # exact
    "Admin@fantagiornata.it",         # auto-capitalized (original bug repro)
    "ADMIN@FANTAGIORNATA.IT",         # all uppercase
    "  admin@fantagiornata.it  ",     # whitespace padded
    "aDmIn@FantaGiornata.IT",         # mixed case
])
def test_admin_login_case_and_whitespace_insensitive(api_client, email_variant):
    resp = api_client.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email_variant, "password": ADMIN_PASSWORD},
    )
    assert resp.status_code == 200, (
        f"variant {email_variant!r} -> {resp.status_code} {resp.text}"
    )
    body = resp.json()
    assert "access_token" in body and body["access_token"]
    assert body.get("token_type", "bearer") == "bearer"


# ---------- Negative cases still return 401 ----------

def test_admin_login_wrong_password_still_401(api_client):
    resp = api_client.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": "WRONG"},
    )
    assert resp.status_code == 401
    assert resp.json().get("detail") == "Credenziali non valide"


def test_login_unknown_user_still_401(api_client):
    resp = api_client.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "noone@example.com", "password": "whatever"},
    )
    assert resp.status_code == 401
    assert resp.json().get("detail") == "Credenziali non valide"


# ---------- Registration normalization ----------

class TestRegistrationNormalization:
    """New user registration must store lowercase; login works case-insensitive."""

    _created_token = None
    _rand = uuid.uuid4().hex[:8]
    email_mixed = f"TEST_Foo.Bar_{_rand}@Test.com"
    email_lower = email_mixed.lower()
    email_upper = email_mixed.upper()
    password = "SecurePwd123!"
    username = f"TEST_user_{_rand}"

    def test_1_register_with_mixed_case_email(self, api_client):
        resp = api_client.post(
            f"{BASE_URL}/api/auth/register",
            json={
                "email": self.email_mixed,
                "password": self.password,
                "username": self.username,
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert "access_token" in body
        type(self)._created_token = body["access_token"]

    def test_2_login_with_lowercase_email(self, api_client):
        resp = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": self.email_lower, "password": self.password},
        )
        assert resp.status_code == 200, resp.text

    def test_3_login_with_uppercase_email(self, api_client):
        resp = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": self.email_upper, "password": self.password},
        )
        assert resp.status_code == 200, resp.text

    def test_4_register_again_case_insensitive_dupe_returns_409(self, api_client):
        resp = api_client.post(
            f"{BASE_URL}/api/auth/register",
            json={
                "email": self.email_upper,
                "password": "AnotherPwd123!",
                "username": self.username + "x",
            },
        )
        assert resp.status_code == 409, resp.text
        assert "gia registrata" in resp.json().get("detail", "").lower() or \
               "already" in resp.json().get("detail", "").lower()

    def test_5_auth_me_returns_normalized_email(self, api_client):
        assert type(self)._created_token, "registration test must run first"
        resp = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {type(self)._created_token}"},
        )
        assert resp.status_code == 200, resp.text
        me = resp.json()
        assert me["email"] == self.email_lower, (
            f"stored email should be lowercase, got {me['email']}"
        )


# ---------- Admin reset-password flow (case-insensitive input) ----------

class TestAdminResetFlow:
    _rand = uuid.uuid4().hex[:8]
    user_email_mixed = f"TEST_Reset_{_rand}@Example.COM"
    user_email_lower = user_email_mixed.lower()
    initial_pwd = "InitialPwd123!"
    new_pwd = "ResetPwd456!"
    admin_token = None

    def test_1_seed_user(self, api_client):
        resp = api_client.post(
            f"{BASE_URL}/api/auth/register",
            json={
                "email": self.user_email_mixed,
                "password": self.initial_pwd,
                "username": f"TEST_reset_{self._rand}",
            },
        )
        assert resp.status_code == 201, resp.text

    def test_2_admin_login_with_autocap_variant(self, api_client):
        resp = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "Admin@fantagiornata.it", "password": ADMIN_PASSWORD},
        )
        assert resp.status_code == 200, resp.text
        type(self).admin_token = resp.json()["access_token"]

    def test_3_admin_resets_password_with_mixed_case_email(self, api_client):
        assert type(self).admin_token, "admin login must have succeeded"
        resp = api_client.post(
            f"{BASE_URL}/api/admin/users/reset-password",
            json={"email": self.user_email_mixed.upper(), "new_password": self.new_pwd},
            headers={"Authorization": f"Bearer {type(self).admin_token}"},
        )
        assert resp.status_code == 200, resp.text

    def test_4_user_logs_in_with_new_password_lowercase(self, api_client):
        resp = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": self.user_email_lower, "password": self.new_pwd},
        )
        assert resp.status_code == 200, resp.text

    def test_5_old_password_no_longer_works(self, api_client):
        resp = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": self.user_email_lower, "password": self.initial_pwd},
        )
        assert resp.status_code == 401
