# Hệ thống quản lý hỗ trợ khách hàng — Giai đoạn 4

Phạm vi áp dụng: công ty giả định kinh doanh và cung cấp dịch vụ nội thất. Đây vẫn là Helpdesk tiếp nhận/xử lý yêu cầu; không có module kho, sản phẩm, đơn hàng hoặc bảo hành riêng. Chi tiết kiểm tra ảnh hưởng, phương án danh mục và kết quả điều chỉnh: [Ngữ cảnh công ty nội thất](docs/FURNITURE_CONTEXT.md).

Backend FastAPI được giữ tại thư mục gốc; frontend React + Vite + TypeScript nằm trong `frontend/`.
Đã triển khai xác thực, đăng ký công khai chỉ cho Khách hàng và toàn bộ luồng Khách hàng: tạo/tra cứu phiếu, chi tiết/lịch sử, trao đổi công khai, tệp, hồ sơ, đóng và đánh giá. Đã bổ sung nghiệp vụ Nhân viên hỗ trợ theo Phương án A: hàng đợi/đề xuất, tiếp nhận có xác nhận, lập phiếu thay khách, phân loại/ưu tiên/chuyển trong nhóm, trao đổi công khai/nội bộ, tệp và giải quyết. Đã có quản lý tài khoản/quyền, nhóm/thành viên/routing, điều phối khác nhóm, chính sách SLA và báo cáo thật ở Giai đoạn 4. SLA tự áp cho phiếu mới khi có chính sách; chưa có cảnh báo nền, chatbot hoặc ERP/CRM.

Điểm bắt đầu sử dụng: mở `http://localhost:5173/register` → đăng ký → được chuyển về `/login` với thông báo thành công → đăng nhập tài khoản thật. Không tự đăng nhập sau đăng ký, không có tài khoản/mật khẩu mặc định.

## Chạy trên Windows / VS Code

Mở thư mục dự án trong VS Code. Terminal PowerShell thứ nhất, tại thư mục gốc Backend:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
# Chỉ thực hiện nếu CHƯA có .env; giữ nguyên .env hiện có.
# Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

Không bắt buộc activate virtualenv, không cần thay ExecutionPolicy. Backend: `http://127.0.0.1:8000`, Swagger: `http://127.0.0.1:8000/docs`, health: `http://127.0.0.1:8000/health/db`.

Terminal thứ hai:

```powershell
cd frontend
npm ci
npm run dev
```

Frontend: `http://localhost:5173`. Dùng đúng hostname localhost; nếu đổi hostname/port, sửa `FRONTEND_ORIGINS` và cấu hình Vite tương ứng. Dev server proxy `/api` tới `http://127.0.0.1:8000` để cookie cùng origin với giao diện.

```powershell
npm run build
```

Node 22.12+ tương thích phiên bản Vite đã khóa trong `package-lock.json`. Frontend không chứa secret. Font Inter Variable được đóng gói cục bộ bằng `@fontsource-variable/inter`, có bộ ký tự tiếng Việt, không phụ thuộc Google Fonts khi mở trang.

## Cấu hình

`core/database.py` đọc `.env` tại thư mục gốc Backend bằng `parents[1]`, không phụ thuộc thư mục chạy. Biến môi trường của process được ưu tiên hơn `.env`.

| Biến | Ý nghĩa |
| --- | --- |
| `DB_HOST`, `DB_PORT` | Host PostgreSQL, mặc định localhost:5432 |
| `DB_NAME` | Tên database, đã kết nối xác nhận `DB_HELPDESK` |
| `DB_USER`, `DB_PASSWORD` | Tài khoản kết nối; mật khẩu bắt buộc, không fallback |
| `DB_SCHEMA` | Schema ứng dụng; SQL cung cấp dùng `helpdesk` |
| `JWT_SECRET_KEY` | Khóa ngẫu nhiên tối thiểu 32 byte; bắt buộc để tạo/đọc phiên |
| `SESSION_MINUTES` | Thời hạn cố định 1–1440 phút, mặc định 60 |
| `FRONTEND_ORIGINS` | Danh sách origin được phép, phân cách dấu phẩy, mặc định `http://localhost:5173` |
| `COOKIE_SECURE` | `false` cho HTTP localhost, `true` khi triển khai HTTPS |
| `DEFAULT_PRIORITY_ORDER` | Mặc định 2: chọn mức có `thu_tu=2` trong `muc_do_uu_tien` (Trung bình trong danh mục hiện tại); thiếu danh mục trả 503, không seed |
| `UPLOAD_MAX_BYTES` | Mặc định 5242880 (5 MiB), có thể cấu hình trong 1 KiB–20 MiB; API thông báo giới hạn cho UI |
| `UPLOAD_ALLOWED_EXTENSIONS` | Mặc định `.txt,.pdf,.png,.jpg,.jpeg`; chỉ được thu hẹp tập định dạng được kiểm tra nội dung này |
| `UPLOAD_DIR` | Mặc định `storage/attachments`, tương đối với Backend; phải là thư mục riêng ngoài static/frontend/docs/templates; Git ignore |

Đã bổ sung `DB_SCHEMA=helpdesk` và sinh khóa ngẫu nhiên vào `.env` local nếu trước đó chưa có các khóa này, không hiển thị giá trị bí mật. `.env`, `.venv`, node_modules, build và kết quả test được Git ignore. `.env.example` chỉ chứa mẫu cấu hình.

Nếu tự cấu hình khóa, tạo bằng trình sinh ngẫu nhiên an toàn rồi điền cục bộ; không dùng mật khẩu fallback, không commit khóa. Thiếu cấu hình trả thông báo 503 an toàn; `/` và `/docs` vẫn truy cập được.

Để thử login từ Swagger, thêm origin chính xác của trang Swagger vào `FRONTEND_ORIGINS`, ví dụ `http://localhost:5173,http://127.0.0.1:8000`, rồi khởi động lại backend. Login kiểm tra Origin để chống login CSRF.

## Database và khởi tạo có kiểm soát

File tham chiếu thật: `docs/CSDL_Helpdesk.sql`. Đã đọc đủ ba sơ đồ use case và hai bản xuất Trang chủ/Đăng nhập trong `docs/references/`. Những bản xuất còn lại chỉ là tham chiếu cho giai đoạn sau.

Ngày 20/10/2026 đã xác nhận kết nối thực tới `DB_HELPDESK`. Ban đầu database chưa có bảng ứng dụng. Sau khi người dùng đồng ý, đã thực thi đúng `docs/CSDL_Helpdesk.sql` qua `scripts/initialize_database.py --execute`, tạo schema `helpdesk` với 20 bảng và các danh mục cố định. Đã đối chiếu cột/ràng buộc thực tế, khớp SQL tham chiếu. Không tạo tài khoản sử dụng mặc định. File SQL là script khởi tạo, không phải migration.

Kiểm tra chỉ đọc:

```powershell
.\.venv\Scripts\python.exe -X utf8 scripts/inspect_database.py
```

CSDL đã có dữ liệu danh mục và 20 bảng: `DB_HELPDESK > Schemas > helpdesk > Tables`. **Không chạy lại SQL khởi tạo hoặc scripts/initialize_database.py trên database hiện tại.** Giai đoạn 2 không có migration, không sửa bảng/cột/role và không seed dữ liệu sử dụng.

`/health/db` trả database/schema, số bảng và khóa ngoại; HTTP 503 với `not_initialized` khi schema thiếu hoặc rỗng, HTTP 200 khi schema có bảng. Đây là health kết nối/cấu trúc tổng quát, không chứng nhận mọi bảng nghiệp vụ đã đầy đủ. Không trả mật khẩu, hash, host, user hay danh sách tài khoản. SQL xác thực kiểm tra metadata bảng trước khi truy vấn; thiếu bảng trả 503.

Mã và cột theo SQL tham chiếu:

| CSDL | Ứng dụng | Giao diện |
| --- | --- | --- |
| `KHACH_HANG` | `customer` | Khách hàng |
| `NHAN_VIEN` | `staff` | Nhân viên hỗ trợ |
| `QUAN_TRI_VIEN` | `manager` | Quản lý |

Tài khoản dùng `nguoi_dung.nd_ma`, `ho_ten`, `email`, `mat_khau_hash`, `vai_tro`, `trang_thai`; chỉ `HOAT_DONG` được đăng nhập. Email đối chiếu không phân biệt hoa thường, phù hợp index `lower(email)`. Không sửa enum/mã vai trò hay thêm actor. Bảng phụ của Quản lý vẫn là `quan_tri_vien` để tương thích SQL.

Tạo tài khoản Quản lý **chỉ khi chủ động yêu cầu**, sau khi schema được khởi tạo:

```powershell
.\.venv\Scripts\python.exe -X utf8 scripts/create_manager.py --execute
```

Script hỏi họ tên, email, mật khẩu ẩn (tối thiểu 12 ký tự), lưu Argon2id, thêm `nguoi_dung` và bảng phụ trong một transaction. Không có tài khoản/mật khẩu mặc định. Có thể nhận `MANAGER_NAME`, `MANAGER_EMAIL`, `MANAGER_PASSWORD` từ process env cục bộ; không đưa mật khẩu vào dòng lệnh hoặc Git. Email trùng sẽ rollback, không đổi tài khoản cũ. Script không tạo schema, bảng hoặc role.

## API và phiên

| Method | Endpoint | Hành vi |
| --- | --- | --- |
| GET | `/` | Giữ phản hồi Backend đang chạy |
| GET | `/health/db` | Kiểm tra schema cấu hình |
| POST | `/api/v1/auth/login` | Body `{email,password}`, cookie HttpOnly và thông tin người dùng + CSRF token |
| POST | `/api/v1/auth/register` | Body `{name,email,phone?,password,password_confirmation}`; luôn tạo Khách hàng, 201; email trùng 409; chưa cấp cookie |
| GET | `/api/v1/auth/me` | Thông tin tài khoản thật, kiểm tra lại trạng thái/vai trò từ CSDL |
| GET | `/api/v1/auth/csrf` | Đọc CSRF token cho phiên hiện tại sau reload, không gia hạn hoặc đổi phiên |
| POST | `/api/v1/auth/logout` | Yêu cầu Origin hợp lệ + `X-CSRF-Token`, xóa cookie, 204 |
| GET | `/api/v1/customer/dashboard` | Chỉ Khách hàng |
| GET | `/api/v1/staff/dashboard` | Chỉ Nhân viên hỗ trợ |
| GET | `/api/v1/manager/dashboard` | Chỉ Quản lý |

Cookie có `HttpOnly`, `SameSite=Lax`, path `/api/v1`, thời hạn cố định; JWT HS256 kiểm tra chữ ký, issuer, audience và expiry. Không trả JWT ra response body hoặc lưu localStorage. Mỗi request bảo vệ đọc lại tài khoản, nên khóa tài khoản/đổi vai trò có hiệu lực với request tiếp theo. Argon2id là định dạng tạo mới; hỗ trợ kiểm tra bcrypt có sẵn, không tự đổi hash và không so sánh mật khẩu rõ. Response validation không phản chiếu password nhập vào. Thông báo đăng nhập không phân biệt tài khoản không tồn tại/bị khóa. Có giới hạn 10 lần đăng nhập/phút/IP trong một process.

Đăng xuất hiện là xóa cookie phía client theo cơ chế JWT stateless. Bản sao token đã bị lấy trước đó còn hiệu lực tới expiry; chưa có danh sách thu hồi token phía server. Không có refresh token hoặc ghi nhớ dài hạn. Triển khai nhiều worker cần rate limiter dùng chung/gateway; không tin `X-Forwarded-For` từ client tự gửi.

Triển khai production nên phục vụ frontend và `/api` cùng origin qua reverse proxy HTTPS, `COOKIE_SECURE=true`, origin chính xác (không wildcard), và cấu hình SPA fallback về index.html. Thiết kế hiện dành cho cùng site; không tự bật cookie cross-site. Không đưa secret vào các biến Vite.

## Route giao diện

| Route | Nội dung |
| --- | --- |
| `/` | Trang chủ công khai; hero, tính năng dự kiến, quy trình, FAQ, footer |
| `/login`, `/register` | Đăng nhập/đăng ký Khách hàng nối API thật; chưa hỗ trợ ghi nhớ/khôi phục mật khẩu |
| `/customer` | Tổng quan số phiếu thật và các phiếu gần đây |
| `/customer/tickets/new` | Tạo phiếu, tệp đầu tiên tùy chọn |
| `/customer/tickets`, `?history=1` | Danh sách, tra cứu, lịch sử với bộ lọc và phân trang |
| `/customer/tickets/:id` | Chi tiết, tin nhắn công khai, tài liệu, lịch sử, xác nhận đóng và đánh giá khi đủ điều kiện |
| `/customer/profile` | Chỉ cập nhật họ tên, điện thoại và giới tính; email chỉ đọc |
| `/staff`, `/staff/*` | Nghiệp vụ Nhân viên Giai đoạn 3, kiểm tra đúng vai trò |
| `/manager`, `/manager/*` | Tổng quan, tài khoản/quyền, nhóm/thành viên/routing, giám sát/điều phối phiếu, SLA, báo cáo Giai đoạn 4 |
| `/support/new`, `/support/lookup` | Qua kiểm tra đăng nhập/vai trò rồi chuyển sang tạo/tra cứu phiếu Khách hàng; staff/manager bị chặn |
| Các đường dẫn khác | Trang 404 |

Frontend và backend đều kiểm tra quyền. Sai vai trò hiển thị không đủ quyền; API trả 403. Không xác thực trả 401. Không dùng mock đăng nhập trong frontend. Dữ liệu ticket trên trang chủ được gắn nhãn minh họa, không được lấy làm dữ liệu dashboard. Không triển khai chatbot mặc dù bản thiết kế có khu vực chatbot.

## Kiểm thử

```powershell
# Tại thư mục gốc
.\.venv\Scripts\python.exe -X utf8 -m unittest discover -s tests -v
# Tại frontend/, backend phải đang chạy
npx playwright install chromium
npm run test:e2e
```

Kiểm thử PostgreSQL và UI với tài khoản tạm (chỉ chạy khi đồng ý tạo bản ghi thử và rollback), tại thư mục gốc:

```powershell
.\.venv\Scripts\python.exe -X utf8 scripts/test_auth_database.py --execute --browser
```

Lệnh này dùng SQL/password verification thật. Connection factory của backend kiểm thử được gắn vào một transaction rollback để frontend nhìn thấy tài khoản chưa commit; không giả lập kết quả truy vấn hoặc login. Backend kiểm thử tạm chạy ở 8001, Vite chế độ `database-test` ở 5174, không thay backend/frontend thường ở 8000/5173. Mật khẩu ngẫu nhiên chỉ chuyển trong bộ nhớ/process env, không ghi vào repo hay ảnh/trace. Lệnh không để lại tài khoản, nhưng identity sequence PostgreSQL có thể tăng. Đã thực thi với sự đồng ý của người dùng: các ca API và 6 ca UI cho ba vai trò PASS, xác nhận lại 0 tài khoản tồn tại sau rollback.

Chi tiết kết quả, phạm vi thật/giả lập và các bước chưa chạy: `docs/PHASE1_TEST_RESULTS.md`.

## File thêm / sửa

- Sửa: `main.py`, `core/database.py`, `.gitignore`, `requirements.txt` (chuyển UTF-16 sang UTF-8 để dễ quản lý; giữ các dependency cũ và bổ sung psycopg 3, Argon2, HTTP client).
- Backend mới: `core/security.py`, `schemas/auth.py`, `services/auth_service.py`, `api/routes/auth.py`, `.env.example`.
- Script và test: `scripts/inspect_database.py`, `scripts/initialize_database.py`, `scripts/create_manager.py`, `scripts/test_auth_database.py`, `tests/test_auth.py`.
- Frontend: `frontend/package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/api.ts`, `src/auth.tsx`, `src/components.tsx`, `src/styles.css`, `src/pages/Home.tsx`, `Login.tsx`, `Dashboard.tsx`, `playwright.config.ts`, `playwright.database.config.ts`, `tests/navigation.spec.ts`, `database-tests/auth.spec.ts`.
- Tài liệu mới: `README.md`, `docs/PHASE1_TEST_RESULTS.md`. `.env` chỉ cập nhật cục bộ, không vào Git. Không sửa SQL và các bản thiết kế người dùng cung cấp.

## Vấn đề nghiệp vụ và công việc tiếp theo

- Đã import SQL vào DB_HELPDESK theo xác nhận. Không chạy lại script khởi tạo; script có kiểm tra từ chối khi database đã có đối tượng ứng dụng.
- Không để lại tài khoản thử hoặc tài khoản sử dụng mặc định. Muốn tự đăng nhập, chủ động chạy script tạo Quản lý với thông tin phù hợp.
- Nhãn “Nhân viên quản lý” trong use case Nhân viên hỗ trợ được đối chiếu với Quản lý; không tạo vai trò thứ tư.
- Use case Quản lý có lọc theo địa phương; SQL hiện không có cột địa phương. Ghi nhận mâu thuẫn, chưa thêm bảng/cột.
- SQL có dữ liệu/khung chatbot và trạng thái DA_HUY; không suy ra yêu cầu triển khai chatbot hoặc nghiệp vụ hủy phiếu ở Giai đoạn 1.
- Nhân viên/chuyển trong nhóm ở Giai đoạn 3; Quản lý/điều phối khác nhóm/cấu hình và áp SLA/báo cáo ở Giai đoạn 4. Khôi phục mật khẩu, bắt buộc đổi lần đầu, ghi nhớ đăng nhập và cảnh báo SLA nền chưa triển khai.

## Use Case → API → CSDL Giai đoạn 2

Tất cả endpoint dưới `/api/v1/customer` yêu cầu cookie hợp lệ, vai trò customer và bản ghi `khach_hang` 1–1. Thiếu bản ghi phụ trả 409 với hướng dẫn liên hệ Quản lý. POST/PATCH yêu cầu Origin hợp lệ + `X-CSRF-Token` lấy từ `/api/v1/auth/csrf` (kể cả sau reload). Đăng ký chưa có phiên dùng kiểm tra Origin; không yêu cầu CSRF của phiên chưa tồn tại.

| Use case | API (tiền tố `/api/v1`) | CSDL |
| --- | --- | --- |
| Đăng ký Khách hàng | `POST /auth/register` | `nguoi_dung` + `khach_hang`, cùng transaction |
| Tổng quan | `GET /customer/overview` | `phieu_ho_tro`, `trang_thai`; chỉ phiếu chính chủ |
| Danh mục | `GET /customer/ticket-types`, `/customer/ticket-statuses` | `loai_ho_tro`, `trang_thai` |
| Tạo phiếu | `POST /customer/tickets` | `phieu_ho_tro`, `lich_su_trang_thai`, danh mục loại/ưu tiên/trạng thái |
| Tra cứu / lịch sử | `GET /customer/tickets?search=&type=&status=&from=&to=&page=&page_size=` | `phieu_ho_tro` và danh mục, điều kiện chủ sở hữu bắt buộc |
| Chi tiết | `GET /customer/tickets/{id}` | Phiếu, danh mục, tên nhân viên, tin nhắn công khai, metadata tệp, lịch sử và đánh giá |
| Trao đổi | `POST /customer/tickets/{id}/messages` body `{content}` | `tin_nhan`, luôn `la_ghi_chu_noi_bo=false` |
| Chính sách tệp | `GET /customer/attachment-policy` | Cấu hình dung lượng/đuôi tệp an toàn, không trả đường dẫn nội bộ |
| Tải tệp lên | `POST /customer/tickets/{id}/attachments`, multipart field `file` | `tep_dinh_kem` + lưu trữ private |
| Tải xuống | `GET /customer/tickets/{id}/attachments/{attachment_id}` | Kiểm tra chủ phiếu, ID tệp và khóa đường dẫn; trả attachment |
| Hồ sơ | `GET/PATCH /customer/profile` | `nguoi_dung`, chỉ whitelist `name/phone/gender` |
| Đóng phiếu | `POST /customer/tickets/{id}/close` body `{}` hoặc `{reason}` | Khóa phiếu; cập nhật trạng thái/ngày đóng và lịch sử trong cùng transaction |
| Đánh giá | `POST /customer/tickets/{id}/rating` body `{stars,comment?}` | `danh_gia`, UNIQUE phiếu và kiểm tra chủ phiếu |

## Quy tắc và cách thử Giai đoạn 2

Thử bằng Swagger: thêm đúng origin của trang `/docs` vào `FRONTEND_ORIGINS` trong `.env` local, ví dụ `http://localhost:5173,http://127.0.0.1:8000`, rồi khởi động lại Backend. POST register → POST login (browser nhận cookie HttpOnly) → GET auth/csrf → chép `csrf_token` vào ô header **X-CSRF-Token** mà Swagger hiển thị ở các endpoint POST/PATCH customer. GET ticket-types lấy ID loại → POST tickets → GET tickets → GET tickets/{id} → POST messages hoặc multipart attachments. Đóng/đánh giá chỉ thử khi phiếu thật đã ở trạng thái phù hợp; trong phase này dùng harness rollback cho fixture giải quyết, không sửa phiếu sử dụng trong DBeaver để làm demo.

1. `/register`: họ tên tối đa 100, email tối đa 150 ký tự và kiểm tra định dạng bằng EmailStr; chuẩn hóa trim/lower, UNIQUE lower(email) xử lý cả xung đột. Điện thoại tùy chọn, 7–15 chữ số, tối đa 20 ký tự khi có định dạng. Mật khẩu 12–1024 ký tự, có chữ và số/ký tự đặc biệt, chấp nhận cụm từ dài; giới hạn trên để chặn chi phí xử lý không giới hạn. Không cắt khoảng trắng mật khẩu. Client/server kiểm tra xác nhận khớp. Từ chối mọi trường ngoài mẫu, kể cả role/vai_tro/id/trạng thái/hash.
2. Sau đăng ký, đăng nhập. `/me` trả thông tin thật và `role=customer`; mã lưu trong DB là KHACH_HANG. Đăng ký giới hạn 5 lần/phút và 20 lần/giờ/IP trong một process; dùng gateway/shared limiter khi triển khai nhiều worker. Không gửi email hay tự dựng quy trình xác minh email/đổi mật khẩu.
3. `/customer/tickets/new`: tiêu đề 1–200, mô tả tối đa 20000 ký tự, loại đang hoạt động. Server lấy chủ phiếu từ phiên, nguồn KHACH_HANG, trạng thái MOI, ưu tiên theo cấu hình. ID phiếu do PostgreSQL sinh; API trả ID BIGINT dạng chuỗi để tránh mất độ chính xác JavaScript. Không chọn ưu tiên hoặc tự gán SLA ở giao diện.
4. Tra cứu “theo tên” nghĩa là **tiêu đề phiếu của chính khách**. Bộ lọc `type` là ID loại, `status` là mã trạng thái; from/to là ngày tạo, tính cả hai đầu theo giờ Việt Nam UTC+7. Sắp xếp cập nhật mới nhất rồi ID giảm dần; page_size mặc định 10, tối đa 50. Chuỗi search dùng tham số SQL và coi `%`, `_` là ký tự tìm kiếm thật. Giao diện lịch sử dùng cùng nguồn dữ liệu qua `?history=1`.
5. Mọi ID phiếu không tồn tại hoặc khác chủ sở hữu đều trả 404. Staff/manager không được truy cập module customer (403). Chi tiết không trả hash/email nhân viên/ghi chú nội bộ/đường dẫn đĩa. Tin nhắn công khai lấy 200 mục mới nhất, có thông báo khi bị giới hạn. Lịch sử không trả ghi chú nội bộ.
6. Chỉ thêm tin nhắn/tệp khi MOI, DANG_XU_LY hoặc TAM_DUNG. DA_GIAI_QUYET/DA_DONG/DA_HUY ở chế độ chỉ đọc. API trả 409 khi trạng thái không phù hợp. Nội dung tin nhắn tối đa 10000 ký tự.
7. Tệp: tối đa 20 tệp/phiếu; TXT phải UTF-8, ảnh PNG/JPEG được Pillow kiểm tra (tối đa 25 triệu điểm ảnh), PDF có cấu trúc hợp lệ, không mã hóa, 1–100 trang. Không tin MIME/đuôi tệp đơn lẻ. Body được giới hạn cả Content-Length lẫn streaming trước parser multipart; JSON tối đa 128 KiB. Tên hiển thị không chứa slash/control; tên lưu trữ ngẫu nhiên, metadata chỉ lưu khóa tương đối. Download qua API, Content-Disposition attachment + nosniff. Đây là kiểm tra cấu trúc/định dạng, không có dịch vụ quét mã độc tích hợp.
8. Tạo phiếu và lịch sử là transaction nguyên tử. Upload là endpoint riêng: nếu phiếu đã tạo nhưng tệp lỗi, UI báo rõ phiếu đã tạo và cho thêm lại tệp tại chi tiết, không gửi lại để tạo phiếu trùng. Nếu ghi metadata/commit upload lỗi, file vừa tạo được dọn. Khóa dòng phiếu bảo vệ các thao tác đồng thời và giới hạn số tệp. Crash giữa ghi file và commit có thể để tệp mồ côi, chưa có tác vụ đối soát storage nền trong phase này.
9. Chỉ đóng từ DA_GIAI_QUYET sang DA_DONG, có xác nhận UI, ghi ngay_dong và lịch sử. Đánh giá 1–5 sao chỉ sau DA_DONG, tối đa một lần, không sửa/xóa; nhận xét tối đa 2000 ký tự. Không có API phía nhân viên để chuyển sang giải quyết trong phase này. Các ca đóng/đánh giá được kiểm thử bằng fixture transaction, không sửa phiếu sử dụng để trình diễn.
10. Hồ sơ chỉ sửa name/phone/gender. Giá trị gender: NAM, NU, KHAC, KHONG_TIET_LO hoặc null; không sửa schema. Email/mật khẩu/role/trạng thái/ID bị từ chối. Nghiệp vụ staff ở Giai đoạn 3 và manager ở Giai đoạn 4 đã triển khai. Khôi phục mật khẩu, chatbot, thông báo chưa đọc và SLA nền chưa triển khai; không có số liệu giả.

## Kiểm thử Giai đoạn 2

Tại thư mục gốc, sau khi cài requirements và frontend dependencies:

```powershell
# Kiểm tra từng mốc, dữ liệu đều rollback; đổi A thành B/C/D/E khi cần
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase2.py --execute --stage A
# Toàn luồng API + desktop/mobile trên backend 8001/Vite 5174 tạm
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase2.py --execute --stage E --browser
```

Không chạy song song hai harness có backend tạm 8001. `--execute` là opt-in dữ liệu kiểm thử; không seed tài khoản/phiếu sử dụng. Connection factory được gắn vào transaction rollback và khóa tuần tự trong harness; SQL, API, hash, file và giao diện đều thật. File được lưu trong TemporaryDirectory và dọn khi kết thúc. Identity sequence PostgreSQL có thể tăng dù rollback. Smoke đăng ký trên trình duyệt cũng nằm trong transaction này; không để lại tài khoản thử.

Kết quả chi tiết và CHƯA CHẠY: `docs/PHASE2_TEST_RESULTS.md`; báo cáo Giai đoạn 1 giữ tại `docs/PHASE1_TEST_RESULTS.md`. Backend/frontend thông thường vẫn dùng 8000/5173; không cần chạy harness để sử dụng /register.

## File thêm/sửa cho Giai đoạn 2

- Backend sửa: `main.py`, `schemas/auth.py`, `services/auth_service.py`, `api/routes/auth.py`, `requirements.txt`, `.env.example`, `.gitignore`.
- Backend mới: `schemas/customer.py`, `services/customer_service.py`, `api/routes/customer.py`, `core/uploads.py`, `core/validation.py`.
- Frontend sửa: `src/App.tsx`, `src/api.ts`, `src/auth.tsx`, `src/main.tsx`, `src/pages/Login.tsx`; Trang chủ chỉ sửa FAQ còn báo tính năng chưa triển khai để khớp luồng hiện tại.
- Frontend mới: `src/pages/Register.tsx`, `src/validation.ts`, và `src/customer/` gồm `api.ts`, `Layout.tsx`, `Overview.tsx`, `NewTicket.tsx`, `Tickets.tsx`, `Detail.tsx`, `Interaction.tsx`, `Completion.tsx`, `Profile.tsx`, `FileInput.tsx`, `styles.css`.
- Test mới: `scripts/test_phase2.py`, `frontend/playwright.phase2.config.ts`, `frontend/phase2-tests/customer.spec.ts`.
- Regression điều chỉnh đúng thay đổi chức năng: `scripts/test_auth_database.py`, `frontend/database-tests/auth.spec.ts` (CTA Khách hàng giờ mở tạo phiếu thật; kiểm tra login/cookie/ba role vẫn giữ).
- Tài liệu: README này và `docs/PHASE2_TEST_RESULTS.md`. Không sửa `.env` thật, file SQL hoặc các tài liệu thiết kế; không có migration.


## Giai đoạn 3 — Nhân viên hỗ trợ (Phương án A)

Đề xuất **không phải phân công**: xếp theo nhóm chuyên môn và khối lượng phiếu chưa giải quyết. Chỉ thao tác **Lập phiếu hỗ trợ** trên trang xét duyệt mới chuyển cùng bản ghi sang Đang xử lý và tạo phân công hiệu lực. Hai người nhận đồng thời: một thành công, người còn lại nhận 409. Nhân viên giải quyết; khách xác nhận đóng và đánh giá. Chuyển trực tiếp chỉ trong cùng nhóm; đổi loại không tự chuyển người/nhóm hoặc tính lại SLA.

Routes: `/staff` (dashboard thật), `/staff/queue`, `/staff/recommended`, `/staff/mine`, `/staff/team`, `/staff/new` (phiếu riêng thay khách điện thoại/trực tiếp), `/staff/tickets/:id`. Bộ lọc ID/#HT-ID/tiêu đề, loại, trạng thái, ưu tiên, khoảng ngày và phân trang. API prefix `/api/v1/staff`; mọi mutation giữ cookie HttpOnly/CSRF/Origin. Danh sách API, bảng mapping Use Case → API → CSDL, quyền và kết quả kiểm thử: [PHASE3_TEST_RESULTS.md](docs/PHASE3_TEST_RESULTS.md).

Đã được duyệt và áp dụng 4 nhóm + 8 ánh xạ nội thất; script chạy lại an toàn. Chưa có tài khoản/hồ sơ nhân viên, thành viên nhóm và SLA sử dụng; cần cấp/cấu hình được duyệt trước khi tiếp nhận dữ liệu thật. Không có mật khẩu mặc định hoặc đăng ký nhân viên công khai. [Chi tiết cấu hình nhóm](docs/PHASE3_GROUP_SETUP.md). SLA chỉ hiển thị hạn thật; thiếu cấu hình báo rõ, không sinh deadline. Cảnh báo cập nhật khi bấm Làm mới, không tác vụ nền/push.

Trước khi bật luồng lập phiếu trên CSDL đang dùng, mở [001_staff_request_snapshot.sql](docs/migrations/001_staff_request_snapshot.sql) trong DBeaver với kết nối DB_HELPDESK và chạy toàn bộ script. Migration thêm cột JSONB `helpdesk.phieu_ho_tro.yeu_cau_goc`, giữ phiếu hiện hữu và không điền lại nội dung đã mất của các phiếu cũ. Nếu hết thời gian chờ khóa, rollback giao dịch và thử lại vào lúc ít tải. Script kiểm thử race dùng các kết nối thật và cần cột này trong CSDL kiểm thử.

Lệnh khởi động Windows giữ nguyên ở đầu README. Để thử: `/register` → khách tạo phiếu → nhân viên đã được cấp và thuộc nhóm mở `/staff/queue` → mở yêu cầu, chọn mức ưu tiên và lập phiếu → phản hồi/tệp → Đã giải quyết → khách đóng/đánh giá. Không tạo phiếu thứ hai sau tiếp nhận. Tài khoản/nhóm/chính sách SLA của Quản lý ở Giai đoạn 4.

```powershell
# Tại thư mục Backend; không chạy đồng thời các bộ browser dùng port 8001/5174
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase3.py --execute --stage E --browser
# Race dùng kết nối độc lập, fixture riêng commit rồi cleanup đúng ID
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase3_race.py --execute
```


## Giai đoạn 4 — Quản lý

Đã có `/manager` tổng quan PostgreSQL thật; `/manager/users` và `/:id` tạo Nhân viên, sửa thông tin/khóa/mở và phân quyền có xác nhận; `/manager/groups` và `/:id` quản lý nhóm/thành viên và ánh xạ loại yêu cầu; đường dẫn cũ `/manager/routing` chuyển về danh sách nhóm; `/manager/tickets` và `/:id` giám sát/điều phối cùng hoặc khác nhóm; `/manager/sla` chính sách; `/manager/reports` thống kê/hoạt động phân trang. API prefix `/api/v1/manager`; [bảng Use Case → API → CSDL, file thay đổi và kiểm thử](docs/PHASE4_TEST_RESULTS.md).

Không xóa cứng tài khoản, không tự khóa/hạ quyền, không làm mất Quản lý cuối cùng. Chỉ đổi role khi tài khoản chưa có nghiệp vụ/nhóm; yêu cầu mật khẩu actor và xác nhận, giới hạn 5 lần/phút/process. Không thêm actor hoặc đổi mã QUAN_TRI_VIEN. Tạo nhân viên luôn gán NHAN_VIEN và tạo hồ sơ cùng transaction. Hệ thống không gửi email hoặc bắt đổi mật khẩu lần đầu; bàn giao mật khẩu ban đầu qua kênh riêng được tổ chức chấp thuận. Email/mật khẩu không chỉnh qua form thông tin tài khoản.

Không bỏ thành viên/khóa nhóm/khóa nhân viên còn phiếu được giao chưa kết thúc, kể cả phiếu giải quyết chờ khách đóng. Quản lý điều phối có kiểm tra stale/transaction và lịch sử; đưa về hàng đợi đặt MOI, không nhân đôi phiếu. Chuyển nhóm/người và đổi ưu tiên giữ nguyên hạn SLA.

SLA theo mức ưu tiên trong schema hiện có; thời gian liên tục 24/7, phút dương, xử lý không ngắn hơn phản hồi. Chính sách hiệu lực tự áp cho phiếu mới; phiếu cũ chỉ đổi hạn khi Quản lý áp/tính lại và xác nhận. Chính sách đã dùng chỉ bật/tắt, tạo phiên bản mới để đổi thời lượng. Không có lịch làm việc/ngày nghỉ, cấu hình theo loại hoặc cảnh báo nền. Báo cáo địa phương chưa hỗ trợ vì thiếu dữ liệu; số liệu gom theo trạng thái/nhóm/người phụ trách hiện tại, không quy công lịch sử. UI ghi rõ định nghĩa và null khi thiếu dữ liệu.

Audit quản lý mặc định tại `storage/audit/manager.jsonl`, không public/Git; chỉ thời gian/actor/action/target ID, không mật khẩu/hash/email. Tùy chọn `MANAGER_AUDIT_DIR` tương đối Backend root. Không phải audit tập trung chống chỉnh sửa hoặc outbox bảo đảm giao nhận; lỗi ghi file được log sau commit. Không cần biến secret mới.

Lệnh chạy Windows ở đầu README giữ nguyên. Đăng nhập Quản lý đã được cấp → tạo Nhân viên → thêm nhóm → kiểm tra/lưu routing → cấu hình SLA → khách đăng ký/tạo phiếu → nhân viên Tiếp nhận → quản lý điều phối khi cần → nhân viên giải quyết → khách đóng/đánh giá → xem báo cáo. Nếu chưa có Quản lý, người dùng chủ động chạy helper hiện có `.\.venv\Scripts\python.exe -X utf8 scripts/create_manager.py --execute`, nhập thông tin/mật khẩu riêng; agent không tự tạo tài khoản/default seed. Các tài khoản/thành viên/SLA trong test đã được dọn; chưa ghi cấu hình sử dụng mới ở Giai đoạn 4.

```powershell
# Từ thư mục gốc; không chạy đồng thời các bộ --browser dùng 8001/5174
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase4.py --execute --stage E --browser
# Kết nối PostgreSQL độc lập: fixture riêng commit rồi cleanup đúng ID
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase4_race.py --execute
```

Không có migration. Giữ 20 bảng/33 FK, 4 nhóm/8 ánh xạ đã duyệt, API và giao diện Giai đoạn 1–3. Chưa có reset/đổi mật khẩu/email xác minh, lọc địa phương, export file, cảnh báo SLA nền, workflow trạng thái động, chatbot hoặc module ERP/CRM.


Kết quả Giai đoạn 4: A–F PASS; 17 unit, 22 browser desktop/mobile, PostgreSQL integration/race và build PASS. Health xác nhận 20 bảng/33 FK. Sau dọn fixture, CSDL vẫn có 4 nhóm/8 ánh xạ, chưa có hồ sơ Quản lý/Nhân viên sử dụng, thành viên hoặc SLA. Cần người dùng chủ động tạo Quản lý ban đầu bằng helper trên, sau đó thao tác các màn hình quản lý; không có account/password mặc định.
## Cải tiến UX sau Giai đoạn 4

- Hội thoại riêng cho từng phiếu: bong bóng tin nhắn, người gửi/thời gian, sự kiện tiếp nhận/phân công thật, xem tin cũ và tệp công khai. Nhân viên chuyển giữa hai tab trao đổi/ghi chú nội bộ; Khách hàng không được nhận ghi chú qua API. Enter gửi, Shift+Enter xuống dòng; chặn nhấn gửi liên tiếp, ghép tin theo ID, không tự gửi lại khi mất kết nối.
- Cập nhật sau mỗi 5 giây khi phiếu còn tương tác và tab hiển thị/online; tuần tự hóa request, hủy khi rời màn hình/ẩn tab. Khi đang đọc tin cũ, giữ vị trí và hiện nút đến tin mới. Phiếu đã giải quyết/đóng chỉ đọc; dùng nút làm mới để kiểm tra thay đổi ngoài màn hình sau khi dừng polling.
- Tệp giữ tên gốc, dung lượng, xem trước PNG/JPEG qua API có xác thực và nút tải xuống. Tệp cũ chỉ còn khóa ngẫu nhiên được hiển thị tên trung tính, không thể khôi phục tên gốc nếu metadata đã mất. Không sửa metadata/storage cũ, không xem trước PDF/TXT/HTML. Tệp trên phiếu là công khai với người có quyền, không đính kèm riêng vào ghi chú nội bộ.
- Sidebar bỏ Về trang chủ, logo về dashboard đúng vai trò; Đăng xuất ở cuối. Chọn Sáng/Tối/Theo hệ thống trong sidebar hoặc header công khai. Chỉ lưu khóa `helpdesk-theme` trong localStorage; token vẫn ở cookie HttpOnly. Script đầu trang áp theme trước khi tải React/CSS để tránh nhấp nháy.
- SLA vẫn theo mức ưu tiên: gợi ý cách đặt tên, quy đổi phút sang giờ/ngày, kiểm tra giải quyết ≥ phản hồi ngay trên form và giữ validation Backend. Không tự tạo chính sách hoặc tính lại hạn phiếu cũ.

API bổ sung, giữ API cũ: `GET /api/v1/{customer|staff|manager}/tickets/{id}/conversation` hỗ trợ một trong hai cursor `after`/`before`, tối đa 100 tin/lần; `GET .../attachments/{attachment_id}/preview` chỉ ảnh đã kiểm tra. Mỗi role dùng kiểm tra quyền hiện có; customer khác chủ nhận 404; không trả đường dẫn đĩa hoặc nội dung ghi chú nội bộ. Lịch sử chat vẫn dùng `tin_nhan`, `lich_su_trang_thai`, `lich_su_phan_cong`; không migration, seed hoặc kết nối mạng xã hội.

Lệnh Windows PowerShell, từ thư mục gốc (không chạy hai harness browser cùng lúc):

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
# Terminal khác
Set-Location frontend
npm.cmd run dev
# Build
npm.cmd run build
# Trở về thư mục gốc; fixture thật rollback, backend8001/Vite5174 tạm
Set-Location ..
.\.venv\Scripts\python.exe -X utf8 scripts/test_ux.py --execute --stage E --browser
```

Chi tiết kiểm thử và giới hạn: [UX_TEST_RESULTS.md](docs/UX_TEST_RESULTS.md). Không có biến môi trường mới.
## Giai đoạn 5 — Trợ lý AI Gemini + FAQ

Widget **Trợ lý AI Helpdesk** chỉ có trong không gian Khách hàng (nút góc dưới phải); không sửa hội thoại khách–nhân viên, sidebar hoặc quy trình Phương án A. Khách hỏi FAQ, xem phiên/lịch sử của chính mình, chủ động đồng ý lập bản nháp, chỉnh sửa/hủy và **Xác nhận tạo phiếu**. Phiếu dùng cùng service tạo phiếu hiện tại: MOI, chủ từ cookie, ưu tiên mặc định, SLA hiện có và chờ nhân viên Tiếp nhận. Chatbot không tra cứu đơn hàng/tồn kho, quyết định bảo hành/hoàn tiền hoặc tự phân công.

### Cấu hình và chạy trên Windows PowerShell

Từ thư mục Backend hiện tại:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
# Chỉ SDK nếu các dependency khác đã cài:
.\.venv\Scripts\python.exe -m pip install "google-genai==1.75.0"
# Người dùng tự chỉnh .env, thêm GEMINI_KEY và GEMINI_MODEL theo .env.example.
# Không dùng VITE_..., GOOGLE_API_KEY hoặc model mặc định.
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

Terminal khác, từ thư mục gốc:

```powershell
Set-Location frontend
npm.cmd install
npm.cmd run dev
# Kiểm tra build
npm.cmd run build
```

Không có secret mới ở frontend. `core/database.py` vẫn đọc `.env` tại Backend root bằng load_dotenv; agent không sửa `.env` thật. GEMINI_KEY/GEMINI_MODEL thiếu chỉ khiến thao tác AI trả503; login, phiên/lịch sử và Helpdesk vẫn chạy. Không tự chọn model. Model do bạn cấu hình cần hỗ trợ Gemini Developer API và JSON Structured Outputs; cấu hình/model không phù hợp trả thông báo rõ, không đổi sang câu trả lời giả. Phiên bản đã kiểm tra: Python3.13, Pydantic2.14.1, google-genai1.75.0. SDK yêu cầu websockets<17; requirements đổi pin từ17.3 xuống16.1.1, `pip check` PASS. Không thêm WebSocket/chat mạng xã hội.

Sau khi đăng nhập Khách hàng: mở widget → Phiên chat mới → hỏi bảo hành sofa → chọn Đồng ý lập bản nháp → bổ sung thông tin khi cần → Chỉnh sửa tiêu đề/mô tả/loại thật → Xác nhận → mở liên kết #HT-ID. Hủy chỉ hủy bản nháp, không tạo/xóa phiếu. Mỗi phiên tối đa một phiếu; để lập yêu cầu khác, tạo phiên mới. Khi mạng lỗi, tải lại lịch sử trước khi gửi/xác nhận lại. Tệp bổ sung qua chi tiết phiếu hiện có với kiểm tra quyền/MIME/dung lượng, không gửi tệp tới Gemini.

### API và dữ liệu

Prefix `/api/v1/customer/chatbot`, xem Swagger `/docs`:

| Method/path | Chức năng | Bảng |
| --- | --- | --- |
| GET /sessions?page=1 | 20 phiên/trang, chỉ chủ sở hữu | phien_chat |
| POST /sessions | Tạo phiên của khách hiện tại | phien_chat |
| GET /sessions/{id}?before=... | 50 tin mới nhất; tải tiếp tin cũ | phien_chat, tin_nhan_chatbot |
| POST /sessions/{id}/messages | Câu hỏi `{content}`; FAQ → Gemini → kiểm tra JSON → lưu cặp KHACH/BOT nguyên tử | cau_hoi_mau, tin_nhan_chatbot |
| POST /sessions/{id}/draft | Đồng ý lập nháp/thu thập; không tạo phiếu | tin_nhan_chatbot |
| POST /sessions/{id}/draft/cancel | Hủy nháp và ngừng thu thập | tin_nhan_chatbot |
| POST /sessions/{id}/confirm | `{draft_message_id,title,description,type_id,confirmed:true}` | phien_chat + service phieu_ho_tro/history/SLA hiện có |

Tất cả mutation dùng auth/role/Origin/CSRF hiện có; BIGINT ID trả dạng chuỗi. Khách khác phiên404; staff/manager403. Chatbot khác chat nhân viên: không đọc `tin_nhan` hoặc ghi chú nội bộ. Không có quyền SQL/tool/function cho Gemini. Bản nháp/lifecycle lưu JSON envelope có phiên bản trong nội dung BOT hiện hữu; API hiển thị trường rõ ràng, không lộ metadata fingerprint. Không thêm bảng/cột/enum hoặc migration.

Xác nhận khóa dòng phien_chat NOWAIT, xác minh bản nháp mới nhất, gọi `create_ticket_in_transaction` được tách tối thiểu từ service cũ, ghi liên kết phieu_ma + dấu vân tay request + tin xác nhận trong **cùng transaction**. Request đồng thời409; retry cùng bản nháp/nội dung trả đúng phiếu đã tạo, khác nội dung409. Có hiệu lực qua restart/nhiều worker vì dựa vào dữ liệu/lock PostgreSQL, không cache RAM. Đây là idempotency theo **một phiên/một phiếu**, không phải chống trùng giữa các phiên khác nhau hoặc form tạo phiếu truyền thống. Phiên đã gửi chỉ đọc; không mất dấu xác nhận do gửi thêm tin.

FAQ ban đầu truy xuất tối đa500 mục active, chuẩn hóa dấu/chữ, xếp overlap câu hỏi/từ khóa/câu trả lời; chỉ gửi tối đa4 mục liên quan, mỗi câu trả lời1800 ký tự, và8 tin gần nhất (1500 ký tự/tin). Không vector DB/embedding/migration. Các chính sách CHƯA CHỐT vẫn chưa xác nhận; không biến ví dụ thành cam kết. Không có tích hợp catalog/đơn hàng thật. Chỉ chia sẻ câu hỏi, ngữ cảnh rút gọn, FAQ và danh mục ID/tên loại; không gửi ID/email khách, JWT, CSRF, cookie, ghi chú hoặc dữ liệu khách khác. Lọc chuỗi secret rõ ràng và che email/chuỗi số liên hệ trước khi gửi; UI nhắc không cung cấp thông tin nhạy cảm và thông báo dữ liệu chuyển đến Google Gemini.

Timeout20giây, một lần gọi SDK (không tự retry trả lời giả), output tối đa2200token; API giới hạn input2000ký tự. Tạo phiên5/phút và40/giờ/khách, gọi AI8/phút và60/giờ/khách, limiter per-process tối đa4096 khóa; gateway/shared limiter cần có khi triển khai nhiều worker. Gọi AI giữ transaction/dòng phiên tối đa timeout để đảm bảo thứ tự/lưu cặp nguyên tử; phiên đang xử lý trả409. Chưa có worker job/stream, policy lưu trữ/xóa hội thoại, read receipt hoặc gửi ảnh cho AI.

### FAQ đã được duyệt và seed

Đã đối chiếu metadata thực tế ba bảng, ban đầu FAQ=0. Theo phê duyệt người dùng ngày22/10/2026, đã chạy `scripts/seed_phase5_faq.py --apply --approved`: thêm30 FAQ, giữ nguyên mọi mục hiện có, transaction + table lock tránh trùng giữa các lần seed. Chạy preview lại cho0 mục. Không cần seed lại để dùng hệ thống. Các đầu tài liệu còn ghi bản nháp; xác nhận mới của người dùng duyệt bộ FAQ làm nguồn tri thức, **không** chốt POL01–POL08 hoặc các điều kiện thương mại còn thiếu.

```powershell
# Xem trước, không ghi CSDL
.\.venv\Scripts\python.exe -X utf8 scripts/seed_phase5_faq.py
# Chỉ khi có duyệt bổ sung rõ ràng
.\.venv\Scripts\python.exe -X utf8 scripts/seed_phase5_faq.py --apply --approved
```

### Kiểm thử

```powershell
# Chỉ mock nhà cung cấp Gemini; API/SQL/hash/CSRF/giao diện dùng thật, fixture rollback
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase5.py --execute --browser
# Race: hai kết nối độc lập; commit fixture riêng rồi dọn đúng ID
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase5_race.py --execute
.\.venv\Scripts\python.exe -X utf8 -m unittest discover -s tests -v
```

Không chạy hai harness browser cùng lúc (port8001/5174). Không có cuộc gọi Gemini thật trong automated tests. Kết quả/hạn chế, file thay đổi và kiểm thử chưa chạy: [PHASE5_TEST_RESULTS.md](docs/PHASE5_TEST_RESULTS.md). Nguồn tích hợp SDK: [Google Gen AI Python SDK](https://googleapis.github.io/python-genai/).

### Khắc phục Gemini503 do schema

Đã xác nhận và sửa lỗi Google400 `additional_properties` từ SDK1.75.0: chỉ bỏ keyword này khỏi schema gửi đi; Pydantic phía server vẫn `extra="forbid"`. Log lỗi Google được lọc, không đưa debug/key/prompt/PII về Frontend. Không đổi model/key hoặc `.env`.

Bài thử live dùng đúng cấu hình chatbot (chỉ chạy chủ động, có thể dùng quota):

```powershell
.\.venv\Scripts\python.exe -X utf8 scripts/test_gemini_structured_live.py --execute
```

Unit mặc định vẫn `python -m unittest discover -s tests -v`, dùng mock, không gọi API thật. File unit đổi tên thành `tests/test_gemini_adapter.py` để tránh nhập nhầm script `test_gemini.py` ở thư mục gốc. Chi tiết, kết quả và cách thử lại UI: [GEMINI_503_DEBUG.md](docs/GEMINI_503_DEBUG.md).

### Không tiếp nhận và email cho khách hàng

Áp dụng [migration 001](docs/migrations/001_staff_request_snapshot.sql) nếu chưa có, rồi mở [migration 002](docs/migrations/002_request_rejection_and_email.sql) trong DBeaver với kết nối DB_HELPDESK và chạy toàn bộ script. Migration 002 bổ sung loại kết thúc và bảng hàng chờ email. Yêu cầu không tiếp nhận dùng trạng thái kết thúc DA_HUY với mã TU_CHOI_YEU_CAU, không thuộc tập phiếu hỗ trợ đã hoàn tất.

Backend đọc `MAIL_SERVER`, `MAIL_PORT`, `MAIL_FROM`, `MAIL_FROM_NAME`, `MAIL_USERNAME` và `MAIL_PASSWORD` khi cả `SMTP_HOST` và `SMTP_FROM` để trống. Nếu một trong hai biến SMTP này có giá trị, worker chỉ đọc bộ `SMTP_*`. Cổng 587 dùng STARTTLS. Cờ `MAIL_STARTTLS` hoặc `SMTP_USE_TLS` mặc định là `true`. Với Gmail, dùng địa chỉ người gửi được phép bởi tài khoản xác thực. Đặt `EMAIL_FRONTEND_URL` thành URL HTTP(S) của frontend nếu muốn có link xem phiếu. Khởi động lại Backend sau khi sửa cấu hình. Dùng SMTP thử nghiệm và tài khoản nhận thử để xác minh bốn sự kiện.

Hàng chờ có khóa duy nhất theo mã phiếu và sự kiện. `pending` là đang chờ hoặc chờ thử lại, `sent` là SMTP đã nhận, `failed` là gửi thất bại và `uncertain` là chưa rõ máy chủ có nhận hay không. Worker tự thử lại tối đa ba lần với lỗi kết nối hoặc lỗi SMTP từ chối rõ ràng. Lỗi xác thực ghi `smtp_authentication_failed` và đánh dấu thư `failed`. Trạng thái `uncertain` hoặc `sending` tồn đọng cần đối chiếu nhật ký SMTP trước khi gửi lại để tránh thư trùng. Nhật ký ghi loại lỗi, mã phiếu, sự kiện và trạng thái gửi.

### Tin nhắn chưa đọc và trao đổi nội bộ

Áp dụng [migration 003](docs/migrations/003_staff_message_read.sql) trong DBeaver trên DB_HELPDESK để bật đếm tin chưa đọc. Migration tạo bảng dấu đọc theo nhân viên và tin nhắn. Các tin công khai cũ do chủ phiếu gửi bắt đầu ở trạng thái chưa đọc khi chưa có dấu đọc. Trước khi áp dụng, danh sách và hội thoại vẫn mở được, phần đếm và ghi dấu đọc chưa hoạt động.

Phiếu của tôi gửi `scope=mine&page_size=5&sort=newest|oldest`. Backend sắp theo ngày tạo rồi mã phiếu trước khi phân trang. Danh sách tái kiểm tra khi quay lại tab hoặc mỗi 30 giây khi đang hiển thị. Dấu đọc được ghi khi tin công khai của khách xuất hiện trong vùng nhìn thấy của hội thoại trên tab đang mở.

Quản lý có thể gửi tin qua tab Trao đổi với Nhân viên trên phiếu đang xử lý hoặc tạm dừng và có nhân viên phụ trách hợp lệ. Kênh công khai của Quản lý ở chế độ chỉ đọc.

### Khóa tài khoản và nhóm duy nhất của nhân viên

Chạy [migration 004](docs/migrations/004_account_lock_event.sql) trên DB_HELPDESK để bật khóa tài khoản kèm lý do. Sự kiện khóa/mở khóa lưu cùng giao dịch thay đổi tài khoản. Chỉ người nhập đúng mật khẩu mới thấy lý do khóa khi đăng nhập.

API chặn tạo liên kết nhóm thứ hai. Nếu phát hiện dữ liệu cũ trùng nhóm, mở Nhóm hỗ trợ → Chỉnh sửa nhóm → Chuyển nhóm, chọn nhóm duy nhất và xác nhận. Nếu nhóm sẽ bỏ còn phiếu được giao chưa kết thúc, Quản lý phải điều phối phiếu trước. Chạy [migration 005](docs/migrations/005_one_group_per_employee.sql) sau khi xử lý hết liên kết trùng để PostgreSQL bảo vệ thêm bằng chỉ mục duy nhất. Script dừng nếu vẫn còn trùng.

Bộ lọc SLA trên Giám sát phiếu xét hạn xử lý và hạn phản hồi khi chưa phản hồi lần đầu. Mốc gần nhất đã qua là quá hạn, mốc còn trong 60 phút là sắp đến hạn. Phiếu có chính sách đã giải quyết/đóng/hủy thuộc Đã kết thúc theo dõi. Báo cáo lịch sử SLA vẫn dùng các mốc thực tế.
