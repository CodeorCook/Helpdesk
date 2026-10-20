"""Opt-in integration check: real SQL, temporary accounts, rollback on exit.

Requires explicit --execute. Does not mock query results/password checks.
Only the connection factory is bound to one rollback-only transaction so the
application sees uncommitted fixtures without persisting accounts.
PostgreSQL identity sequences may advance despite rollback.
"""
import argparse
from contextlib import contextmanager
import os
from pathlib import Path
import secrets
import json
import subprocess
import sys
import threading
import time
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from jose import jwt
from psycopg import sql

from api.routes.auth import _attempts
from core.database import BASE_DIR, database_schema, get_connection
from core.security import COOKIE_NAME, PASSWORD_HASHER, signing_key
from main import app
from services import auth_service, customer_service, staff_service, manager_service


def main():
    parser = argparse.ArgumentParser(description="Kiểm thử SQL thật với tài khoản tạm; rollback khi kết thúc.")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--browser", action="store_true", help="Kiểm thử thêm UI qua backend tạm 8001 và Vite 5174.")
    args = parser.parse_args()
    if not args.execute:
        parser.error("Cần --execute và sự đồng ý tạo bản ghi kiểm thử tạm. Không ghi mặc định.")
    password = secrets.token_urlsafe(32)
    hashed = PASSWORD_HASHER.hash(password)
    prefix = secrets.token_hex(12)
    origin = {"Origin": os.getenv("FRONTEND_ORIGINS", "http://localhost:5173").split(",")[0].strip()}
    _attempts.clear()
    with get_connection() as conn:
        gate = threading.RLock()
        with conn.transaction(force_rollback=True):
            table = auth_service.account_table(conn)
            accounts = []
            with conn.cursor() as cur:
                for i, (stored, (role, _)) in enumerate(auth_service.ROLES.items()):
                    email = f"test-{prefix}-{i}@example.invalid"
                    cur.execute(sql.SQL("INSERT INTO {} (ho_ten,email,mat_khau_hash,vai_tro,trang_thai) VALUES (%s,%s,%s,%s,%s) RETURNING nd_ma").format(table),
                                ("Kiểm thử tạm", email, hashed, stored, "HOAT_DONG"))
                    user_id = cur.fetchone()[0]
                    profile = {"customer":"khach_hang", "staff":"nhan_vien", "manager":"quan_tri_vien"}[role]
                    cur.execute(sql.SQL("INSERT INTO {} (nd_ma) VALUES (%s)").format(sql.Identifier(database_schema(), profile)), (user_id,))
                    accounts.append((email, user_id, role))
                locked_email = f"locked-{prefix}@example.invalid"
                cur.execute(sql.SQL("INSERT INTO {} (ho_ten,email,mat_khau_hash,vai_tro,trang_thai) VALUES (%s,%s,%s,%s,%s)").format(table),
                            ("Kiểm thử tạm bị khóa", locked_email, hashed, "KHACH_HANG", "KHOA"))
                cur.execute(sql.SQL("INSERT INTO {} (nd_ma) SELECT nd_ma FROM {} WHERE email=%s").format(sql.Identifier(database_schema(), "khach_hang"), table), (locked_email,))

            @contextmanager
            def rollback_connection():
                with gate:
                    yield conn

            with patch.object(auth_service, "get_connection", rollback_connection), patch.object(customer_service, "get_connection", rollback_connection), patch.object(staff_service, "get_connection", rollback_connection), patch.object(manager_service, "get_connection", rollback_connection):
                for email, user_id, role in accounts:
                    with TestClient(app) as client:
                        result = client.post("/api/v1/auth/login", headers=origin, json={"email":email.upper(),"password":password})
                        assert result.status_code == 200, f"Login {role}: HTTP {result.status_code}"
                        assert result.json()["user"]["role"] == role
                        assert "mat_khau_hash" not in result.text and hashed not in result.text
                        assert client.get("/api/v1/auth/me").json()["user"]["id"] == str(user_id)
                        for destination in ("customer", "staff", "manager"):
                            assert client.get(f"/api/v1/{destination}/dashboard").status_code == (200 if role == destination else 403)
                        csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
                        assert client.post("/api/v1/auth/logout", headers={**origin,"X-CSRF-Token":csrf}).status_code == 204
                        assert client.get("/api/v1/auth/me").status_code == 401
                    print(f"PASS PostgreSQL login/me/role/logout: {role}")
                with TestClient(app) as client:
                    for label, email, value in [("wrong password",accounts[0][0],"invalid"), ("unknown account",f"absent-{prefix}@example.invalid",password), ("locked account",locked_email,password)]:
                        assert client.post("/api/v1/auth/login", headers=origin, json={"email":email,"password":value}).status_code == 401
                        print(f"PASS PostgreSQL: {label}")
                    assert client.get("/api/v1/auth/me").status_code == 401
                    token = jwt.encode({"sub":str(accounts[0][1]),"iat":int(time.time())-120,"exp":int(time.time())-60,"iss":"helpdesk","aud":"helpdesk-web","jti":"expired","csrf":"expired"}, signing_key(),algorithm="HS256")
                    client.cookies.set(COOKIE_NAME,token,path="/api/v1")
                    assert client.get("/api/v1/auth/me").status_code == 401
                    print("PASS unauthenticated/expired session")
                if args.browser:
                    import uvicorn
                    environment = os.environ.copy()
                    environment["HELPDESK_DB_TEST_USERS"] = json.dumps([{"email":email,"role":role} for email, _, role in accounts])
                    environment["HELPDESK_DB_TEST_PASSWORD"] = password
                    with patch.dict(os.environ, {"FRONTEND_ORIGINS": os.getenv("FRONTEND_ORIGINS", "http://localhost:5173") + ",http://localhost:5174"}):
                        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=8001, log_level="error"))
                        worker = threading.Thread(target=server.run, daemon=True)
                        worker.start()
                        try:
                            for _ in range(100):
                                if server.started or not worker.is_alive():
                                    break
                                time.sleep(0.05)
                            if not server.started:
                                raise RuntimeError("Không khởi chạy được backend kiểm thử tại 8001.")
                            result = subprocess.run(["npm.cmd", "exec", "--", "playwright", "test", "--config", "playwright.database.config.ts"],
                                                    cwd=BASE_DIR / "frontend", env=environment, check=False)
                            assert result.returncode == 0, "UI PostgreSQL integration failed"
                        finally:
                            server.should_exit = True
                            worker.join(timeout=10)
        # Ngoài block force_rollback: xác nhận không còn bản ghi kiểm thử.
        with conn.cursor() as cur:
            cur.execute(sql.SQL("SELECT count(*) FROM {} WHERE email LIKE %s").format(table), (f"%{prefix}%",))
            assert cur.fetchone()[0] == 0
        print("PASS rollback: không còn tài khoản kiểm thử; không log password/hash/token.")


if __name__ == "__main__":
    main()
