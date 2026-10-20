# Giai đoạn 4 — Quản lý Helpdesk công ty nội thất

Ngày thực hiện: 20/10/2026 (giờ Việt Nam). Đọc README, báo cáo/cấu hình Giai đoạn 3, Usecase_quanly.png và schema thật có liên quan trước khi triển khai. Code theo A → B → C → D → E, smoke PostgreSQL sau từng mốc; tới F mới chạy build, các bộ hồi quy và browser/race.

## Phạm vi và nguyên tắc

Giữ nguyên PostgreSQL DB_HELPDESK/schema helpdesk, 20 bảng/33 FK, mã vai trò KHACH_HANG/NHAN_VIEN/QUAN_TRI_VIEN. UI hiển thị Khách hàng/Nhân viên hỗ trợ/Quản lý. Không migration, không chạy SQL khởi tạo, DROP/TRUNCATE hoặc reset sequence. Không xóa tài khoản/phiếu sử dụng, không seed tài khoản demo/mật khẩu mặc định. Bốn nhóm và tám ánh xạ đã duyệt giữ nguyên nếu người dùng chưa chủ động lưu thay đổi.

Phương án A tiếp tục: đề xuất chỉ là nhãn/thứ tự. Nhân viên phải bấm Tiếp nhận. Riêng Quản lý có thể **chủ động xác nhận** giao trực tiếp, đổi nhóm/người nhận hoặc đưa về hàng đợi; đây không phải giao tự động.

Mọi API manager yêu cầu role manager và hồ sơ quan_tri_vien hoạt động. Mọi mutation có Origin/CSRF như Giai đoạn 1–3, SQL tham số hóa và transaction. ID BIGINT được trả thành chuỗi, không ép ID qua số JavaScript. Không trả hash/password/JWT/storage path. API Khách hàng/Nhân viên vẫn tách quyền; không gọi API staff để lách quyền manager.

## A–F và kết quả chạy thực tế

| Mốc | Kết quả | Đã chạy |
| --- | --- | --- |
| A — Tài khoản/quyền | PASS | Tạo NHAN_VIEN + hồ sơ cùng transaction, Argon2id/login thật; email trùng không phân biệt hoa thường 409; role injection 422; lỗi hồ sơ rollback; khóa có hiệu lực từ request sau; tự khóa/đổi quyền bị chặn; stale 409; cấp/thu quyền xác nhận mật khẩu có hiệu lực ngay với phiên cũ; tài khoản đã có nghiệp vụ/nhóm không đổi role; giới hạn xác nhận 5 lần/phút |
| B — Nhóm/thành viên/routing | PASS | Dùng nhóm Bảo hành và bảo trì đã có; thành viên nhiều nhóm; mapping chỉ đổi khi lưu, stale 409; nhân viên/quản lý sai vai trò bị chặn; khách tạo bảo hành → đề xuất chưa giao → nhân viên nhận cùng ID; còn phiếu chưa kết thúc thì không bỏ thành viên/khóa nhóm/khóa nhân viên |
| C — Điều phối | PASS | Quản lý xem/lọc/chi tiết riêng; giao lại cùng/khác nhóm; nhóm/người đích hợp lệ; kết thúc phân công cũ trước khi thêm mới; stale/CSRF/quyền; lỗi INSERT phân công rollback; trả hàng đợi MOI rồi nhân viên nhận lại cùng ID; duy nhất một phân công hiệu lực |
| D — SLA | PASS | Một chính sách hoạt động/mức ưu tiên; validation phút dương và xử lý ≥ phản hồi; chính sách đã dùng chỉ bật/tắt; phiếu mới tự gắn hạn đúng từ ngay_tao; phiếu cũ không đổi ngầm; áp/tính lại có xác nhận; thiếu/trong/sắp/quá hạn; ghi chú nội bộ không đặt phản hồi đầu; tải tệp staff/manager thật |
| E — Hoạt động/báo cáo | PASS | Tổng/trạng thái/phân bổ/nhân viên được đối chiếu với fixture SQL; lọc, phân trang, SLA quá hạn; lịch sử trạng thái/phân công/kết thúc/trao đổi/tệp; bên ngoài role bị chặn; khách đóng/đánh giá một lần rồi quản lý thấy thống kê; phiếu đóng không điều phối/tính SLA lại |
| F — Tích hợp | PASS | 17 unit, 22 browser desktop/mobile, PostgreSQL A–E/races, hồi quy Giai đoạn 1–3, build và health/Swagger |

Các lệnh đã chạy:

- `scripts/test_phase4.py --execute --stage A`, sau đó B, C, D, E: API và PostgreSQL thật, smoke tăng dần. Không mock thành công nghiệp vụ.
- `scripts/test_phase4.py --execute --stage E --browser`: **2/2 PASS** Chromium desktop và iPhone 13 emulation. Qua UI thật: Quản lý tạo hai nhân viên → tạo hai nhóm/thành viên → lưu routing → tạo SLA → khách đăng ký/tạo phiếu → nhân viên nhận đề xuất, phân loại/ưu tiên, công khai/nội bộ/tệp → quản lý áp SLA có xác nhận/chuyển khác nhóm → người nhận giải quyết → khách đóng/đánh giá → quản lý xem báo cáo/khóa nhân viên đã hết việc. Khách truy cập UI/API báo cáo bị chặn. Không tràn ngang, không localStorage/JWT, không pageerror.
- `scripts/test_phase4_race.py --execute`: **PASS**, PostgreSQL connection độc lập và barrier hai request. Hai quản lý phân công cùng phiếu: 200/409, lịch sử cũ và một phân công hiệu lực. Bỏ thành viên vs tiếp nhận: hoặc bỏ trước và nhận bị từ chối, hoặc nhận trước và bỏ bị 409. Đổi role vs Khách/Nhân viên tạo phiếu: chỉ một nghiệp vụ hợp lệ hoàn tất. Hai quản lý khóa chéo: một thành công, actor đã khóa bị 401/403, vẫn còn một Quản lý fixture hoạt động.
- `python -m unittest discover -s tests -v`: **17/17 PASS** bộ xác thực/danh mục sẵn có.
- `scripts/test_auth_database.py --execute --browser`: **PASS API + 6/6 browser**, login/me/logout, sai mật khẩu/không tồn tại/khóa/phiên hết hạn và ba role desktop/mobile. Harness đã gắn thêm manager connection để dashboard đọc đúng fixture.
- `scripts/test_phase2.py --execute --stage E --browser`: **PASS API A–E + 6/6 browser**, đăng ký/phiếu/tệp/hồ sơ/đóng/đánh giá và ngữ cảnh nội thất. Test lại sau khóa hồ sơ trong transaction.
- `scripts/test_phase3.py --execute --stage E --browser`: **PASS API A–E + 2/2 browser**, đề xuất/tiếp nhận/chuyển/công khai/nội bộ/tệp/trạng thái/SLA. Sau chốt khóa vai trò vẫn PASS.
- `scripts/test_phase3_race.py --execute`: **PASS**, tiếp nhận 200/409 và chuyển 200/409, giữ lịch sử, cleanup đúng fixture.
- Build cuối: **PASS** npm run build (TypeScript + Vite). Smoke công khai: **6/6 PASS**, Trang chủ/FAQ/Đăng nhập/404/bảo vệ route desktop/mobile. Tổng cộng các bộ browser F: **22/22 PASS**. `git diff --check` PASS.

Các lỗi phát hiện và đã sửa, không tính các lần lỗi là PASS: hai cú pháp JSX mới; tên ưu tiên fixture vượt VARCHAR(40); selector browser trùng hai thông báo thành công. `Path` dùng chung đối tượng bị FastAPI giữ alias của tham số trước: thay bằng factory cho từng path parameter ở manager và staff; thêm download staff/manager thành công với ID thực để kiểm chứng. Rà soát race bổ sung khóa vai trò trong transaction và kiểm thử cạnh tranh độc lập như trên.

## Transaction, quyền và audit

Khóa tư vấn PostgreSQL transaction được dùng chung cho quản lý thay điều kiện tiếp nhận và staff mutation; thứ tự global lock → tài khoản/nhóm → phiếu. Không dùng mutex trong bộ nhớ để tuyên bố an toàn nhiều worker. Phiếu dùng khóa dòng và đọc lại quyền/trạng thái. Kiểm tra stale bằng phiên bản ngay_cap_nhat và ID phân công; group/SLA không có updated_at nên so sánh snapshot đầy đủ các trường chỉnh sửa. Index partial duy nhất phân công hiệu lực và SLA hoạt động được giữ nguyên.

Khách giữ shared lock tài khoản trong transaction và kiểm tra role/status lại; PATCH hồ sơ lấy update lock từ đầu để tránh deadlock nâng shared lock. Staff mutation lấy global lock trước shared lock tài khoản, rồi xác minh role/status/hồ sơ. Nhờ đó quản lý không đổi vai trò sau bước kiểm tra “chưa có nghiệp vụ” nhưng trước khi một phiếu đồng thời được ghi.

Không tự khóa/hạ quyền actor đang đăng nhập, không làm mất Quản lý hoạt động có hồ sơ hợp lệ cuối cùng. Chỉ đổi role tài khoản chưa có phiếu/người lập/phân công/tin/lịch sử/tệp/thành viên nhóm. Tạo bảng phụ cho role đích trong cùng transaction; không xóa hồ sơ vai trò cũ vì có thể là FK lịch sử. Mỗi tài khoản vẫn chỉ có một vai trò hiệu lực theo nguoi_dung.vai_tro. Public register vẫn chỉ KHACH_HANG. Cấp QUAN_TRI_VIEN yêu cầu mật khẩu của actor, checkbox và xác nhận UI; có rate limit 5/phút/actor trong process.

Không khóa nhân viên/bỏ thành viên/vô hiệu nhóm khi còn phiếu được giao có la_ket_thuc=false, gồm cả DA_GIAI_QUYET chờ khách đóng. Điều phối trước hoặc chờ khách đóng. Nhân viên vẫn chỉ chuyển trong nhóm. Quản lý chỉ điều phối MOI/DANG_XU_LY/TAM_DUNG; trả hàng đợi đặt MOI và ghi lịch sử trạng thái khi cần. Không mở đường tắt đóng/hủy thay khách.

Audit trạng thái/phân công lưu atomically trong bảng có sẵn. Các thao tác quản lý tài khoản/nhóm/routing/SLA/điều phối có audit file sau commit: mặc định `storage/audit/manager.jsonl`, không public và đã nằm ngoài Git. Chỉ ghi thời điểm, actor ID, hành động, target ID; không ghi password/hash/email/nội dung. Có thể cấu hình MANAGER_AUDIT_DIR (tương đối Backend root). Nếu ghi file lỗi, log `manager_audit_write_failed` để vận hành xử lý; không giả rằng transaction đã commit bị rollback. Đây không phải audit chống chỉnh sửa tập trung hoặc outbox giao nhận bảo đảm; chưa thêm bảng để mở rộng audit.

## SLA và định nghĩa báo cáo

Schema thực có SLA theo **mức ưu tiên**, không có ht_ma trên chinh_sach_sla: không dựng cấu hình SLA theo loại giả. Đơn vị phút nguyên dương; thời gian xử lý ≥ phản hồi. Một chính sách hiệu lực mỗi mức ưu tiên theo unique partial index hiện có.

Phiếu mới do khách hoặc nhân viên lập lấy chính sách hiệu lực theo mức ưu tiên tại thời điểm tạo và tính từ ngay_tao. Thời gian liên tục 24/7; chưa có giờ làm việc/ngày nghỉ. Không có chính sách thì để NULL và hiển thị “Chưa cấu hình SLA”. Đổi ưu tiên/chuyển nhóm/người không đổi deadline; thay chính sách cũng không tự sửa phiếu cũ. SLA đã được tham chiếu không sửa tên/ưu tiên/thời lượng: tắt bản cũ rồi tạo bản mới. PATCH active=false là vô hiệu hóa, không DELETE lịch sử.

Phiếu đang mở có thể được Quản lý áp chính sách đang hiệu lực theo ưu tiên hoặc tính lại có checkbox/xác nhận rõ, kèm kiểm tra stale. Hạn tính từ ngày tạo nên có thể quá hạn ngay khi áp muộn. Giữ nguyên ngay_phan_hoi_dau; chỉ phản hồi công khai đầu của nhân viên đặt mốc này. Không tính lại phiếu giải quyết/đóng/hủy. Ngưỡng sắp quá hạn ≤60 phút kế thừa Giai đoạn 3; cập nhật khi tải màn hình, không cron/push giả.

- Tổng phiếu = tất cả bản ghi phù hợp bộ lọc ngày tạo/trạng thái hiện tại; tổng có thể gồm DA_HUY nếu tồn tại. Đã đóng chỉ DA_DONG; đã giải quyết riêng DA_GIAI_QUYET.
- Nhóm = nhóm đã lưu, hoặc nhóm suy ra từ routing hiện hành khi phiếu chưa chốt nhóm. Đây là phân bổ hiện tại, không tái dựng nhóm lịch sử tại ngày tạo.
- Quá hạn = phiếu chưa giải quyết/kết thúc, có SLA thật và hạn xử lý đã qua hoặc chưa phản hồi công khai lần đầu mà hạn phản hồi đã qua. Không tính phiếu không cấu hình hoặc coi đây là tổng vi phạm lịch sử.
- Hiệu suất gom theo **người phụ trách hiện tại**, chỉ các nhân viên có phiếu phù hợp; không phân bổ công lao lịch sử. Có thể bao gồm phản hồi trước khi chuyển. Đúng hạn = số phiếu đã giải quyết không quá hạn xử lý / số phiếu đã giải quyết có hạn. Phản hồi trung bình = phút tạo → phản hồi đầu; đánh giá trung bình chỉ từ đánh giá thật. Thiếu dữ liệu trả null, UI “Chưa có”.
- `from/to` là khoảng ngày tạo phiếu theo Việt Nam (đầu ngày → hết ngày). Hoạt động có thêm `event_from/event_to` để lọc **thời điểm sự kiện**. Actor kết thúc phân công không được lưu trong schema, nên hiển thị “Không lưu người kết thúc”; không suy đoán actor cũ là người chuyển.
- Chưa có dữ liệu địa phương: UI ghi “Chưa hỗ trợ do thiếu dữ liệu”, không có filter giả. Có lọc trạng thái tài khoản khách từ nguoi_dung.trang_thai.

## Use Case → API → CSDL

Prefix `/api/v1/manager`, Swagger `/docs`. GET `/manager/dashboard` cũ giữ nguyên để tương thích; tổng quan nghiệp vụ là GET `/manager/overview`.

| Use Case | API | CSDL |
| --- | --- | --- |
| Tổng quan | GET /overview | phieu_ho_tro, trang_thai, loai_ho_tro, muc_do_uu_tien, nhóm/routing, nguoi_dung |
| Tìm/lọc/chi tiết tài khoản | GET /users; GET /users/{id} | nguoi_dung, quan_tri_vien |
| Tạo nhân viên | POST /users | nguoi_dung + nhan_vien cùng transaction |
| Khóa/mở/sửa họ tên/điện thoại | PATCH /users/{id} | nguoi_dung; kiểm tra phiếu/phân công |
| Phân quyền xác nhận mật khẩu | POST /users/{id}/role | nguoi_dung và bảng phụ đúng role; kiểm tra nghiệp vụ/nhóm/lịch sử |
| Danh sách/tạo/sửa/vô hiệu nhóm | GET/POST /groups; GET/PATCH /groups/{id} | nhom_ho_tro, thanh_vien_nhom, phieu_ho_tro |
| Thêm/bỏ thành viên | POST /groups/{id}/members; POST /groups/{id}/members/remove | thanh_vien_nhom, nhan_vien, nguoi_dung, phieu_ho_tro |
| Routing nội thất | GET /routing; PATCH /routing/{type_id} | xu_ly_mac_dinh, loai_ho_tro, nhom_ho_tro |
| Giám sát/chi tiết | GET /tickets; GET /tickets/{id} | phieu_ho_tro, tin_nhan, tep_dinh_kem, lịch sử, nguoi_dung |
| Danh mục/người nhận | GET /catalog/{types/statuses/priorities}; GET /groups/{id}/eligible-employees | danh mục, thành viên/nhân viên/nhóm |
| Phân công lại/chuyển nhóm/hàng đợi | POST /tickets/{id}/assignment | phieu_ho_tro, lich_su_phan_cong, lich_su_trang_thai |
| Tải tệp có quyền | GET /tickets/{id}/attachments/{attachment_id} | tep_dinh_kem, phieu_ho_tro, storage riêng |
| SLA danh sách/tạo/sửa/vô hiệu | GET/POST /sla; PATCH /sla/{id} | chinh_sach_sla, muc_do_uu_tien |
| Áp/tính SLA hiện hữu có xác nhận | POST /tickets/{id}/sla | phieu_ho_tro, chinh_sach_sla |
| Báo cáo phân trang | GET /reports | phiếu/trạng thái/nhóm/loại/ưu tiên/nhân viên/danh_gia |
| Lịch sử hoạt động phân trang | GET /activity | lich_su_trang_thai, lich_su_phan_cong, tin_nhan, tep_dinh_kem |

Filters phiếu/báo cáo/hoạt động: search (ID/#HT-ID/tiêu đề), type, status, priority, group, employee (ID người phụ trách hiện tại), customer_status, from, to, scope=all/waiting/unrouted, page, page_size. Mỗi trang tối đa 50 cho phiếu/báo cáo/hoạt động; nhóm/SLA tối đa 100. Trang quản lý có empty/loading/error/success, phân trang, xác nhận mutation và tiếng Việt.

Routes: `/manager`, `/manager/users`, `/manager/users/:id`, `/manager/groups`, `/manager/groups/:id`, `/manager/routing`, `/manager/tickets`, `/manager/tickets/:id`, `/manager/sla`, `/manager/reports`. Giữ palette teal/vàng/Inter và layout responsive hiện có, không thêm ERP/CRM.

## File thêm/sửa

Thêm Backend: `schemas/manager.py`, `services/manager_service.py`, `api/routes/manager.py`; `core/coordination.py`, `core/sla.py`, `core/audit.py`, `core/manager_limits.py`.

Sửa Backend: `main.py` đăng ký router và nhãn lỗi; `services/customer_service.py`, `services/staff_service.py` gắn SLA lúc tạo phiếu và khóa vai trò/eligibility phù hợp; `api/routes/staff.py` sửa factory Path. Không đổi API cũ, schema hoặc SQL khởi tạo.

Thêm Frontend: `src/manager/{api.ts,Layout.tsx,Overview.tsx,Users.tsx,Groups.tsx,Routing.tsx,Filters.tsx,Tickets.tsx,TicketDetail.tsx,SLA.tsx,TicketSLA.tsx,Reports.tsx}`; sửa `src/App.tsx` routes và component key theo ID.

Thêm test: `scripts/test_phase4.py`, `scripts/test_phase4_race.py`, `frontend/playwright.phase4.config.ts`, `frontend/phase4-tests/manager.spec.ts`. Sửa `scripts/test_auth_database.py` thêm manager connection vào fixture; củng cố `scripts/test_phase3_race.py` dừng cleanup nếu fixture bị dữ liệu ngoài tham chiếu. Cập nhật `.env.example` comment audit tùy chọn, README và báo cáo này.

## Cách chạy Windows và thử đúng thứ tự

```powershell
# Terminal Backend tại thư mục gốc dự án; giữ .env hiện có
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
# Terminal Frontend
cd frontend
npm ci
npm run dev
```

Frontend `http://localhost:5173`, Swagger `http://127.0.0.1:8000/docs`, health `/health/db`. Không cần biến bắt buộc mới; DB_PASSWORD/JWT_SECRET_KEY/CORS/cookie giữ cấu hình hiện có. MANAGER_AUDIT_DIR là tùy chọn, không chứa secret. Nếu chưa có tài khoản Quản lý, người dùng chủ động dùng helper `scripts/create_manager.py --execute` đang có, nhập thông tin/mật khẩu riêng qua prompt/env; agent không tự chạy hoặc seed. Không có mật khẩu mặc định/public đăng ký Quản lý.

Đăng nhập Quản lý → /manager/users tạo Nhân viên, bàn giao mật khẩu ban đầu qua kênh riêng được tổ chức chấp thuận → /manager/groups thêm thành viên → /manager/routing kiểm tra/lưu nếu cần → /manager/sla tạo chính sách theo ưu tiên. Khách đăng ký /register → tạo phiếu bảo hành sofa → nhân viên vào /staff/recommended hoặc /staff/queue và Tiếp nhận → xử lý/trao đổi/tệp. Quản lý dùng /manager/tickets/:id điều phối/áp SLA khi cần → nhân viên giải quyết → khách đóng/đánh giá → quản lý xem /manager/reports.

```powershell
# Tại thư mục Backend; không chạy đồng thời các bộ --browser dùng 8001/5174
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase4.py --execute --stage E --browser
# Fixture committed riêng phục vụ các connection độc lập; dọn chính xác ID
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase4_race.py --execute
.\.venv\Scripts\python.exe -X utf8 -m unittest discover -s tests -v
```

## Cô lập dữ liệu và giới hạn

Smoke/browser dùng transaction rollback, khóa RLock trong harness để một connection dùng chung không lồng savepoint sai thứ tự; không mock SQL/hash/login. Mức ưu tiên/nhóm/loại bổ sung chỉ là fixture rollback; không phải cấu hình sử dụng. Password ngẫu nhiên chỉ trong bộ nhớ/env; trace/video tắt; tệp/audit trong TemporaryDirectory. Đối chiếu số bản ghi tất cả bảng liên quan trước/sau bằng nhau. Identity có thể tăng, không reset.

Race dùng fixture tên ngẫu nhiên commit vì connection độc lập cần thấy nhau. Cleanup kiểm tra ID/name và dừng nếu phiếu ngoài fixture tham chiếu nhóm/loại/tài khoản thử; không để ON DELETE SET NULL tác động dữ liệu sử dụng. Dọn đúng ID, kiểm tra count trước/sau; không DELETE theo điều kiện rộng trên dữ liệu thật.

Chưa triển khai: bắt buộc đổi mật khẩu lần đầu, đổi/reset mật khẩu hoặc email có xác minh, gửi email, lịch làm việc/ngày nghỉ, SLA theo loại (schema không hỗ trợ), cảnh báo nền/push, báo cáo địa phương, export file, workflow trạng thái động, chatbot/ERP/CRM. Sơ đồ có xóa tài khoản: triển khai khóa thay cho xóa cứng theo yêu cầu bảo toàn dữ liệu. Chỉ dùng các chuyển trạng thái có kiểm soát đã chốt; không sửa mã/nhãn trạng thái danh mục.

CHƯA CHẠY: Firefox/WebKit, thiết bị iOS thật, production HTTPS, tải nhiều worker/lưu lượng lớn, sự cố hạ tầng giao nhận audit. Mobile là Chromium emulation. Rate limit xác nhận là per-process, không tuyên bố rate limit phân tán. Không tạo tài khoản/thành viên/SLA sử dụng sau test; việc tạo thật là thao tác của Quản lý được xác nhận trên UI.


## Trạng thái bàn giao đã kiểm tra cuối

`/` 200 giữ phản hồi cũ, `/docs` 200, `/health/db` 200 báo DB_HELPDESK/helpdesk, 20 bảng/33 FK. OpenAPI có 22 path dưới manager (bao gồm endpoint dashboard tương thích). Dữ liệu cấu hình sử dụng sau test: 4 nhóm, 8 ánh xạ; 0 hồ sơ Nhân viên, 0 thành viên, 0 chính sách SLA, 0 hồ sơ Quản lý. Chưa tự tạo Quản lý bootstrap hoặc dữ liệu demo; cần người dùng chủ động khởi tạo Quản lý bằng helper đã có, rồi dùng UI cấp nhân viên/cấu hình. Toàn bộ chức năng đã kiểm thử với fixture thật cô lập và đã dọn. Không còn test bắt buộc A–F chưa chạy; các môi trường/phần ngoài phạm vi chưa chạy được liệt kê ở mục giới hạn.
