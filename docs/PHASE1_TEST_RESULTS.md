# Kết quả kiểm thử Giai đoạn 1

Ngày kiểm tra: 20/10/2026. Không đưa mật khẩu, token, hash hay thông tin kết nối nhạy cảm vào báo cáo.

## Đã chạy thật

| Kiểm tra | Kết quả | Phạm vi / bằng chứng |
| --- | --- | --- |
| Kết nối PostgreSQL | PASS | Đọc `current_database()` xác nhận DB_HELPDESK |
| Khởi tạo SQL | PASS | Chỉ chạy sau khi người dùng xác nhận; thực thi docs/CSDL_Helpdesk.sql, không sửa file |
| Đối chiếu schema thật | PASS | Schema helpdesk, 20 bảng, 33 khóa ngoại; cột/tên vai trò/trạng thái khớp file SQL |
| `/health/db` trước import | PASS | 503, not_initialized, helpdesk chưa tồn tại, 0 bảng |
| `/health/db` sau import | PASS | 200, status ok, schema helpdesk, table_count 20, foreign_key_count 33 |
| `/`, Swagger `/docs`, OpenAPI | PASS | HTTP 200, phản hồi `/` được giữ nguyên |
| `/api/v1/auth/me` không đăng nhập | PASS | HTTP 401 |
| Login PostgreSQL khi chưa có schema | PASS | HTTP 503 thông báo khởi tạo phù hợp, không login giả |
| Login PostgreSQL tài khoản không tồn tại sau import | PASS | HTTP 401, không tạo phiên thành công |
| 13 test API/bảo mật cô lập | PASS | `python -X utf8 -m unittest discover -s tests -v`: 13 tests, OK |
| Frontend TypeScript + production build | PASS | `npm run build`: tsc -b và Vite build thành công |
| 6 test trình duyệt Chromium | PASS | `npm run test:e2e`: 6 passed; desktop 1280×720 và mobile iPhone 13 390×664 (emulation Chromium) |
| API PostgreSQL với tài khoản tạm | PASS | Ba vai trò đăng nhập/me/phân quyền/logout; sai mật khẩu, không tồn tại, bị khóa; không xác thực và phiên hết hạn |
| 6 test UI đăng nhập PostgreSQL thật | PASS | `scripts/test_auth_database.py --execute --browser`: 6 passed cho ba vai trò × desktop/mobile; kiểm tra thông tin thật, 403, CTA Đang phát triển và logout |
| Rollback tài khoản thử | PASS | Transaction force_rollback và truy vấn xác nhận; đọc độc lập sau khi script thoát xác nhận nguoi_dung có 0 bản ghi |
| Kiểm tra ảnh render | PASS | Đã xem ảnh Trang chủ desktop và Đăng nhập mobile, không chồng nội dung/tràn ngang |
| Dependency Python | PASS | `pip check`: No broken requirements found |
| Whitespace Git | PASS | `git diff --check` không báo lỗi tại thời điểm kiểm tra |

13 test API dùng repository double trong thư mục tests để kiểm tra logic độc lập, **không phải bằng chứng login thành công trên PostgreSQL**. Các ca bao gồm: đăng nhập đúng/sai, không tồn tại, bị khóa, đổi vai trò/khóa khi đang có phiên, phân quyền cả ba vai trò phía server, cookie HttpOnly/SameSite, logout/CSRF, không xác thực, token lỗi/hết hạn, Origin/CORS, validation không phản chiếu password, từ chối mật khẩu rõ, thiếu JWT secret, rate limit.

6 test trình duyệt không chặn hoặc giả lập phản hồi API. Kiểm tra Trang chủ/FAQ/menu, CTA sang login, bảo vệ năm đường dẫn, 404, form responsive không tràn ngang, ẩn/hiện password, ghi nhớ chưa hỗ trợ, và gửi login đến API thật với tài khoản không tồn tại để xác nhận không tạo thành công giả. Ảnh tự động nằm trong `frontend/test-results/` (Git ignore).

Các kiểm thử PostgreSQL có ghi tài khoản tạm đã được người dùng đồng ý riêng trước khi chạy. Dùng SQL thật trên schema helpdesk và hash Argon2id thật; connection factory được gắn vào một transaction rollback, không giả lập kết quả truy vấn hoặc hàm login. Backend tạm ở 8001, Vite ở 5174; chỉ dùng process env chuyển mật khẩu ngẫu nhiên, tắt video/trace cho UI có credentials. Các bản ghi không được commit; identity sequence có thể tăng. Đã xem thêm ảnh dashboard Quản lý desktop và Khách hàng mobile, không tràn ngang.

## Chưa chạy / giới hạn

| Kiểm tra | Trạng thái | Lý do |
| --- | --- | --- |
| Script tạo tài khoản Quản lý ghi dữ liệu | CHƯA CHẠY | Chỉ chạy khi chủ động được yêu cầu, chưa seed tài khoản mặc định |
| Safari / Firefox / thiết bị điện thoại vật lý | CHƯA CHẠY | Hiện kiểm tra Chromium desktop và mobile emulation |
| HTTPS, reverse proxy, nhiều worker | CHƯA CHẠY | Phạm vi localhost Giai đoạn 1; README ghi cấu hình triển khai cần thiết |

Đã chạy `scripts/test_auth_database.py --execute --browser` sau khi được đồng ý; không tự tạo tài khoản sử dụng lâu dài. Muốn tự đăng nhập sau kiểm thử, chủ động chạy script tạo Quản lý theo README.

## Lưu ý môi trường kiểm thử

- Windows sandbox chặn socket nội bộ asyncio và kết nối PostgreSQL; những kiểm thử cần socket đã được chạy lại ngoài sandbox sau approval. Không sửa ứng dụng để né lỗi môi trường này.
- Công cụ browser/computer-use tích hợp không khởi tạo được (`failed to write kernel assets`). Đã dùng bộ kiểm thử Playwright/Chromium của chính dự án để kiểm tra giao diện thật và xem ảnh render.
- Starlette hiện cài đặt cảnh báo TestClient với httpx là deprecated. Kiểm thử vẫn PASS; chưa thay dependency hoặc kiến trúc đang dùng chỉ để loại cảnh báo.
- Một lần chạy lại UI với 6 worker đồng thời bị timeout ở hai ca điều hướng (4 ca còn lại PASS). Đã giảm còn 2 worker, chuyển kiểm tra điều hướng sang chờ DOM và đóng gói Inter cục bộ, rồi chạy lại. Không dùng retry tự động để che lỗi.
- Cookie logout xóa phiên trên client. JWT stateless chưa có cơ chế thu hồi bản sao token phía server; thời hạn mặc định 60 phút, không gia hạn âm thầm.
