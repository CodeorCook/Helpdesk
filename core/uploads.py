import io
import os
from pathlib import Path
import re
import warnings

from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError
from pypdf import PdfReader
from pypdf.errors import PdfReadError
from starlette.responses import JSONResponse

from core.database import BASE_DIR, ConfigurationError


def upload_limit():
    try:
        value = int(os.getenv("UPLOAD_MAX_BYTES", "5242880"))
        if not 1024 <= value <= 20971520:
            raise ValueError()
        return value
    except ValueError as exc:
        raise ConfigurationError("UPLOAD_MAX_BYTES cần nằm trong 1024–20971520 byte.") from exc


def allowed_extensions():
    values = {value.strip().lower() for value in os.getenv("UPLOAD_ALLOWED_EXTENSIONS", ".txt,.pdf,.png,.jpg,.jpeg").split(",") if value.strip()}
    if not values or not values.issubset({".txt", ".pdf", ".png", ".jpg", ".jpeg"}):
        raise ConfigurationError("UPLOAD_ALLOWED_EXTENSIONS chỉ được thu hẹp trong TXT, PDF, PNG, JPG, JPEG.")
    return sorted(values)


def storage_root():
    value = Path(os.getenv("UPLOAD_DIR", str(BASE_DIR / "storage" / "attachments")))
    root = (BASE_DIR / value).resolve() if not value.is_absolute() else value.resolve()
    for public in (BASE_DIR / "static", BASE_DIR / "templates", BASE_DIR / "frontend", BASE_DIR / "docs"):
        if root == public.resolve() or root.is_relative_to(public.resolve()):
            raise ConfigurationError("UPLOAD_DIR phải nằm ngoài các thư mục public, frontend và tài liệu.")
    if root == BASE_DIR or BASE_DIR.is_relative_to(root):
        raise ConfigurationError("UPLOAD_DIR phải là thư mục riêng dành cho tệp đính kèm.")
    root.mkdir(parents=True, exist_ok=True)
    return root


def safe_path(key):
    if not re.fullmatch(r"[0-9a-f]{32}\.(png|jpg|pdf|txt)", key):
        raise HTTPException(404, "Không tìm thấy tệp.")
    root = storage_root()
    path = (root / key).resolve()
    if path.parent != root:
        raise HTTPException(404, "Không tìm thấy tệp.")
    return path


def display_name(name):
    """Legacy records may only contain a storage key; never pretend to recover its original name."""
    if re.fullmatch(r'[0-9a-f]{32}\.(png|jpg|jpeg|pdf|txt)',name,re.IGNORECASE):
        return 'Tệp đính kèm.'+name.rsplit('.',1)[-1].lower()
    return name


def verified_image(path,mime):
    if mime not in ('image/png','image/jpeg'):
        raise HTTPException(415,'Chỉ xem trước ảnh PNG/JPEG. Hãy tải xuống để xem tài liệu khác.')
    if not path.is_file():raise HTTPException(404,'Không tìm thấy tệp.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error',Image.DecompressionBombWarning)
            with Image.open(path) as picture:
                if picture.format!=('PNG' if mime=='image/png' else 'JPEG') or picture.width*picture.height>25000000:raise ValueError()
                picture.verify()
    except (ValueError,OSError,UnidentifiedImageError,Image.DecompressionBombError,Image.DecompressionBombWarning):
        raise HTTPException(415,'Không thể xem trước ảnh có nội dung không hợp lệ.')
    return mime


def validate_file(name, declared_mime, content):
    if not content or len(content) > upload_limit():
        raise HTTPException(413, "Tệp trống hoặc vượt quá giới hạn dung lượng cho phép.")
    # Tên hiển thị không tham gia tạo đường dẫn lưu trữ; vẫn loại bỏ traversal/control.
    if not name or len(name) > 255 or any(c in name for c in '/\\') or any(ord(c) < 32 for c in name):
        raise HTTPException(422, "Tên tệp không hợp lệ.")
    extension = Path(name).suffix.lower()
    allowed = {".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".pdf":"application/pdf", ".txt":"text/plain"}
    mime = allowed.get(extension)
    if extension not in allowed_extensions() or mime is None or declared_mime not in (mime, "application/octet-stream"):
        raise HTTPException(415, "Chỉ hỗ trợ tệp TXT, PDF, PNG và JPEG có nội dung phù hợp.")
    try:
        if extension == ".txt":
            text = content.decode("utf-8-sig")
            if any(ord(c)<32 and c not in '\t\n\r' for c in text):
                raise ValueError()
        elif extension == ".pdf":
            if not content.startswith(b"%PDF-") or b"%%EOF" not in content[-2048:]:
                raise ValueError()
            document = PdfReader(io.BytesIO(content), strict=True)
            if document.is_encrypted or not 1 <= len(document.pages) <= 100:
                raise ValueError()
        else:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(content)) as picture:
                    if picture.format != ("PNG" if extension == ".png" else "JPEG") or picture.width*picture.height > 25000000:
                        raise ValueError()
                    picture.verify()
    except (ValueError, UnicodeError, OSError, UnidentifiedImageError, PdfReadError, Image.DecompressionBombError, Image.DecompressionBombWarning, RecursionError) as exc:
        raise HTTPException(415, "Nội dung tệp không hợp lệ hoặc không khớp định dạng.") from exc
    return (".jpg" if extension == ".jpeg" else extension), mime


class BodyLimitMiddleware:
    """Bound streamed bodies before FastAPI's multipart parser spools files."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in ("POST", "PATCH"):
            return await self.app(scope, receive, send)
        is_upload = scope.get("path", "").startswith(("/api/v1/customer/tickets/", "/api/v1/staff/tickets/")) and scope["path"].endswith("/attachments")
        try:
            maximum = upload_limit()+65536 if is_upload else 131072
        except ConfigurationError as exc:
            return await JSONResponse({"detail":str(exc)}, status_code=503)(scope, receive, send)
        headers = dict(scope.get("headers", []))
        length = headers.get(b"content-length")
        if length:
            try:
                if int(length) > maximum or int(length) < 0:
                    return await JSONResponse({"detail":"Yêu cầu vượt quá giới hạn dung lượng."}, status_code=413)(scope, receive, send)
            except ValueError:
                return await JSONResponse({"detail":"Content-Length không hợp lệ."}, status_code=400)(scope, receive, send)
        consumed = 0
        async def bounded_receive():
            nonlocal consumed
            message = await receive()
            consumed += len(message.get("body", b""))
            if consumed > maximum:
                raise HTTPException(413, "Yêu cầu vượt quá giới hạn dung lượng.")
            return message
        return await self.app(scope, bounded_receive, send)
