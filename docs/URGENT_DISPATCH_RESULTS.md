# Điều phối khẩn và danh sách phiếu cần xử lý ngay

Triển khai ngày 20/11/2026 trong workspace hiện tại. Yêu cầu khẩn được lưu riêng, không phải trạng thái phiếu và không tự phân công. Migration 007 chưa được áp dụng lên schema `helpdesk` sử dụng thật.

## Cấu trúc và API

Metadata PostgreSQL chưa có bảng điều phối tương đương. Bảng mới `yeu_cau_dieu_phoi_phieu` lưu mã yêu cầu, phiếu, nhân viên gửi, nhóm và phân công tại thời điểm gửi, lý do, thời điểm gửi, trạng thái, Quản lý xử lý, thời điểm xử lý, ghi chú và phân công kết quả. Các FK dùng RESTRICT; không xóa dây chuyền.

Trạng thái yêu cầu là `CHO_XU_LY`, `DA_DIEU_PHOI`, `TU_CHOI`. Partial unique index `uq_dieu_phoi_phieu_dang_cho` bảo đảm chỉ một yêu cầu đang chờ trên mỗi phiếu. CHECK bảo vệ lý do/kết quả và thông tin người xử lý. Các lần cũ được giữ nguyên.

| API | Hành vi |
|---|---|
| POST `/api/v1/staff/tickets/{id}/escalations` | Người phụ trách hiện tại gửi lý do và `expected_updated_at`; chỉ DANG_XU_LY/TAM_DUNG, kiểm tra phân công hiệu lực và nhóm hoạt động |
| GET `/api/v1/staff/tickets/{id}/escalations` | Chủ phiếu đang xử lý xem lịch sử; người từng gửi chỉ xem yêu cầu do mình gửi khi không còn quyền xem phiếu |
| POST `/api/v1/manager/tickets/{id}/escalations/{request_id}/reject` | Từ chối có lý do và kiểm tra version; không đổi phiếu/người phụ trách/SLA |
| POST `/api/v1/manager/tickets/{id}/assignment` | Tái sử dụng API phân công; bổ sung `expected_escalation_id`, hoàn tất yêu cầu tương ứng cùng transaction với lịch sử phân công |
| GET `/api/v1/manager/overview` | Bổ sung `escalation_available` và `pending_escalations` toàn hệ thống, độc lập kỳ KPI |
| GET `/api/v1/manager/tickets?urgent_only=true` | Lọc toàn bộ yêu cầu đang chờ trước COUNT/LIMIT/OFFSET, bỏ giới hạn ngày tạo; frontend gửi page_size=5 |
| GET chi tiết Nhân viên/Quản lý | Bổ sung trạng thái cấu hình và tối đa 50 yêu cầu điều phối gần nhất |

Mutation giữ authentication, role authorization, CSRF/Origin, SQL tham số, khóa điều phối PostgreSQL và khóa phiếu. Audit có `escalation.request`, `escalation.assign`, `escalation.reject`. Thiếu migration thì API ghi trả 503 có thông báo cụ thể; không tự tạo bảng lúc khởi động.

## Luồng Nhân viên và Quản lý

Nút Chuyển khẩn lên Quản lý nằm dưới card Theo dõi SLA, không đổi vị trí hội thoại. Modal hiển thị phiếu, nhóm, người phụ trách, ưu tiên, SLA và bắt buộc lý do cụ thể. Gửi thành công tải lại dữ liệu Backend; badge chờ xuất hiện và nút gửi bị ẩn khi còn yêu cầu chưa xử lý. Có nút Cập nhật điều phối để xem kết quả mới.

Khi đã chuyển khác nhóm, tác giả cũ không có quyền chat hay xử lý phiếu. Trang chi tiết có thể hiển thị riêng kết quả yêu cầu do họ gửi bằng endpoint lịch sử giới hạn quyền; không lấy lại toàn bộ nội dung phiếu. Người nhận hiển thị là người được giao tại thời điểm xử lý yêu cầu, dựa vào bản ghi phân công kết quả đã lưu.

Dashboard giữ bố cục Bento, Donut và các widget hiện hữu. Bộ đếm chờ điều phối là số liệu toàn hệ thống. Danh sách có hai phạm vi:

- Tất cả cần xử lý: phiếu trong kỳ cộng yêu cầu khẩn đang chờ từ mọi thời điểm. Yêu cầu khẩn xếp đầu, sau đó quá hạn, chưa phân công, sắp đến hạn và thứ tự ưu tiên/hạn như trước.
- Chuyển khẩn lên Quản lý: chỉ yêu cầu CHO_XU_LY, không phụ thuộc Hôm nay/7 ngày/Tháng này. Các KPI và Donut vẫn theo kỳ riêng, không cộng yêu cầu khẩn vào tổng phiếu theo kỳ.

Bảng có đúng 7 cột: Mã phiếu; Nội dung yêu cầu; Nhóm hỗ trợ; Nhân viên phụ trách; Trạng thái phiếu; Mức ưu tiên; Trạng thái SLA. Nội dung chỉ còn tiêu đề, badge loại và badge Cần điều phối nếu có. Không còn dòng trạng thái gộp ưu tiên hoặc link Xem / Phân công lại.

Click hàng hoặc Enter/Space mở chi tiết. Button Phân công lại và badge Cần điều phối mở trực tiếp `AssignmentDialog` dùng chung với trang chi tiết, tải snapshot mới nhất trước khi mở và chặn propagation. Popup hiển thị lý do nhân viên, cho chọn nhân viên đích hoặc từ chối có lý do. Xung đột 409 giữ nội dung trong modal và yêu cầu mở lại để lấy snapshot mới.

Khi chuyển khác nhóm cho yêu cầu khẩn, Backend kiểm tra chuyên môn Nhóm–Loại từ quan hệ N–N hiện hữu, hoặc ánh xạ mặc định khi chưa nâng cấp quan hệ. Người nhận phải hoạt động và thuộc đúng một nhóm. Lịch sử cũ được kết thúc, lịch sử mới được tạo và yêu cầu đổi sang DA_DIEU_PHOI trong cùng transaction. Nếu bước hoàn tất yêu cầu lỗi, cả phân công và phiếu rollback.

## Bảo vệ MOI và SLA

Phiếu đã lập không được đưa về hàng đợi chưa gán để quay lại MOI. Backend yêu cầu người nhận cụ thể khi trạng thái không phải MOI, có dấu SLA chính thức hoặc đã từng có lịch sử phân công. Popup ẩn lựa chọn hàng đợi với các phiếu này. Yêu cầu Mới chưa từng phân công vẫn được điều phối tới hàng đợi mà không đổi trạng thái.

Yêu cầu điều phối đang chờ luôn cần nhân viên đích cụ thể nếu được chấp nhận. Từ chối giữ nguyên phân công. Không đổi mức ưu tiên, mã SLA, hai deadline, mốc phản hồi/giải quyết hoặc nội dung hội thoại. Không tạo phiếu khác, không tự đóng và không gửi tin công khai/email cho Khách hàng chỉ vì điều phối nội bộ.

Nếu nhân viên giải quyết phiếu trong khi yêu cầu khẩn còn chờ, yêu cầu vẫn được hiển thị để Quản lý xem và từ chối có lý do; không tự dựng sự kiện người xử lý. Phiếu đã kết thúc không được phân công lại hoặc gửi thêm yêu cầu khẩn.

## Migration và cách chạy thử

File: `docs/migrations/007_ticket_escalation.sql`.

Sau khi xem script và quyết định áp dụng, người dùng mở file trong SQL Editor của DBeaver, chọn kết nối **DB_HELPDESK**, chạy toàn bộ script transaction. Script tạo một bảng và các index, không cập nhật phiếu hiện hữu. Không chạy SQL khởi tạo; không cần sửa migration 006. Nếu đã có bảng cùng tên do nguồn khác tạo, cần đối chiếu cấu trúc trước, vì IF NOT EXISTS không tự điều chỉnh cấu trúc khác biệt.

Tải lại ứng dụng sau khi áp dụng; khởi động lại Backend nếu không có auto reload. Trước migration, Dashboard hiển thị Chưa cấu hình thay vì số 0 giả và không cho chọn bộ lọc chuyển khẩn. Trang Nhân viên giải thích migration cần thiết.

## File thay đổi của đợt này

- Backend: `services/escalation_service.py` mới; `services/manager_service.py`, `services/staff_service.py`; `api/routes/manager.py`, `api/routes/staff.py`; `schemas/manager.py`, `schemas/staff.py`.
- Frontend Quản lý: `Overview.tsx`, `TicketDetail.tsx`, `api.ts`, `furnidesk.css`, `styles.css` trong `frontend/src/manager/`.
- Frontend Nhân viên: `EscalationPanel.tsx` mới; `Detail.tsx`, `api.ts`, `styles.css` trong `frontend/src/staff/`.
- Migration 007; `scripts/escalation_checks.py` mới; `scripts/test_phase4.py` cập nhật fixture/assertions không quay về MOI.
- `frontend/staff-ui-tests/escalation.spec.ts`, `frontend/playwright.escalation.config.ts` mới; tài liệu này.

Hai ZIP code_2011/frontend_2011 được đối chiếu ở đoạn phân công và bảng Overview; workspace vẫn là nguồn chính. Các thay đổi Nhóm–Loại, SLA và Bebo có trước được giữ lại. Không sửa `.env`, Gemini, FAQ, SMTP/outbox, schema hay deadline thật. Không thêm thư viện. Không commit/push.

## Kiểm thử thực tế

| Kiểm thử | Kết quả |
|---|---|
| TypeScript + npm run build | PASS; Vite còn cảnh báo bundle lớn hơn 500 kB |
| Migration 007, FK/CHECK/index, chạy lại | PASS trong schema fixture riêng cùng transaction rollback, không tạo bảng trong schema helpdesk sử dụng thật |
| Người phụ trách/ngoài quyền, MOI/đã kết thúc, CSRF/role, gửi trùng | PASS API thật; hai request tranh chấp cho kết quả 201/409; unique index được thử thêm bằng SQL trực tiếp |
| Counter, yêu cầu kỳ cũ, thứ tự và COUNT/phân trang 5+1 | PASS PostgreSQL; KPI theo kỳ không đổi khi thêm yêu cầu khẩn |
| Từ chối, audit và lịch sử | PASS; lý do/kết quả lưu riêng, không đổi phiếu khi từ chối |
| Phân công cùng/khác nhóm, chuyên môn, một nhóm/nhân viên, rollback khi hoàn tất lỗi | PASS; chỉ một phân công hiệu lực, bảo toàn SLA/ưu tiên/trạng thái và lịch sử |
| Người gửi cũ xem kết quả sau chuyển nhóm | PASS; API chi tiết bị từ chối nhưng lịch sử chỉ trả các yêu cầu của chính người gửi |
| Chặn phiếu đã lập về MOI, giữ hàng đợi cho MOI chưa duyệt | PASS hồi quy có kiểm tra riêng |
| Dashboard 7 cột, mở popup trực tiếp, nhận/từ chối, click hàng, 5+1, gửi khẩn và badge, kết quả người gửi cũ | PASS 8 Playwright cases: desktop/mobile × Light/Dark, dùng API fixture |
| Hồi quy SLA/phân công/báo cáo liên quan | PASS stage D kết hợp fixture điều phối; gồm bảo vệ MOI, SLA cũ, quyền tệp, tin nội bộ, lọc nhật ký và Overview |

Giới hạn: HTTP integration dùng chung connection có serialize để rollback fixture an toàn, không phải stress nhiều transaction ghi độc lập. Kiểm thử unique index thực tế và cơ chế khóa dùng chung bảo vệ tranh chấp. Browser tests dùng API fixture; chưa thao tác toàn luồng trên database sử dụng thật vì migration chưa được chạy. Lịch sử UI giới hạn 50 bản gần nhất; dữ liệu đầy đủ vẫn lưu trong bảng. Cập nhật qua tải lại/nút refresh, không triển khai push nền.

Lệnh PowerShell từ thư mục project:

```powershell
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase4.py --execute --stage C --escalations
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase4.py --execute --stage D
cd frontend
npm run build
npx playwright test --config playwright.escalation.config.ts
```

Ảnh fixture trong `frontend/test-results/escalation-dashboard-*`, `escalation-dialog-*`, `escalation-staff-*`. Số bản ghi sử dụng trước/sau kiểm thử không đổi, mọi schema fixture được rollback; không reset sequence.
