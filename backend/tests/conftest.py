import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fantasy-calcio-15.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@fantagiornata.it"
ADMIN_PASSWORD = "Admin1234!"


@pytest.fixture(scope="session")
def api_url():
    return API


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _register(session, email, password, username):
    r = session.post(f"{API}/auth/register", json={"email": email, "password": password, "username": username})
    return r


def _login(session, email, password):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password})
    return r


@pytest.fixture(scope="session")
def admin_token(session):
    r = _login(session, ADMIN_EMAIL, ADMIN_PASSWORD)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def user1(session):
    # Unique suffix to avoid conflicts between runs
    suffix = uuid.uuid4().hex[:8]
    email = f"test_user1_{suffix}@test.com"
    username = f"TESTuser1{suffix}"
    password = "Passw0rd!"
    r = _register(session, email, password, username)
    assert r.status_code == 201, f"register user1 failed: {r.status_code} {r.text}"
    token = r.json()["access_token"]
    return {"email": email, "username": username, "password": password, "token": token}


@pytest.fixture(scope="session")
def user2(session):
    suffix = uuid.uuid4().hex[:8]
    email = f"test_user2_{suffix}@test.com"
    username = f"TESTuser2{suffix}"
    password = "Passw0rd!"
    r = _register(session, email, password, username)
    assert r.status_code == 201, f"register user2 failed: {r.status_code} {r.text}"
    token = r.json()["access_token"]
    return {"email": email, "username": username, "password": password, "token": token}


@pytest.fixture(scope="session")
def user3(session):
    """Third random user, not in the league (for 403 test)."""
    suffix = uuid.uuid4().hex[:8]
    email = f"test_user3_{suffix}@test.com"
    username = f"TESTuser3{suffix}"
    password = "Passw0rd!"
    r = _register(session, email, password, username)
    assert r.status_code == 201
    return {"email": email, "username": username, "password": password, "token": r.json()["access_token"]}


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}
