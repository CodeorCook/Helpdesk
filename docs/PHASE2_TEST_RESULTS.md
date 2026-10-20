# Kết quả kiểm thử Giai đoạn 2 — Nghiệp vụ Khách hàng

Ngày thực hiện: 20/10/2026 (giờ Việt Nam). Không chạy lại SQL khởi tạo, không migration, không sửa schema/role hay seed dữ liệu sử dụng. CSDL hiện có: DB_HELPDESK, schema helpdesk, 20 bảng. Health và cột của các bảng đang triển khai được đọc nhanh; không điều tra lại hiển thị DBeaver.

## Phương thức và bảo toàn dữ liệu

`scripts/test_phase2.py --execute --stage A/B/C/D/E` kiểm thử API FastAPI + SQL PostgreSQL + Argon2id thật. Connection factory được gắn vào một transaction rollback; không mock kết quả truy vấn, login hoặc register. Lỗi ở bước tạo hồ sơ/ghi lịch sử/ghi metadata được cố ý chèn để kiểm tra tính nguyên tử và cleanup. Các request đồng thời của browser được tuần tự trong harness để không lồng savepoint sai thứ tự; backend thông thường vẫn dùng kết nối riêng theo request.

Tài khoản, bảng phụ, phiếu, tin nhắn, lịch sử, metadata và đánh giá thử đều rollback. So sánh tổng số bản ghi trước/sau trên 9 bảng liên quan và kiểm tra email thử không còn. File nằm trong TemporaryDirectory, tự dọn khi kết thúc. PostgreSQL identity sequence có thể tăng. Không sửa/xóa dữ liệu tài khoản sử dụng và không khôi phục sequence bằng thao tác nguy hiểm.

`--browser` mở backend tạm 8001 và Vite 5174, chạy Playwright Chromium desktop 1280×720 và mobile iPhone 13 390×664 (emulation). Browser tự đăng ký qua /register và dùng API thật. Credentials ngẫu nhiên chỉ ở bộ nhớ/process env; không in password/hash/JWT, không ghi video/trace chứa credentials. Các phiếu DA_GIAI_QUYET được tạo bằng SQL fixture trong transaction riêng của harness, không có giao diện/API nhân viên giả.

## Kết quả theo mốc

| Mốc | Trạng thái | Các ca đã kiểm tra |
| --- | --- | --- |
| A — Đăng ký | PASS | Đăng ký 201, không tự cấp cookie; login thật và /me customer; hash Argon2id; cặp nguoi_dung/khach_hang; email trùng khác hoa/thường 409; thiếu trường, email/điện thoại sai, mật khẩu yếu, xác nhận sai 422; chèn QUAN_TRI_VIEN/NHAN_VIEN/role/ID bị từ chối; không Origin/Origin lạ 403; lỗi tạo bảng phụ rollback tài khoản; giới hạn 5 lần/phút trả 429 |
| B — Tạo phiếu | PASS | Danh mục thật; chủ phiếu từ phiên, nguồn KHACH_HANG, MOI; ưu tiên mặc định; lịch sử khởi tạo; ID khách do client gửi bị từ chối; loại không tồn tại 422; thiếu CSRF 403; lỗi ghi lịch sử rollback phiếu |
| C — Tra cứu/chi tiết | PASS | Hai khách A/B chỉ thấy dữ liệu của mình; đọc chéo chi tiết 404 cả hai chiều; tổng quan đếm đúng; tìm theo tiêu đề/loại/trạng thái; khoảng ngày ngược 422; phân trang/trang rỗng; chuỗi SQL injection không vượt điều kiện sở hữu; không lộ hash/đường dẫn |
| D — Trao đổi/tệp | PASS | Tin nhắn công khai, nội bộ bị lọc; thiếu CSRF 403; khách khác gửi/đọc tệp 404; upload/download TXT/PNG/PDF thật; Content-Disposition attachment; chặn exe, ảnh giả, traversal tên tệp; giới hạn file và body streaming 413; lỗi metadata dọn file và rollback |
| E — Hồ sơ/đóng/đánh giá | PASS | PATCH đúng whitelist, /me cập nhật tên thật; role/email/null name/trường lạ bị từ chối; CSRF; thiếu hồ sơ Khách hàng 1–1 trả 409; đóng MOI sai trạng thái 409; đóng DA_GIAI_QUYET sang DA_DONG, ngày đóng và lịch sử nguyên tử; lỗi lịch sử không đóng một nửa; GET đóng bị từ chối; khách khác đóng/đánh giá 404; cấm tin/tệp sau giải quyết/kết thúc; sao ngoài 1–5 bị từ chối; một đánh giá/phiếu 409 lần hai; chủ đánh giá khớp chủ phiếu; staff/manager không truy cập được API customer |
| Rollback | PASS | Các harness đã chạy kết thúc sạch, số bản ghi liên quan trước/sau bằng nhau; không còn tài khoản thử; thư mục tệp tạm được dọn |

Mỗi mốc đã chạy kiểm thử trước khi triển khai mốc kế tiếp. Sau đó chạy lại nhóm A→E với các ca bảo mật bổ sung; đây không phải tuyên bố mọi trường hợp tải lớn hoặc lỗi hạ tầng đã được thử.

## Giao diện và regression

| Kiểm tra | Kết quả thực tế |
| --- | --- |
| `npm run build` | PASS — TypeScript + Vite build thành công, font Inter/Vietnamese nằm trong bundle cục bộ |
| `scripts/test_phase2.py --execute --stage E --browser` | PASS — 4 test dài (2 luồng × desktop/mobile) |
| Smoke luồng Khách hàng | PASS — link login/register, đăng ký thật, chuyển về login, tạo phiếu kèm file, reload rồi lấy CSRF mới, gửi tin, download, lọc danh sách, profile với thông báo thành công, route trái quyền và logout; tạo phiếu với ảnh giả báo rõ lỗi tệp, giữ phiếu đã lưu và không tạo trùng |
| Smoke đóng/đánh giá | PASS — tài khoản fixture thật, xác nhận đóng, đánh giá và hiển thị đánh giá đã gửi; không còn nút gửi lần hai |
| Regression API Giai đoạn 1 | PASS — 13 unittest API/bảo mật, không thay bằng kết quả giả lập UI |
| Regression DB + UI ba vai trò | PASS — 6 test, ba vai trò × desktop/mobile; giữ khung staff/manager, kiểm tra 403, chặn staff/manager vào /support/new, logout |
| Regression công khai | PASS — 6 test Trang chủ, FAQ, login thật sai mật khẩu/tài khoản, menu mobile, 404, các route con customer không xác thực |
| Health/Swagger/frontend thật | PASS — localhost:8000/health/db trả 200, đúng helpdesk/20 bảng/33 khóa ngoại; /docs 200; localhost:5173/register 200 |
| Render | PASS — đã xem ảnh chi tiết desktop, tổng quan mobile; không tràn ngang toàn trang; bảng mobile dùng dạng card, bộ chọn file có nhãn tiếng Việt |
| Python/whitespace | PASS — compileall, pip check không có dependency hỏng, git diff --check không báo lỗi |
| CORS/PATCH/body limit | PASS — preflight PATCH cho origin được cấu hình; JSON quá lớn trả 413 và vẫn có CORS header đúng |
| Swagger/secret | PASS — OpenAPI hiển thị ô header X-CSRF-Token ở mutation; password là writeOnly và không xuất hiện trong repr của model |

Tổng: 13 test API cô lập hồi quy + nhóm kiểm thử PostgreSQL A→E + 16 test trình duyệt (4 phase 2, 6 ba vai trò, 6 công khai). Không đếm các lần chạy lại thành test mới.

## Lỗi gặp và sửa trong quá trình kiểm thử

- Khi chuyển sang EmailStr, địa chỉ fixture dùng domain `.invalid` bị validator email từ chối. Đã đổi fixture đăng ký sang địa chỉ ngẫu nhiên tại example.com; không gửi email ra ngoài. Không hạ validation để làm test PASS.
- Harness browser ban đầu thiếu biến truyền password tại một lời gọi; đã sửa harness, chạy lại. Các lần lỗi vẫn rollback dữ liệu.
- Đã cập nhật regression CTA Khách hàng từ placeholder sang form tạo phiếu thật, đúng thay đổi Giai đoạn 2. Test khung staff/manager và cơ chế xác thực vẫn giữ.
- Công cụ browser tích hợp ở phiên trước lỗi khởi tạo; giao diện được kiểm thử bằng Chromium headless của dự án và xem ảnh render. Starlette có cảnh báo httpx TestClient deprecated, nhưng test vẫn thực thi thành công.

## CHƯA CHẠY và giới hạn

- CHƯA CHẠY: tải lớn/nhiều worker, stress đồng thời đăng ký cùng email hoặc đóng/đánh giá cùng phiếu. Mã dùng UNIQUE trong DB, khóa dòng phiếu và transaction; hiện đã kiểm tra xung đột tuần tự và rollback, chưa coi đó là stress test.
- CHƯA CHẠY: lỗi mất điện/process bị kill giữa ghi file và commit DB, lỗi ổ đĩa đầy hoặc disconnect thật khi commit. Đã chèn lỗi metadata/lịch sử để kiểm tra cleanup, chưa có tác vụ nền đối soát file mồ côi do crash.
- CHƯA CHẠY: Safari/Firefox, điện thoại vật lý, HTTPS/reverse proxy production. Mobile hiện là emulation Chromium.
- Không có quét mã độc, xác minh email/đổi email/mật khẩu, thông báo chưa đọc, chatbot, nghiệp vụ staff/manager, SLA tự động hoặc báo cáo trong phase này.
- File PDF/ảnh được kiểm tra cấu trúc và luôn tải như attachment. Chưa tuyên bố đã quét an toàn nội dung bằng antivirus.
- Đăng xuất kế thừa JWT stateless: xóa cookie client; bản sao JWT đã lấy trước đó vẫn hợp lệ đến expiry. Rate limit hiện trong một process.

Mâu thuẫn thiết kế được xử lý trong phạm vi: số unread/thông báo mẫu không có trường theo dõi đọc trong schema nên không hiển thị số giả; không cho Khách hàng chọn ưu tiên; không thêm cột/bảng để mô phỏng các chức năng ngoài use case.
