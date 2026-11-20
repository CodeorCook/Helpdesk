# Phiên bản SLA — kết quả triển khai 19/11/2026

## Kết luận từ source và PostgreSQL

Không cần migration. Bảng `helpdesk.chinh_sach_sla` đã có `sla_ma`, `mdut_ma`, `ten`, `thoi_gian_phan_hoi_phut`, `thoi_gian_xu_ly_phut`, `dang_hoat_dong`, `ngay_tao`. Ngoài PK, index `uq_sla_muc_uu_tien_dang_dung` chỉ unique `mdut_ma WHERE dang_hoat_dong=true`. Không có ràng buộc unique mức ưu tiên cho bản đã khóa. FK mức ưu tiên là RESTRICT; các CHECK đã bảo vệ phút dương và xử lý >= phản hồi.

Nguyên nhân hạn chế cũ:

- Form tạo và schema mặc định `active=true`, nên tạo bản cùng ưu tiên đang có hiệu lực đụng đúng partial unique index.
- Form sửa vừa sửa thông tin vừa bật/tắt trạng thái; chưa có thao tác thay thế hai phiên bản nguyên tử và có xác nhận.
- Chính sách đã có phiếu tham chiếu bị khóa nội dung để bảo toàn lịch sử — đây là bảo vệ cần giữ, không phải lỗi cần bỏ.
- Xét duyệt đã lấy SLA theo ưu tiên nhân viên chọn, nhưng không chặn nếu thiếu bản hiệu lực và chưa đánh dấu chắc chắn giai đoạn SLA của dữ liệu Mới cũ.
- Phiếu lưu FK `sla_ma`, hai deadline và mốc phản hồi/giải quyết. Báo cáo dùng deadline/mốc thật, không tính lại theo bản hiệu lực hiện tại.

## Quy tắc sau nâng cấp

1. Tạo mới mặc định **chưa áp dụng**, kể cả ưu tiên đã có bản hiệu lực. Không tự thay thế bản cũ. API vẫn cho tạo bản hiệu lực đầu tiên nếu client gửi rõ `active=true`; nếu đã có bản hiệu lực, index trả 409 đúng nghiệp vụ.
2. Bảng giữ 5 bản/trang, hiển thị tất cả phiên bản, tên + ID, badge Đang áp dụng hoặc Đã khóa/Chưa áp dụng, số phiếu tham chiếu và icon chỉnh sửa/khóa/kích hoạt.
3. Icon khóa mở hướng dẫn có xác nhận đóng/hủy nhưng **không cho khóa đơn lẻ** bản đang dùng. Quản lý cần tạo bản thay thế rồi kích hoạt ở bản đó; không cố tình tạo khoảng trống SLA.
4. Kích hoạt tải lại thông tin chính sách và bản đang áp dụng từ Backend. Sau xác nhận, một request tắt bản cũ và bật bản mới trong cùng transaction. Lỗi giữa chừng rollback cả hai thay đổi. Audit ghi `sla.lock` và `sla.activate` sau thành công.
5. `expected` bảo vệ snapshot bản được chọn; `expected_active_id` bảo vệ bản hiện đang áp dụng. Thao tác trùng/cũ trả 409, modal có nút tải lại trước khi thử lại.
6. Bản đã có phiếu hiện tại hoặc dấu tham chiếu lịch sử trong JSON không được sửa tên, ưu tiên hay thời lượng. Bản chưa sử dụng được sửa; bản đang hiệu lực không được chuyển ưu tiên để tránh bỏ trống ưu tiên cũ. Hiệu lực chỉ đổi qua thao tác riêng, không qua PATCH thông tin.
7. Không thêm chức năng xóa SLA. Không xóa vật lý chính sách hay cập nhật hàng loạt phiếu.

## Đồng bộ transaction và bảo toàn deadline

- Dùng lại khóa điều phối chung cho mutation Quản lý/Nhân viên; thêm advisory transaction lock theo ưu tiên `pg_advisory_xact_lock(74104, priority_id)` cho mọi lần chọn/gắn chính sách và chỉnh/kích hoạt phiên bản.
- Chọn/gắn SLA giữ khóa ưu tiên đến hết transaction và `FOR SHARE` bản hiệu lực. Thay thế dùng cùng khóa ưu tiên, khóa các policy rows rồi tắt/bật. Partial unique index là lớp bảo vệ cuối.
- Nhân viên lập phiếu giữ các bước cập nhật nội dung, snapshot, gắn SLA, phân công, lịch sử trạng thái và enqueue email trong cùng transaction.
- Backend chọn bản **đang hiệu lực tại transaction xét duyệt**, không chọn ID mới nhất, không dùng bản khóa và không tự về Trung bình. Response trả `sla_id` thực tế đã gắn. Xem trước chỉ có tính tham khảo; UI có chú thích rõ.
- Nếu thiếu SLA, xét duyệt trả 422 và rollback toàn bộ, giữ nguyên yêu cầu và dữ liệu nhập trên UI. Khách vẫn có thể gửi yêu cầu chờ cấu hình; không tự tạo chính sách.
- Deadline vẫn bằng `ngay_tao + thời lượng chính sách`, 24/7; không tính từ thời điểm bấm xét duyệt. Phút phải là số nguyên dương <= 2147483647, xử lý >= phản hồi; kiểm tra thêm giới hạn timestamp năm 9999 của phiếu trước khi lưu deadline để trả 422 thay vì lỗi overflow.
- Thao tác phiên bản chỉ UPDATE bảng chính sách, không UPDATE SLA/deadline của phiếu. Cơ chế tính lại SLA từng phiếu có xác nhận rõ của Quản lý từ trước vẫn được giữ; không tự gọi khi khóa/kích hoạt.

## SLA tạm tính và chính thức, không thêm cột

Tận dụng JSON `phieu_ho_tro.yeu_cau_goc` đã có từ migration 001, không tạo migration mới:

- Yêu cầu mới tạo từ Khách hàng hoặc Nhân viên được đánh dấu `_sla_phase=provisional`; SLA tạm tính lấy theo ưu tiên lúc gửi. Thiếu SLA thì lưu yêu cầu, giữ deadline trống.
- Xét duyệt lưu nguyên nội dung trước xét duyệt, tên/deadline/ID SLA trước đó, `sla_phase_before_review`, rồi đánh dấu `_sla_phase=official` và áp bản hiệu lực cho mức ưu tiên chính thức.
- `_sla_used_ids` giữ dấu những phiên bản đã được gắn qua các thao tác mới. Số phiếu tham chiếu tính cả FK hiện tại, ID snapshot trước xét duyệt và danh sách phiên bản đã dùng; một phiếu chỉ đếm một lần cho mỗi chính sách. Điều này tránh bản SLA tạm tính trở thành “chưa sử dụng” và bị sửa lịch sử sau khi phiếu chuyển sang SLA chính thức.
- Yêu cầu Mới cũ không có dấu giai đoạn được ghi nhận `legacy`, không tự suy đoán là tạm tính. Nếu đã có SLA thì xét duyệt cần `confirm_legacy_sla_replacement=true`, tương ứng checkbox xác nhận rõ trên UI. Không xác nhận thì trả 409, SLA cũ không đổi.
- Không backfill/reset hàng loạt dữ liệu cũ. Các mốc lịch sử đã thiếu từ trước không được suy diễn hoặc sinh giả.
- Metadata tạm tính không bị hiểu nhầm là đã xét duyệt khi kiểm tra quyền Không tiếp nhận. Snapshot chi tiết chỉ hiển thị khi có nội dung gốc thật.
- Giao diện Khách hàng/Nhân viên/Quản lý đọc tên chính sách bằng **FK đã gắn**, không lọc cờ hiệu lực. Khách hàng được bổ sung panel deadline đã lưu cho chính yêu cầu của mình. Không mở thêm quyền truy cập hoặc dữ liệu cá nhân.

## API thay đổi

| API | Hành vi |
|---|---|
| GET `/api/v1/manager/sla` | Giữ API/phân trang, số tham chiếu gồm dấu lịch sử |
| POST `/api/v1/manager/sla` | Mặc định inactive; nhiều bản cùng ưu tiên được phép |
| PATCH `/api/v1/manager/sla/{id}` | Sửa bản chưa dùng, kiểm tra snapshot; cấm thay hiệu lực qua form thường |
| GET `/api/v1/manager/sla/{id}` | Chi tiết một phiên bản, gồm số tham chiếu |
| GET `/api/v1/manager/sla/{id}/state` | Bản được chọn và bản đang hiệu lực cùng ưu tiên để xác nhận |
| POST `/api/v1/manager/sla/{id}/state` | Kích hoạt thay thế nguyên tử; JSON `active`, `expected`, `expected_active_id` |
| GET `/api/v1/staff/sla-preview?priority_id=...` | Chỉ bản hiệu lực: ID/tên/phút phản hồi/phút xử lý; null nếu thiếu |
| POST `/api/v1/staff/tickets/{id}/approve` | Chặn thiếu SLA, trả phiên bản thực tế; tùy chọn xác nhận thay SLA legacy |
| API phiếu Khách hàng/Nhân viên/Quản lý | Bổ sung/giữ ID, tên, deadline đã gắn và giai đoạn SLA; phân quyền hiện hữu |

Mutation giữ authentication, role, CSRF/Origin, SQL tham số và audit hiện có. Không thay schema, index hoặc migration 006.

## File của đợt SLA

- `core/sla.py`.
- `services/manager_service.py`, `services/staff_service.py`, `services/customer_service.py`.
- `schemas/manager.py`, `schemas/staff.py`, `schemas/customer.py`.
- `api/routes/manager.py`, `api/routes/staff.py`.
- `frontend/src/manager/SLA.tsx`, `frontend/src/manager/styles.css`.
- `frontend/src/staff/RequestReview.tsx`, `Queue.tsx`, `Detail.tsx`, `api.ts`, `styles.css`.
- `frontend/src/customer/TicketSLAInfo.tsx` (mới), `Detail.tsx`, `RequestSummary.tsx`, `api.ts`.
- `scripts/sla_version_checks.py` (mới), `scripts/test_phase4.py` (fixture và assertions cập nhật theo quy tắc mới).
- `frontend/staff-ui-tests/sla-versions.spec.ts`, `frontend/playwright.sla.config.ts` (mới).
- Tài liệu này. Các thay đổi Nhóm–Loại và Bebo đã tồn tại trong working tree được giữ nguyên, không thuộc đợt SLA.

## Kiểm thử và giới hạn

| Hạng mục | Kết quả thực tế |
|---|---|
| TypeScript + `npm run build` | PASS; Vite còn cảnh báo bundle >500 kB |
| Nhiều phiên bản, default inactive, sửa bản chưa dùng, duy nhất một active | PASS API + PostgreSQL fixture rollback |
| Thay thế, CSRF/role, expected snapshot/active ID, audit, rollback khi bật bản mới lỗi | PASS |
| SLA cũ và MOI không reset khi thay phiên bản | PASS đối chiếu đầy đủ FK/deadline/mốc thực tế và giờ tạo trước/sau |
| SLA trước xét duyệt và SLA chính thức | PASS snapshot/ID/giai đoạn, deadline tính từ ngày gửi |
| Chọn ưu tiên Cao, preview, thiếu SLA, legacy cần xác nhận | PASS API thật; thiếu SLA không có phân công mới |
| Báo cáo và Khách hàng vẫn đọc bản đã khóa | PASS so sánh metrics trước/sau thay phiên bản; GET phiếu của chính Khách hàng giữ tên/ID cũ |
| Hai request kích hoạt, request xét duyệt cùng request thay phiên bản | PASS kết quả HTTP và kiểm tra deadline khớp trọn vẹn phiên bản gắn; xem giới hạn concurrency bên dưới |
| UI Quản lý và preview Nhân viên | PASS 8 cases Chrome desktop/mobile × Sáng/Tối, API fixture; modal, validation, active replacement, khóa đơn lẻ bị chặn, bản tham chiếu read-only, phân trang, phản hồi lỗi giữ bản nháp, đổi ưu tiên nhanh không hiển thị response cũ |
| Hồi quy stage D | PASS: tiếp nhận/phân công/chuyển nhóm, SLA trong hạn/gần hạn/quá hạn, ghi chú nội bộ không tính phản hồi đầu, quyền tệp, báo cáo/Overview liên quan |
| Dữ liệu | Fixture rollback; số bản ghi trước/sau không đổi; không reset sequence; không gửi email thật, không gọi Gemini |

Giới hạn concurrency: HTTP fixtures dùng chung connection có khóa serialize để giữ rollback an toàn. Có kiểm tra **connection PostgreSQL độc lập không lấy được khóa ưu tiên đang giữ**, nhưng chưa chạy stress nhiều worker với các transaction ghi độc lập trên dữ liệu committed riêng. Không tuyên bố đã kiểm thử tải production.

Ảnh fixture: `frontend/test-results/sla-versions-{desktop,mobile}-{light,dark}.png`, `sla-preview-{desktop,mobile}-{light,dark}.png`. Không thêm thư viện; dùng Chrome có sẵn và component dialog/pagination hiện hữu.

Lệnh PowerShell từ thư mục project:

```powershell
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase4.py --execute --stage B --sla-versions
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase4.py --execute --stage D
cd frontend
npm run build
npx playwright test --config playwright.sla.config.ts
```

Sau khi cập nhật code, khởi động lại Backend nếu chưa chạy chế độ reload và tải lại Frontend. Không cần chạy lệnh DBeaver cho đợt SLA này. Không tạo chính sách mẫu hoặc thay trạng thái chính sách thật khi triển khai. Không commit/push.
