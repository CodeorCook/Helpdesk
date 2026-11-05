from collections import defaultdict, deque
from threading import Lock
from time import monotonic

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response

from core.security import (COOKIE_NAME, check_csrf, check_origin, decode_session,
                           csrf_for, issue_session, secure_cookie, session_seconds, signing_key)
from schemas.auth import LoginRequest, RegisterRequest, RegisterResponse, SessionResponse, UserResponse
from services import auth_service

router = APIRouter(prefix="/api/v1", tags=["Xác thực"])
_attempts: dict[str, deque] = defaultdict(deque)
_lock = Lock()
_registrations: dict[str, deque] = defaultdict(deque)


@router.post("/auth/register", response_model=RegisterResponse, status_code=201)
def register(body: RegisterRequest, request: Request):
    check_origin(request)
    now = monotonic()
    address = request.client.host if request.client else "unknown"
    with _lock:
        for key in list(_registrations):
            while _registrations[key] and _registrations[key][0] < now - 3600:
                _registrations[key].popleft()
            if not _registrations[key]:
                del _registrations[key]
        queue = _registrations[address]
        if len(queue) >= 20 or sum(t > now - 60 for t in queue) >= 5:
            raise HTTPException(429, "Bạn đăng ký quá nhiều lần. Vui lòng thử lại sau.", headers={"Retry-After": "60"})
        queue.append(now)
    auth_service.register(body)
    return RegisterResponse(message="Đăng ký thành công. Vui lòng đăng nhập.")


def limit_login(request: Request):
    # Giới hạn trong một process; dùng gateway/shared store khi chạy nhiều worker.
    address = request.client.host if request.client else "unknown"
    now = monotonic()
    with _lock:
        for key in list(_attempts):
            while _attempts[key] and _attempts[key][0] < now - 60:
                _attempts[key].popleft()
            if not _attempts[key]:
                del _attempts[key]
        queue = _attempts[address]
        if len(queue) >= 10:
            raise HTTPException(429, "Bạn thử đăng nhập quá nhiều lần. Vui lòng đợi một phút.", headers={"Retry-After": "60"})
        queue.append(now)


def session_claims(request: Request):
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(401, "Vui lòng đăng nhập.")
    return decode_session(token)


def authenticated_user(claims: dict = Depends(session_claims)) -> UserResponse:
    return auth_service.current_user(claims["sub"], claims["account_version"])


def require_role(role: str):
    def dependency(user: UserResponse = Depends(authenticated_user)):
        if user.role != role:
            raise HTTPException(403, "Bạn không có quyền truy cập khu vực này.")
        return user
    return dependency


def set_session(response: Response, token: str):
    response.set_cookie(COOKIE_NAME, token, httponly=True, secure=secure_cookie(), samesite="lax", path="/api/v1", max_age=session_seconds())


@router.post("/auth/login", response_model=SessionResponse)
def login(body: LoginRequest, request: Request, response: Response):
    check_origin(request)
    limit_login(request)
    signing_key()
    user, account_version = auth_service.login(body.email, body.password)
    token, csrf = issue_session(user.id, account_version)
    set_session(response, token)
    return SessionResponse(user=user, csrf_token=csrf)


@router.get("/auth/me", response_model=SessionResponse)
def me(user: UserResponse = Depends(authenticated_user)):
    return SessionResponse(user=user)


@router.get("/auth/csrf")
def csrf(claims: dict = Depends(session_claims), user: UserResponse = Depends(authenticated_user)):
    # Chỉ đọc, không đổi phiên; SOP/CORS ngăn website khác đọc token.
    return {"csrf_token": csrf_for(claims["jti"])}


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response, claims: dict = Depends(session_claims),
           csrf_header: str | None = Header(default=None, alias="X-CSRF-Token", description="Mã từ GET /api/v1/auth/csrf.")):
    check_csrf(request, claims)
    response.delete_cookie(COOKIE_NAME, path="/api/v1", secure=secure_cookie(), httponly=True, samesite="lax")


@router.get("/customer/dashboard", response_model=UserResponse)
def customer_dashboard(user: UserResponse = Depends(require_role("customer"))):
    return user


@router.get("/staff/dashboard", response_model=UserResponse)
def staff_dashboard(user: UserResponse = Depends(require_role("staff"))):
    return user


@router.get("/manager/dashboard", response_model=UserResponse)
def manager_dashboard(user: UserResponse = Depends(require_role("manager"))):
    return user
