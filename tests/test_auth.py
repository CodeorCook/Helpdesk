"""Isolated API/security tests. Repository doubles only here; no DB writes."""
import hashlib
import os
import secrets
import time
import unittest
from unittest.mock import patch

os.environ["JWT_SECRET_KEY"] = secrets.token_urlsafe(48)
os.environ["FRONTEND_ORIGINS"] = "http://localhost:5173"

from fastapi.testclient import TestClient
from jose import jwt
from api.routes.auth import _attempts
from core.database import ConfigurationError
from core.security import COOKIE_NAME, PASSWORD_HASHER, issue_session, signing_key, verify_password
from main import app
from services import auth_service

ORIGIN = {"Origin": "http://localhost:5173"}


class AuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = secrets.token_urlsafe(24)
        cls.hashed = PASSWORD_HASHER.hash(cls.password)

    def setUp(self):
        _attempts.clear()
        self.client = TestClient(app)
        self.account = {"nd_ma": 1, "ho_ten": "Tài khoản kiểm thử", "email": "test@example.invalid", "mat_khau_hash": self.hashed,
                        "vai_tro": "QUAN_TRI_VIEN", "trang_thai": "HOAT_DONG"}
        self.repository = patch.object(auth_service, "find_account", side_effect=lambda **kw: self.account)
        self.repository.start()

    def tearDown(self):
        self.repository.stop()
        self.client.close()

    def login(self):
        return self.client.post("/api/v1/auth/login", json={"email": self.account["email"], "password": self.password}, headers=ORIGIN)

    def test_login_me_cookie_and_logout(self):
        response = self.login()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["role_label"], "Quản lý")
        self.assertNotIn("mat_khau_hash", response.text)
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        self.assertIn("SameSite=lax", response.headers["set-cookie"])
        self.assertEqual(self.client.get("/api/v1/auth/me").status_code, 200)
        self.assertEqual(self.client.post("/api/v1/auth/logout", headers=ORIGIN).status_code, 403)
        csrf = self.client.get("/api/v1/auth/csrf").json()["csrf_token"]
        self.assertEqual(self.client.post("/api/v1/auth/logout", headers={**ORIGIN, "X-CSRF-Token":csrf}).status_code, 204)
        self.assertEqual(self.client.get("/api/v1/auth/me").status_code, 401)

    def test_wrong_password(self):
        response = self.client.post("/api/v1/auth/login", json={"email": self.account["email"], "password": "wrong"}, headers=ORIGIN)
        self.assertEqual(response.status_code, 401)

    def test_unknown_account(self):
        self.account = None
        self.assertEqual(self.client.post("/api/v1/auth/login", json={"email":"missing@example.invalid", "password":"wrong"}, headers=ORIGIN).status_code, 401)

    def test_locked_account(self):
        self.account["trang_thai"] = "KHOA"
        self.assertEqual(self.login().status_code, 401)

    def test_lock_and_role_changes_apply_to_existing_session(self):
        self.login()
        self.account["vai_tro"] = "KHACH_HANG"
        self.assertEqual(self.client.get("/api/v1/manager/dashboard").status_code, 403)
        self.account["trang_thai"] = "KHOA"
        self.assertEqual(self.client.get("/api/v1/auth/me").status_code, 401)

    def test_roles_enforced_on_server(self):
        for stored, (role, label) in auth_service.ROLES.items():
            self.account["vai_tro"] = stored
            response = self.login()
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["user"]["role_label"], label)
            for destination in ("customer", "staff", "manager"):
                self.assertEqual(self.client.get(f"/api/v1/{destination}/dashboard").status_code, 200 if destination == role else 403)

    def test_unauthenticated_invalid_and_expired_session(self):
        self.assertEqual(self.client.get("/api/v1/auth/me").status_code, 401)
        self.client.cookies.set(COOKIE_NAME, "invalid", path="/api/v1")
        self.assertEqual(self.client.get("/api/v1/auth/me").status_code, 401)
        token = jwt.encode({"sub":"1", "iat":int(time.time())-120, "exp":int(time.time())-60,
                            "iss":"helpdesk", "aud":"helpdesk-web", "csrf":"hash", "jti":"expired"}, signing_key(), algorithm="HS256")
        self.client.cookies.set(COOKIE_NAME, token, path="/api/v1")
        self.assertEqual(self.client.get("/api/v1/auth/me").status_code, 401)

    def test_login_csrf_and_input_validation(self):
        body = {"email":self.account["email"], "password":self.password}
        self.assertEqual(self.client.post("/api/v1/auth/login", json=body).status_code, 403)
        self.assertEqual(self.client.post("/api/v1/auth/login", json=body, headers={"Origin":"https://untrusted.invalid"}).status_code, 403)
        self.assertEqual(self.client.post("/api/v1/auth/login", json={"email":"bad", "password":""}, headers=ORIGIN).status_code, 422)

    def test_plaintext_password_is_rejected(self):
        self.assertFalse(verify_password(self.password, self.password))

    def test_validation_does_not_echo_password(self):
        response = self.client.post("/api/v1/auth/login", json={"email":"bad", "password":self.password}, headers=ORIGIN)
        self.assertEqual(response.status_code, 422)
        self.assertNotIn(self.password, response.text)

    def test_missing_secret_fails_without_exposing_configuration(self):
        with patch.dict(os.environ, {"JWT_SECRET_KEY":""}):
            self.assertEqual(self.login().status_code, 503)

    def test_root_docs_and_cors(self):
        self.assertEqual(self.client.get("/").json(), {"message":"Backend đang chạy", "status":"ok"})
        self.assertEqual(self.client.get("/docs").status_code, 200)
        self.assertEqual(self.client.get("/openapi.json").status_code, 200)
        response = self.client.options("/api/v1/auth/login", headers={**ORIGIN,"Access-Control-Request-Method":"POST"})
        self.assertEqual(response.headers["access-control-allow-origin"], ORIGIN["Origin"])
        self.assertEqual(response.headers["access-control-allow-credentials"], "true")

    def test_rate_limit(self):
        for _ in range(10):
            self.login()
        self.assertEqual(self.login().status_code, 429)


if __name__ == "__main__":
    unittest.main()
