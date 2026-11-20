# Kiểm thử điều phối khẩn sau migration 007

Ngày kiểm thử: 20/11/2026. Nhiệm vụ chỉ kiểm thử; không sửa source nghiệp vụ, không chạy migration, không commit/push.

**Kết luận:** cấu trúc thật và các API điều phối khẩn đã đạt các ca dưới đây trên `DB_HELPDESK.helpdesk`. Có thể tiếp tục nghiệm thu sử dụng trên database này, không cần chạy lại migration. Chưa xác nhận PASS toàn luồng trình duyệt → Backend đang chạy → database thật: trình duyệt được kiểm tra bằng API fixture, còn API thật chạy qua FastAPI TestClient với PostgreSQL và transaction rollback có kiểm soát.

## A Kết quả migration thật

Transaction READ ONLY xác nhận:

- Database `DB_HELPDESK`, schema `helpdesk`, bảng `yeu_cau_dieu_phoi_phieu` tồn tại và đọc được; trước/sau kiểm thử có 0 yêu cầu điều phối sử dụng thật.
- 12 cột đúng kiểu, nullability và default theo file 007.
- PK `yc_ma`, identity `GENERATED ALWAYS`.
- 6 FK đã validated, tất cả ON DELETE RESTRICT: phiếu, nhân viên gửi, nhóm nguồn, phân công nguồn, Quản lý xử lý, phân công kết quả.
- 3 CHECK đã validated: trạng thái, lý do 1–2000 ký tự sau btrim, và tính nhất quán của người xử lý/thời điểm/kết quả theo trạng thái.
- Ba index đều valid/ready: PK, partial unique `uq_dieu_phoi_phieu_dang_cho` trên `phieu_ma WHERE trang_thai='CHO_XU_LY'`, index `ix_dieu_phoi_nguoi_gui` trên `(nhan_vien_gui_ma,ngay_gui DESC)`.
- API thực tế và SQL savepoint xác nhận unique index chặn hai yêu cầu đang chờ; ba yêu cầu lịch sử đã kết thúc trên cùng phiếu vẫn được lưu.

| Cột | Kiểu | Cho phép NULL / mặc định |
|---|---|---|
| yc_ma | bigint | Không; identity ALWAYS |
| phieu_ma | bigint | Không |
| nhan_vien_gui_ma | bigint | Không |
| nhom_gui_ma | bigint | Không |
| phan_cong_gui_ma | bigint | Không |
| ly_do | text | Không |
| ngay_gui | timestamptz | Không; clock_timestamp() |
| trang_thai | varchar(20) | Không; CHO_XU_LY |
| quan_ly_xu_ly_ma | bigint | Có |
| ngay_xu_ly | timestamptz | Có |
| ghi_chu_xu_ly | text | Có |
| phan_cong_ket_qua_ma | bigint | Có |

Không phát hiện sai cấu trúc so với migration 007. Không có lệnh DDL hoặc migration nào được thực thi trong đợt kiểm thử.

## B Kiểm thử Backend

API không được mock quyết định nghiệp vụ: dùng router, authentication/login, role, CSRF, service và SQL thật. Chỉ connection được buộc vào transaction fixture. TC10 cố ý inject lỗi ở bước hoàn tất để kiểm tra rollback.

| Ca | Kết quả | HTTP thực tế và bằng chứng |
|---|---|---|
| TC01 gửi hợp lệ | PASS | 201; lưu đúng phiếu/người gửi/nhóm/lý do/thời điểm, CHO_XU_LY; toàn bộ phiếu không đổi |
| TC02 gửi trùng | PASS | 409; chỉ một pending. INSERT trùng bằng SQL savepoint bị UniqueViolation đúng index đã cài |
| TC03 sai quyền/CSRF | PASS | 409 nhân viên cùng nhóm nhưng không phụ trách; 404 ngoài nhóm; 403 Khách hàng; 403 thiếu CSRF |
| TC04 trạng thái không hợp lệ | PASS | 409 cho MOI chưa duyệt, DA_DONG, DA_HUY, DA_GIAI_QUYET |
| TC05 lý do không hợp lệ | PASS | 422 cho rỗng, toàn khoảng trắng, quá 2000 ký tự, thiếu trường |
| TC06 lịch sử đúng quyền | PASS | 200 người phụ trách; 404 nhân viên khác không có yêu cầu của mình; 403 Khách hàng. Sau chuyển nhóm, tác giả cũ xem kết quả của mình bằng endpoint lịch sử, không xem được toàn bộ phiếu |
| TC07 giao cùng nhóm | PASS | 200; cùng ID phiếu, nhân viên mới, thêm một lịch sử, kết thúc đúng phân công cũ, chỉ một phân công hiệu lực, yêu cầu DA_DIEU_PHOI |
| TC08 giao khác nhóm | PASS | 200; quan hệ N–N thật của bảng nhom_loai_ho_tro, người nhận thuộc đúng một nhóm. Nhóm không có chuyên môn bị 422. Sau chuyển, GET chi tiết bởi người cũ 404, GET lịch sử yêu cầu của họ 200 |
| TC09 từ chối | PASS | 422 khi lý do rỗng/khoảng trắng; 200 với lý do hợp lệ; TU_CHOI; phân công/phiếu/SLA không đổi |
| TC10 rollback lỗi hoàn tất | PASS | 500 được cố ý tạo bằng fault injection. Sau đó phiếu, toàn bộ lịch sử phân công và yêu cầu pending giống trước; không còn phân công mới nửa chừng |
| TC11 version và replay | PASS trong phạm vi stale/replay | 409 với expected_updated_at cũ ở Nhân viên và Quản lý, expected_escalation_id sai, replay phân công hoặc từ chối yêu cầu đã hoàn tất; không ghi đè kết quả |

Chưa chạy cuộc đua ghi bằng nhiều worker/transaction độc lập; đây là SKIP riêng, không suy ra từ TC11. Connection quan sát độc lập xác nhận không lấy được advisory lock khi transaction nghiệp vụ đang giữ.

### Dashboard và bảo toàn nghiệp vụ

- GET overview và GET tickets urgent đều 200 trên schema đã cài.
- Bộ đếm toàn hệ thống khớp COUNT PostgreSQL, thay đổi đúng theo các yêu cầu fixture; không dùng số hardcode.
- Phiếu tạo 45 ngày trước vẫn xuất hiện ở urgent_only khi query truyền cả khoảng Hôm nay; attention cũng đưa nó lên trước phiếu thường.
- Tìm kiếm và phân trang Backend đúng 6 yêu cầu → 5 + 1, không trùng/mất ID. Bộ lọc không khớp trả total=0.
- So sánh các KPI trước/sau gửi điều phối ở Hôm nay, 7 ngày, Tháng này: không đổi; chỉ counter điều phối tăng.
- So sánh toàn bộ JSON bản ghi phiếu trước/sau. Khi phân công chỉ cho phép đổi nhóm, nhân viên phụ trách và timestamp cập nhật. ID, tiêu đề, mô tả, trạng thái, ưu tiên, mã SLA, hai deadline, ngày tạo và mốc phản hồi đầu khác NULL đều giữ nguyên; mốc giải quyết NULL của phiếu đang xử lý cũng giữ nguyên.
- Tin công khai, ghi chú nội bộ và lịch sử trạng thái bằng nhau trước/sau; lịch sử phân công cũ chỉ đổi ket_thuc của bản đang hiệu lực và có thêm một bản mới. Không tạo phiếu khác.
- Đưa phiếu đang xử lý vào hàng đợi không có người nhận bị 422; không quay về MOI.
- Audit có đủ escalation.request, escalation.assign, escalation.reject trong thư mục tạm của bộ test.

Không phát hiện lỗi nghiêm trọng trong source nghiệp vụ. Một assertion ban đầu của script test giả định ID phân công tăng theo thứ tự lịch sử đã được sửa: fixture dùng ID riêng lớn, nên cần tìm bản ghi cũ theo đúng ID. Đây là lỗi bộ test, không phải lỗi phân công của ứng dụng; lượt lỗi đó cũng rollback sạch.

## C Kiểm thử Frontend

Tái sử dụng `playwright.escalation.config.ts` và `escalation.spec.ts`, không tạo bộ UI test mới.

**PASS 8/8:** Nhân viên và Dashboard Quản lý × desktop/mobile × Light/Dark trên Chrome.

- Nhân viên mở modal, kiểm tra lý do, đóng Escape, gửi một lần, thấy pending, không còn nút gửi trùng; sau đổi quyền vẫn xem được kết quả của mình.
- Dashboard có 7 cột; trạng thái/ưu tiên độc lập; scope chuyển khẩn không gửi giới hạn ngày; pagination 5+1.
- Phân công lại/badge mở modal trực tiếp, có lý do người gửi, không kích hoạt click hàng; phân công và từ chối cập nhật danh sách/counter.
- Enter trên hàng mở chi tiết; không tràn ngang; kiểm tra ảnh desktop/mobile, Sáng/Tối theo bộ test hiện có.
- TypeScript + npm run build PASS. Vite còn cảnh báo bundle JS lớn hơn 500 kB; không sửa bundle ngoài phạm vi.

Các ca browser dùng API fixture, không gọi API ghi của Backend/database thật. E2E ghi qua các HTTP request độc lập và trình duyệt thật: SKIP vì chưa thiết lập database test riêng; không sử dụng dữ liệu vận hành để thay thế.

## D Bảo vệ dữ liệu

Script cũ được đọc trước nhưng không chạy: có ALTER/migration 004/005/007 và routing fallback không phù hợp kiểm thử sau migration thật. Script mới `scripts/test_post_migration007.py` không có DDL, không chạy lại migration, không đổi ánh xạ hay tài khoản đang sử dụng.

- Tạo riêng fixture tài khoản, nhóm, loại, ưu tiên, SLA, phiếu và hội thoại trong outer transaction `force_rollback=True`. Mọi UPDATE chỉ vào ID fixture được tạo trong chính lượt này.
- Tất cả entry point get_connection của các service được buộc vào cùng connection có RLock và savepoint. Chặn mọi psycopg.connect phát sinh ngoài hai connection đã mở từ đầu. Không giả định transaction bên ngoài tự bao phủ request.
- Kiểm tra backend PID và root transaction ID không đổi sau các request. Connection quan sát READ ONLY độc lập không nhìn thấy tài khoản/yêu cầu fixture chưa commit.
- Không khởi chạy lifespan/worker SMTP. Chặn SMTP, SMTP_SSL và deliver_next; cả ba có 0 lần gọi. Audit chỉ ghi thư mục TemporaryDirectory được dọn sau test.
- So sánh số lượng và fingerprint toàn bộ bản ghi của **25 bảng** trước/sau: bằng nhau, danh sách bảng đổi rỗng. Fingerprint được tính trong PostgreSQL; không xuất dữ liệu cá nhân, password hash hoặc bí mật vào báo cáo.
- Không tạo schema test; không có schema fixture_escalation còn sót. Không có tài khoản/phiếu/yêu cầu thử lưu vĩnh viễn, không xóa dữ liệu thật để dọn.
- Không reset sequence. Hai sequence `lich_su_phan_cong_pc_ma_seq` và `yeu_cau_dieu_phoi_phieu_yc_ma_seq` có tăng do INSERT/nextval trong các ca kiểm thử: PostgreSQL không rollback nextval, nên ID có thể có khoảng trống dù các bản ghi đã rollback. Không khẳng định sequence giữ nguyên giá trị.

Đối chiếu dữ liệu áp dụng cho trước/sau đợt kiểm thử này. Không dùng kết quả đó để suy diễn một bản sao dữ liệu trước khi người dùng chạy migration.

## E Kết luận và cách chạy lại

**Đã sẵn sàng ở mức schema và API được kiểm chứng trên DB_HELPDESK.** Không có lỗi chặn được phát hiện trong các ca đã chạy; không cần migration hoặc sửa nghiệp vụ để tiếp tục dùng. **Chưa nghiệm thu toàn luồng trình duyệt thật với Backend đang chạy và database thật**, và chưa stress race nhiều worker độc lập; không kết luận PASS hai phần chưa chạy này.

File thêm trong đợt kiểm thử: script test an toàn; báo cáo này; `docs/POST_MIGRATION007_TEST_DATA.json` lưu kết quả schema/TC01–TC11, isolation và bảo toàn dữ liệu. Không sửa Backend/Frontend nghiệp vụ, migration hoặc `.env`. Không commit/push.

Từ thư mục project:

```powershell
.\.venv\Scripts\python.exe -X utf8 scripts/test_post_migration007.py --execute
cd frontend
npm run build
npx playwright test --config playwright.escalation.config.ts
```

Lệnh script có thể để lại khoảng trống sequence như giải thích trên, nhưng không để lại bản ghi fixture. Không cần chạy lại các script migration để sử dụng bộ kiểm thử này.
