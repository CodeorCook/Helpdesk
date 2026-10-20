# Kiểm thử cải tiến UX sau Giai đoạn 4

Ngày chạy: 21/10/2026. Stack/schema giữ nguyên; không migration, chạy SQL khởi tạo, seed cấu hình/tài khoản sử dụng hoặc sửa hạn SLA cũ.

## Phạm vi và mapping

| Chức năng | API / dữ liệu | Thực hiện |
| --- | --- | --- |
| Hội thoại theo phiếu | GET `/api/v1/{customer,staff,manager}/tickets/{id}/conversation` | DTO riêng; 100 tin/lần, cursor before/after; tin_nhan; trạng thái và phân công từ lịch sử thật |
| Gửi công khai / nội bộ | POST messages hiện có; tin_nhan | Hai tab nhân viên, draft riêng; ghi chú lọc phía Backend trước cả phân trang customer |
| Người phụ trách / sự kiện tiếp nhận | phieu_ho_tro, lich_su_phan_cong, lich_su_trang_thai | Không tạo cuộc hội thoại hoặc phiếu mới, giữ lịch sử khi chuyển nhân viên/nhóm |
| Tệp / xem ảnh | POST/GET attachments hiện có; GET `.../attachments/{id}/preview`; tep_dinh_kem | Metadata tên gốc, dung lượng, ảnh PNG/JPEG xác thực; kiểm tra nội dung, đường dẫn an toàn và ownership; preview no-store |
| Sidebar / logo | Layout ba vai trò | Logo về dashboard vai trò, bỏ Về trang chủ trong sidebar, logout cuối |
| Sáng / Tối / Theo hệ thống | CSS tokens; `helpdesk-theme` | Chỉ lưu tùy chọn giao diện, áp trước React/CSS; không lưu token hoặc dữ liệu nghiệp vụ |
| Hướng dẫn / validation SLA | POST/PATCH manager/sla hiện có; chinh_sach_sla | Theo ưu tiên, xử lý ≥ phản hồi, lỗi tại form, hiển thị phút/giờ/ngày; server validation giữ nguyên |

## Kết quả đã chạy

| Kiểm tra | Kết quả | Bằng chứng / cách chạy |
| --- | --- | --- |
| A: quyền owner/role, tiếp nhận/chuyển người, public/private, phân trang | PASS | `scripts/test_ux.py --execute --stage E --browser`: PostgreSQL thật, cookie thật; customer khác404, role khác403; public cursor không trả ghi chú; trang đầu100 + trang cũ, ghép ID duy nhất |
| B: tên Unicode, kích thước/người tải, preview và download | PASS | PNG thật byte-for-byte; customer khác404, manager có quyền; TXT preview415 nhưng tải đúng; traversal/fakePNG bị chặn; fallback khi metadata chỉ còn key ngẫu nhiên |
| C: sidebar/logo ba vai trò | PASS | Playwright desktop và mobile; logo về /customer, /staff, /manager; không có Home sidebar, logout trong footer |
| D: ba theme, lưu/reload/system media | PASS | Desktop Chromium + iPhone13 Chromium emulation; kiểm tra computed color sidebar/chat, reload giữ Tối, đổi system media đổi theme; localStorage chỉ helpdesk-theme; ảnh chat và SLA tối đã xem |
| A–E: chat thực trên desktop/mobile | PASS, 2/2 | Enter hai lần chỉ một POST/một bubble; ShiftEnter xuống dòng; polling hiện tin mới/tiếp nhận, giữ vị trí đọc cũ và báo tin mới; ẩn tab5500ms không request; ảnh dialog/download đúng tên; chuyển nhân viên vẫn giữ tin; giải quyết→đóng→đánh giá một lần; chat chuyển chỉ đọc |
| E: SLA client/server | PASS | Client 120/60 lỗi inline, không POST; sửa1440 hết lỗi, hiển thị 1ngày/24giờ. Server422 trước INSERT, số policy không đổi; customer403. Form không tự lưu hoặc tạo mẫu |
| Unit auth/danh mục | PASS, 17/17 | `.venv/Scripts/python.exe -m unittest discover -s tests -v`; auth dùng repository double, không lấy đây làm bằng chứng PostgreSQL login |
| PostgreSQL hồi quy Giai đoạn 2 | PASS A–E | `scripts/test_phase2.py --execute --stage E`: đăng ký/hash/role injection, CSRF, tạo phiếu/history nguyên tử, BOLA/filter/SQL injection, tệp, hồ sơ/đóng/rating |
| PostgreSQL hồi quy Giai đoạn 3 | PASS A–E | `scripts/test_phase3.py --execute --stage E`: đề xuất không tự giao, cùng ID/409, quyền nhóm, chuyển/lịch sử/rollback, public/private, SLA và lifecycle |
| PostgreSQL hồi quy Giai đoạn 4 | PASS A–E | `scripts/test_phase4.py --execute --stage E`: nhân viên+profile, khóa phiên, nhóm/routing, phân công nguyên tử, SLA theo ưu tiên/không sửa hạn cũ, dashboard/report thật |
| Frontend build | PASS | `npm.cmd run build`, TypeScript/Vite thành công, không còn cảnh báo cú pháp CSS |
| Hồi quy trình duyệt Quản lý / Nhân viên / công khai | PASS, 2 + 2 + 6 | Phase4 và phase3 desktop/mobile; Trang chủ/FAQ/CTA/login/404/protected routes và responsive |
| Hồi quy trình duyệt Khách hàng | PASS, 6/6 | Đăng ký/login/tạo phiếu/chat/tệp/hồ sơ/logout; đóng/đánh giá; Trang chủ nội thất và danh mục thật trên desktop/mobile |
| Hồi quy auth PostgreSQL trình duyệt | PASS, 6/6 | Ba vai trò trên desktop/mobile: login/dashboard/forbidden route/logout; API sai password/unknown/locked/expired, rollback xác nhận |

Các smoke đã bắt và sửa: feed chưa đổi ngay khi nhân viên vừa tiếp nhận; thông báo SLA còn giữ sau khi người dùng sửa giá trị hợp lệ; lỗi thay thế token CSS ảnh hưởng white-space. Test cuối ở trên đã chạy lại sau sửa. Một smoke hồi quy Nhân viên dùng selector Tiếp nhận quá rộng trước khi bộ lọc tải xong, đã sửa test chờ đúng bảng đã lọc và chọn đúng dòng phiếu; chạy lại2/2 PASS. Một lượt mở tài khoản người nhận trong context nhân viên đang đăng nhập bị redirect, đã sửa harness dùng context riêng; không nới quyền hoặc giả login để làm test PASS.

Tổng lượt cuối: **24/24 browser PASS**, **17/17 unit PASS**, build PASS và API PostgreSQL Giai đoạn1–4/UX PASS. Không còn FAIL chưa xử lý trong phạm vi kiểm thử đã chạy.

## Cô lập dữ liệu và giới hạn

Harness UX và các harness integration dùng transaction force_rollback + connection factory có khóa, SQL/API/hash/upload/giao diện thật; không giả phản hồi thành công. Tệp và audit test trong TemporaryDirectory. Cuối mỗi harness kiểm tra số bản ghi không đổi; identity sequence có thể tăng, không reset. Không chạy đồng thời các harness dùng port8001/5174; advisory lock transaction có thể làm các harness chờ nhau nên chạy tuần tự.

CHƯA CHẠY: Firefox/WebKit, điện thoại vật lý, production HTTPS, tải lớn/nhiều worker, kiểm tra hỗ trợ tiếp cận toàn diện. Mobile là emulation. Polling request/response 5 giây, không WebSocket/push; dừng khi phiếu không còn tương tác, người dùng có nút Làm mới. Không read receipt, chỉ báo đang nhập, nhắn mạng xã hội hoặc chatbot. Không tự retry POST khi mất mạng vì có thể đã lưu; UI yêu cầu làm mới kiểm tra trước khi gửi lại.

Chỉ xem trước PNG/JPEG qua endpoint kiểm tra quyền; PDF/TXT tải xuống. Tên gốc đã mất trong metadata cũ không thể khôi phục: hiển thị “Tệp đính kèm.ext”. Tệp trên phiếu là công khai cho người có quyền, không hỗ trợ file nội bộ riêng. Quy định giải quyết/đóng chỉ đọc, nhân viên giải quyết và khách đóng/đánh giá giữ nguyên. SLA liên tục24/7 theo mức ưu tiên; không tạo chính sách mẫu hoặc tính lại phiếu cũ.

## File thêm/sửa trong đợt UX

- Backend mới: `schemas/conversation.py`, `services/conversation_service.py`; sửa `api/routes/customer.py`, `staff.py`, `manager.py`, `core/uploads.py`.
- Chat mới: `frontend/src/chat/{Conversation.tsx,useConversation.ts,Attachment.tsx,styles.css}`.
- Theme mới: `frontend/src/theme.tsx`, `theme.css`; sửa `index.html`, `src/main.tsx`, `components.tsx`, `styles.css`.
- Tích hợp màn hình: `src/customer/{Layout.tsx,Detail.tsx,Interaction.tsx,styles.css}`, `src/staff/{Layout.tsx,Detail.tsx,styles.css}`, `src/manager/{Layout.tsx,TicketDetail.tsx,SLA.tsx}`.
- Kiểm thử: `scripts/test_ux.py`, `frontend/playwright.ux.config.ts`, `frontend/ux-tests/ux.spec.ts`; cập nhật selector của phase2/customer, phase3/staff, phase4/manager theo tab/attachment UI mới.
- Tài liệu: README.md và báo cáo này. Không thay biến môi trường hoặc schema.
