from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
import psycopg
from core.database import ConfigurationError, database_schema, get_connection
from core.security import allowed_origins
from api.routes.auth import router as auth_router
from api.routes.customer import router as customer_router
from api.routes.staff import router as staff_router
from api.routes.manager import router as manager_router
from api.routes.chatbot import router as chatbot_router
from core.uploads import BodyLimitMiddleware
from services.email_service import lifespan

app = FastAPI (
    lifespan = lifespan,
    title = "Hệ thống quản lý hỗ trợ khách hàng",
    description = "Backend hệ thống hỗ trợ khách hàng",
    version = "0.1.0"
)

app.include_router(auth_router)
app.include_router(customer_router)
app.include_router(staff_router)
app.include_router(manager_router)
app.include_router(chatbot_router)
app.add_middleware(BodyLimitMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins(), allow_credentials=True,
                   allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Content-Type", "X-CSRF-Token"])


@app.middleware("http")
async def response_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.exception_handler(ConfigurationError)
async def configuration_error(request: Request, exc: ConfigurationError):
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.exception_handler(psycopg.Error)
async def database_error(request: Request, exc: psycopg.Error):
    return JSONResponse(status_code=503, content={"detail": "Không thể truy cập PostgreSQL. Vui lòng kiểm tra cấu hình và schema."})

@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    names = {"name":"Họ tên", "email":"Email", "phone":"Số điện thoại", "password":"Mật khẩu",
             "password_confirmation":"Xác nhận mật khẩu", "title":"Tiêu đề", "description":"Mô tả",
             "content":"Tin nhắn", "stars":"Số sao", "gender":"Giới tính", "file":"Tệp", "type_id":"Loại hỗ trợ",
             "priority_id":"Mức ưu tiên", "group_id":"Nhóm hỗ trợ", "employee_id":"Nhân viên",
             "response_minutes":"Thời gian phản hồi (phút)", "resolution_minutes":"Thời gian xử lý (phút)",
             "current_password":"Mật khẩu xác nhận", "reason":"Lý do", "confirmed":"Xác nhận"}
    messages = []
    for error in exc.errors()[:3]:
        label = names.get(str(error["loc"][-1]), "Trường dữ liệu")
        kind = error["type"]
        if kind == "value_error" and isinstance(error.get("ctx", {}).get("error"), ValueError):
            message = str(error["ctx"]["error"])
        elif kind == "extra_forbidden":
            message = "Yêu cầu chứa trường không được phép thay đổi."
        elif kind == "missing":
            message = f"{label} là bắt buộc."
        elif kind in ("string_too_short", "string_too_long"):
            bound = error.get("ctx", {}).get("min_length") or error.get("ctx", {}).get("max_length")
            message = f"{label} cần {'ít nhất' if kind=='string_too_short' else 'tối đa'} {bound} ký tự."
        else:
            message = f"{label} không hợp lệ."
        messages.append(message)
    return JSONResponse(status_code=422, content={"detail": " ".join(messages) or "Dữ liệu không hợp lệ."})


@app.get("/")
def root () :
    return {
        "message" : "Backend đang chạy",
        "status" : "ok"
    }

@app.get("/health/db")
def check_database () :
    schema = database_schema()
    try :
        with get_connection() as conn :
            with conn.cursor() as cursor :
                cursor.execute(
                    "SELECT current_database()"
                )
                database_name = cursor.fetchone()[0]
                cursor.execute("SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = %s)", (schema,))
                schema_exists = cursor.fetchone()[0]
                cursor.execute ("""
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = %s
                        AND table_type = 'BASE TABLE'
                    ORDER BY table_name
                """, (schema,))
                tables = [
                    row[0] for row in cursor.fetchall()
                ]

                cursor.execute ("""
                    SELECT COUNT(*)
                    FROM information_schema.table_constraints
                    WHERE constraint_schema = %s
                        AND constraint_type = 'FOREIGN KEY'
                """, (schema,))
                foreign_keys = cursor.fetchone()[0]

            return JSONResponse(status_code=200 if schema_exists and tables else 503, content={
                "status": "ok" if schema_exists and tables else "not_initialized",
                "database": database_name,
                "schema": schema,
                "schema_exists": schema_exists,
                "table_count": len(tables),
                "foreign_key_count": foreign_keys
            })

    except (psycopg.Error, KeyError, ValueError) as exc :
        return JSONResponse(status_code=503, content={"detail": "Không thể kết nối PostgreSQL. Vui lòng kiểm tra cấu hình .env."})
