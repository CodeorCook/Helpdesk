# Giai đoạn 3 — Nhân viên hỗ trợ, Phương án A

Kiểm thử ngày 20/10/2026 (Việt Nam). Giữ nguyên DB_HELPDESK/schema helpdesk, 20 bảng/33 FK và ba vai trò. Không migration, chạy lại SQL khởi tạo hoặc reset sequence.

## Quy tắc và khác biệt với tham chiếu

- Đề xuất chỉ sắp thứ tự/gắn nhãn, không giữ chỗ hoặc tạo phân công. Tiếp nhận cập nhật **cùng ID phiếu khách đã tạo**, MOI → DANG_XU_LY, thêm một phân công hiệu lực và lịch sử trạng thái trong một transaction.
- Nhóm là nhom_ma đã lưu; nếu thiếu thì suy ra từ xu_ly_mac_dinh. Không gán ngẫu nhiên. Chưa có nhóm hoạt động hoặc nhân viên đủ điều kiện: vẫn chờ, dashboard cảnh báo số lượng chờ điều phối; không tiết lộ chi tiết khách ngoài nhóm.
- Nhân viên phải có hồ sơ, tài khoản hoạt động, thuộc nhóm hoạt động. Workload = số phiếu đang giao có la_ket_thuc=false, loại trừ DA_GIAI_QUYET. Hòa nhau: lần phân công gần nhất cũ hơn trước (chưa từng phân công trước), rồi ID. Không suy đoán online/ca trực. Mọi nhân viên đủ điều kiện vẫn có thể tiếp nhận.
- Đọc phiếu: người phụ trách hoặc thành viên nhóm hoạt động. Ngoài phạm vi trả 404. Sửa/trao đổi/chuyển/giải quyết: chỉ người phụ trách có phân công hiệu lực và còn thuộc nhóm hoạt động. Khách/Quản lý bị chặn khỏi API staff; Quản lý có API riêng ở Giai đoạn 4.
- Lập thay khách: phiếu mới MOI, nguồn NHAN_VIEN, người lập thật; không tự giao. Người lập có thể thêm tệp vào phiếu MOI chưa giao do chính mình lập; không có quyền đọc ngoài nhóm chỉ vì là người lập. Phiếu thuộc nhóm khác/chưa cấu hình trả biên nhận, không chuyển tới trang chi tiết không đủ quyền.
- Đổi loại/ưu tiên giữ nhóm, người phụ trách và SLA hiện có. Trả cảnh báo nếu nhóm mặc định mới khác/thiếu. Chuyển trực tiếp chỉ trong cùng nhóm: khóa phiếu, kiểm tra assignment_id, kết thúc phân công cũ và thêm mới atomically. Chuyển khác nhóm chờ Quản lý.
- DANG_XU_LY ↔ TAM_DUNG; cả hai có thể → DA_GIAI_QUYET. Ghi ngay_giai_quyet; không đóng/hủy thay khách hoặc mở lại. Khách đóng DA_DONG và đánh giá một lần như Giai đoạn 2. Nhãn “Đóng/Hủy” của nhân viên trên sơ đồ không được mở thành đường tắt, theo quyết định nghiệp vụ của người dùng.
- Tin công khai đầu tiên ghi ngay_phan_hoi_dau; nội bộ không ghi mốc này. API khách vẫn chỉ trả công khai. Tệp kiểm nội dung/MIME/dung lượng, storage riêng, tên ngẫu nhiên, download theo quyền, cleanup khi metadata/transaction lỗi.
- SLA chỉ đọc chính sách/hạn đã lưu; không có cấu hình/hạn: “Chưa cấu hình SLA”. Trong hạn / sắp quá hạn ≤60 phút / quá hạn được tính khi tải trang; phiếu giải quyết/kết thúc dừng theo dõi. Không tự gắn SLA, sinh hạn, tính lại khi đổi ưu tiên hoặc chạy cảnh báo nền. Dùng nút Làm mới, không push.
- Mẫu dashboard có ca trực, số liệu và dữ liệu minh họa; chỉ dùng bố cục/phong cách, không đưa các dữ liệu đó vào dashboard thật. Không làm kho hướng dẫn/thông báo/cài đặt/Quản lý ngoài phạm vi.

## Use Case → API → CSDL

Prefix `/api/v1/staff`, Swagger `/docs`. Yêu cầu role staff và hồ sơ thật; POST/PATCH/upload dùng Origin hợp lệ + X-CSRF-Token từ GET `/api/v1/auth/csrf`. Không thay đổi endpoint auth/customer.

| Use Case | API | Bảng chính |
| --- | --- | --- |
| Tổng quan/đề xuất/hàng đợi | GET /overview; GET /tickets?scope=queue/recommended/mine/team | phieu_ho_tro, trang_thai, nhom_ho_tro, thanh_vien_nhom, xu_ly_mac_dinh, nhan_vien, nguoi_dung, lich_su_phan_cong |
| Tiếp nhận | POST /tickets/{id}/accept | phieu_ho_tro, lich_su_phan_cong, lich_su_trang_thai |
| Lập phiếu thay khách | GET /customers?search=; POST /tickets | khach_hang, nguoi_dung, phieu_ho_tro, lich_su_trang_thai |
| Danh mục/phân loại | GET /ticket-types, /ticket-statuses, /priorities; PATCH /tickets/{id}/classification | loai_ho_tro, muc_do_uu_tien, trang_thai, phieu_ho_tro |
| Chi tiết/phân công | GET /tickets/{id} | phieu_ho_tro, nguoi_dung, tin_nhan, tep_dinh_kem, lich_su_trang_thai, lich_su_phan_cong |
| Chuyển trong nhóm | GET /tickets/{id}/recipients; POST /tickets/{id}/transfer | thanh_vien_nhom, nhan_vien, lich_su_phan_cong, phieu_ho_tro |
| Công khai/nội bộ | POST /tickets/{id}/messages | tin_nhan, phieu_ho_tro |
| Tệp | GET /attachment-policy; POST /tickets/{id}/attachments; GET /tickets/{id}/attachments/{attachment_id} | tep_dinh_kem, phieu_ho_tro |
| Tạm dừng/tiếp tục/giải quyết | POST /tickets/{id}/status | trang_thai, phieu_ho_tro, lich_su_trang_thai |
| Tìm kiếm/SLA | GET /tickets?search=&type=&status=&priority=&from=&to=&page=&page_size=; chi tiết | phieu_ho_tro, chinh_sach_sla, danh mục |
| Khách đóng/đánh giá | API customer Giai đoạn 2 giữ nguyên | phieu_ho_tro, lich_su_trang_thai, danh_gia |

Routes: `/staff`, `/staff/queue`, `/staff/recommended`, `/staff/mine`, `/staff/team`, `/staff/new`, `/staff/tickets/:id`. Tìm theo ID, #HT-ID hoặc tiêu đề; tham số SQL hóa và phân trang tối đa 50/trang, ngày theo Việt Nam. Không SELECT * hoặc trả hash/đường dẫn storage.

## Phương thức và kết quả chạy thực tế

`scripts/test_phase3.py --execute --stage AB/C/D/E`: FastAPI/SQL PostgreSQL/Argon2id thật; connection factory trỏ vào transaction rollback. Không mock truy vấn hoặc login thành công. Chỉ chèn lỗi lịch sử/phân công/metadata để kiểm tra nguyên tử. So sánh số bản ghi của toàn bộ bảng liên quan trước/sau; tệp trong TemporaryDirectory. Identity có thể tăng, không reset.

`--browser`: backend tạm 8001/Vite 5174; Chromium desktop và iPhone 13 emulation. Password ngẫu nhiên chỉ trong bộ nhớ/env, không video/trace chứa credentials. RLock tuần tự truy vấn trong harness dùng chung transaction; **không dùng kết quả này để tuyên bố đã test race**.

`scripts/test_phase3_race.py --execute`: kết nối PostgreSQL độc lập, hai request bắt đầu cùng barrier. Fixture riêng tên ngẫu nhiên phải commit để các connection nhìn thấy; finally chỉ dọn đúng ID fixture đã ghi nhận, kiểm tra quyền sở hữu trước khi xóa và xác minh không còn tài khoản. Không xóa dữ liệu sử dụng. Đã chạy và cleanup thành công.

| Bộ kiểm thử | Kết quả | Nội dung |
| --- | --- | --- |
| A/B PostgreSQL | PASS | Ưu tiên 0 vs 3 phiếu; đọc không phân công; nhận cùng ID; một phân công hiệu lực; lần hai 409; CSRF/role/nhóm; lỗi lịch sử rollback |
| C PostgreSQL | PASS | Nguồn/người lập, không tự giao; chủ khách đúng; phân loại có quyền; chuyển cùng nhóm; bảo toàn lịch sử; lỗi INSERT phân công rollback; BOLA/SQL injection |
| D PostgreSQL | PASS | Công khai/nội bộ, mốc phản hồi đầu; tệp thật, download/quyền/traversal/MIME/cleanup; trạng thái sai; lịch sử rollback; nhân viên giải quyết → khách đóng/đánh giá một lần |
| E PostgreSQL | PASS | SLA thiếu/trong/sắp/quá; tổng quan quá hạn; lọc ID/loại/trạng thái/ưu tiên/ngày; đổi loại không chuyển ngầm; thiếu nhóm/nhóm không nhân viên vẫn chờ; nhóm ngừng/hồ sơ thiếu/tài khoản khóa bị chặn |
| Race kết nối độc lập | PASS | Accept 200/409 và transfer 200/409; cùng phiếu, một phân công hiệu lực; lịch sử cũ còn; cleanup đúng fixture |
| Browser Phase 3 | PASS | 2/2 desktop/mobile: queue, accept, nội bộ/công khai, tệp, giải quyết → khách đóng/đánh giá, phiếu điện thoại; không tràn ngang; không localStorage; giữ loại/ưu tiên khi danh mục tải chậm |
| Unit hồi quy | PASS | 17/17 xác thực và danh mục nội thất |
| Phase 1 PostgreSQL + browser | PASS | Login/me/logout ba role, sai/khóa/không tồn tại/phiên hết hạn, rollback; 6/6 browser desktop/mobile |
| Phase 2 PostgreSQL + browser | PASS | A–E, tệp/role/CSRF/BOLA/transaction/rollback; 6/6 browser khách hàng và ngữ cảnh nội thất |
| Browser công khai | PASS | 6/6 desktop/mobile. Lần đầu một timeout kiểm tra phiên khi nhiều bộ/build chạy đồng thời; snapshot vẫn ở “Đang kiểm tra phiên”, không lộ dữ liệu. Chạy lại riêng toàn bộ 6 ca PASS |
| Frontend build cuối | PASS | npm run build: TypeScript + Vite |
| Nhóm/ánh xạ được duyệt | PASS | 4 nhóm + 8 ánh xạ; chạy lại không tạo trùng; không tạo tài khoản/thành viên/SLA |

Đã sửa sau kiểm thử: khóa joined view có thể trả 404 cho request thua race; chuyển sang khóa dòng phieu_ho_tro rồi đọc lại quyền/trạng thái, chạy lại PASS 200/409. Form phân loại từng chọn option đầu khi danh mục tải chậm: đã sửa và thêm assert browser. Harness sửa chờ login/logout và dùng selector combobox; các lần lỗi trước không tính PASS.

## File và giới hạn còn lại

Thêm Backend: `schemas/staff.py`, `services/staff_service.py`, `api/routes/staff.py`. Sửa `main.py` đăng ký router, `core/uploads.py` nhận diện giới hạn upload staff.

Thêm Frontend: `src/staff/{api.ts,Layout.tsx,Overview.tsx,Tickets.tsx,NewTicket.tsx,Detail.tsx,styles.css}`. Sửa `src/App.tsx` routes, thêm `playwright.phase3.config.ts` và `phase3-tests/staff.spec.ts`.

Thêm scripts `test_phase3.py`, `test_phase3_race.py`, `configure_support_groups.py`; sửa `test_auth_database.py` gắn thêm staff connection vào fixture hồi quy. Cập nhật README, báo cáo này và PHASE3_GROUP_SETUP.md. Không sửa SQL khởi tạo, schema hoặc API customer/auth và Trang chủ/Đăng nhập.

4 nhóm/8 ánh xạ đã được người dùng duyệt và áp dụng; chưa tạo tài khoản/thành viên hoặc SLA. Hiện chưa có nhân viên sử dụng: để nhận phiếu thật cần cấp tài khoản NHAN_VIEN + hồ sơ nhan_vien + thành viên nhóm được duyệt. Không có đăng ký nhân viên công khai/mật khẩu mặc định. Luồng đầy đủ đã test bằng fixture thật, không để lại tài khoản demo.

CHƯA TRIỂN KHAI theo phạm vi: quản trị tài khoản/nhóm, chuyển khác nhóm/chính sách SLA (Giai đoạn 4), staff đóng/hủy thay khách, online/ca trực, push, SLA nền, chatbot. CHƯA CHẠY Firefox/WebKit, iOS thật hoặc production HTTPS; mobile dùng Chromium emulation.

## Chạy Windows và thử theo luồng

```powershell
# Terminal Backend tại thư mục gốc
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
# Terminal Frontend
cd frontend
npm ci
npm run dev
# Kiểm thử từ thư mục gốc; không chạy đồng thời các bộ --browser dùng 8001/5174
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase3.py --execute --stage E --browser
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase3_race.py --execute
.\.venv\Scripts\python.exe -X utf8 -m unittest discover -s tests -v
```

Mở `/register` → đăng nhập khách → tạo phiếu bảo hành sofa. Đăng nhập nhân viên đã cấp và thuộc nhóm Bảo hành và bảo trì → `/staff/queue` → Tiếp nhận → chi tiết → trả lời/tệp → giải quyết. Khách làm mới → đóng → đánh giá. Không tạo lại phiếu khách gửi. Swagger `http://127.0.0.1:8000/docs`, frontend `http://localhost:5173`. Dữ liệu: DB_HELPDESK → Schemas → helpdesk → Tables.

Kiểm tra cuối: `/` 200 giữ phản hồi cũ; `/health/db` 200 báo DB_HELPDESK/helpdesk, 20 bảng/33 FK; `/docs` 200; 17 path staff trong OpenAPI. CSDL thực sau test: 4 nhóm, 8 ánh xạ, 0 hồ sơ nhân viên, 0 thành viên, 0 chính sách SLA. Tất cả là dữ liệu cấu hình được duyệt; không còn fixture. `git diff --check` PASS.
