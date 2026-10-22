# Giai đoạn 5 — Kết quả kiểm thử Trợ lý AI Gemini + FAQ

Ngày: 22/10/2026 (Asia/Saigon).

## Trạng thái triển khai

Đã code Backend/React thật: FAQ PostgreSQL, Gemini Developer API qua SDK chính thức, phiên/lịch sử riêng của khách, bản nháp có cấu trúc/chỉnh sửa/hủy, xác nhận tạo phiếu qua service hiện có. Widget chỉ thuộc Khách hàng; không thay Messenger, sidebar, dashboard, phân quyền, SLA hoặc Phương án A. Không có migration, giữ20 bảng/33FK; không thay `.env` thật. Thiếu key/model chỉ503 thao tác AI, Backend còn lại hoạt động.

Đã chạy seed **sau khi người dùng duyệt rõ ràng** thêm30 FAQ. Preview trước30, sau0; transaction và table lock chống seed trùng, không ghi đè/xóa. Các mục CHƯA CHỐT vẫn là chưa xác nhận. Tài liệu gốc còn ghi “bản nháp/chưa duyệt”, xác nhận mới của người dùng chỉ duyệt bộ FAQ làm tri thức, không xác nhận các chính sách thương mại chưa có.

## Mapping Use Case → API → CSDL

Prefix `/api/v1/customer/chatbot`:

| Use Case | API | CSDL / kiểm soát |
| --- | --- | --- |
| Phiên mới / danh sách | POST /sessions, GET /sessions?page= | phien_chat; owner từ cookie,20/trang |
| Xem lịch sử | GET /sessions/{id}?before= | tin_nhan_chatbot;50/trang, owner404 |
| Hỏi đáp | POST /sessions/{id}/messages | FAQ active top4 +8tin gần nhất → Gemini → JSON validator → lưu KHACH/BOT cùng transaction |
| Đồng ý lập nháp / thu thập | POST /sessions/{id}/draft | tin_nhan_chatbot JSON envelope; không INSERT phiếu |
| Hủy nháp | POST /sessions/{id}/draft/cancel | Vô hiệu nháp cũ, không tạo/xóa phiếu |
| Xác nhận | POST /sessions/{id}/confirm | Khóa phien_chat NOWAIT; phieu_ma + ticket/history/SLA + fingerprint trong một transaction |

Không endpoint đăng ký public chatbot hoặc cho staff/manager. GET history/list có auth+role; mọi POST giữ Origin/CSRF hiện hành. Mã BIGINT trả string, không tin ID khách/role/priority/assignee/SLA từ client/AI. Model không được cấp tools/SQL/API nội bộ.

## Kết quả đã chạy

| Kiểm tra | Trạng thái | Phương pháp / bằng chứng |
| --- | --- | --- |
| Metadata3bảng chatbot và FAQ | PASS | SELECT metadata thật khớp SQL tham chiếu: đúng cột, senderKHACH/BOT, liên kếtphieu_ma; FAQ ban đầu0 |
| Seed đã duyệt | PASS | `scripts/seed_phase5_faq.py --apply --approved` thêm30; previewlại0; không sửaFAQcũ/schema |
| Dependency / SDK tương thích | PASS | google-genai1.75.0/Python3.13/Pydantic2.14.1; HttpOptions20s/retry1; `pip check` không lỗi; requirements pin websockets16.1.1 theoSDK<17 |
| Unit auth/danh mục/Gemini | PASS20/20 | unittest; SDK Google thật serialize request qua HTTP MockTransport (không Internet), schemaJSON và khôngtools; chỉ GEMINI_KEY/GEMINI_MODEL, không fallback GOOGLE_API_KEY/model |
| Phiên, lịch sử, BOLA/role/auth/CSRF | PASS | `scripts/test_phase5.py --execute`: SQL/auth/cookie thật, customer khác404, staff/manager403, anonymous401, thiếuCSRF403; payloadextra/chuỗidài/secret422 |
| FAQ/ngữ cảnh/provider | PASS | ChỉFAQactive trong top4, inactivefixturekhônggửi; tối đa8tin; configthiếu503 khônglưutinhaytrảAIgiả; key/model/timeout/configSDK đượcassert bằngproviderdouble |
| Nháp và xác nhận | PASS | HỏiFAQchưatạo nháp/phiếu; cầnđồngý; sửa3trường dùngđúng; MOI, khôngphâncông,1history; replaycùngbody trảcùngphiếu; khácbody409; phiênđãgửi chỉđọc |
| Cancel/lỗiAI/transaction | PASS | Nháp hủy409, loại0→null vàyêucầuchọn; quota429, timeout504, JSONsai/extraJSON502; không ghi nửa cặp, không lộprovidererror/key; chènlỗihistoryrollbackticket+link |
| Rate/history paging | PASS | Ngưỡng8/phút;50tintrangđầu vàcursorcũ; trả nguồnFAQ thamkhảo, khônglộmetadata fingerprint |
| Race xác nhận độc lập | PASS | `scripts/test_phase5_race.py --execute`: haiDBconnection; winner200, concurrent409, retry200/replayed; chínhxác1ticket/1history/1link; cleanupđúngfixtureID và counts khôiphục |
| UI desktop/mobile Light/Dark | PASS2/2 | Playwright thực qua FastAPI/DBfixture, chỉ outboundGemini mock: widget/phiên mới/gửiEnter1POST/lịch sử/cancel/chỉnhsửa/xácnhận/linkchitiết/reload; không tràn; đã xem ảnh render |
| Build | PASS | `npm.cmd run build`: TypeScript/Vite thành công |
| Lifecycle từ chatbot | PASS | Phiếu chatbot xác nhận → staff tiếp nhận cùng ID → trả lời công khai/nội bộ → giải quyết → khách đóng/đánh giá một lần; ghi chú nội bộ không xuất hiện trong lịch sử chatbot |
| Hồi quy Giai đoạn 2–4 | PASS | API đầy đủ A–E của phase2/phase3; phase4 A–E và 2/2 browser desktop/mobile; giữ phân quyền, routing, Phương án A, SLA, báo cáo và lifecycle |
| Hồi quy Messenger/tệp/theme | PASS2/2 browser + API | test_ux stageE: tin công khai/nội bộ, polling/scroll, upload/preview/download/BOLA, chuyển nhân viên, theme/SLA và đóng/đánh giá |
| Health / Swagger / FAQ cuối | PASS | /health/db200: DB_HELPDESK/helpdesk,20bảng/33FK; /docs200; FAQ30/30active,6path/7thao tácAPI chatbot |

Các lỗi phát hiện đã sửa và chạy lại: liên kết label ô mô tả bản nháp; vùng form cần cuộn cùng hội thoại để không ép composer ra khỏi khung mobile. API lỗi không sinh câu trả lời giả, không tự đổi model.

Kết quả lượt cuối: **20 unit PASS, 6 browser PASS, integration PostgreSQL/race PASS, build/pip check PASS**. Gemini thật **CHƯA CHẠY**; không đánh đồng provider double với kiểm thử AI trực tiếp.

## Môi trường và cô lập test

Integration/API/browser dùng fixture ngẫu nhiên và transaction force_rollback; SQL, Argon2, cookie, CSRF, upload/nghiệp vụ cũ và React thật. Chỉ `google.genai.Client` tại biên provider được thay bằng double có kiểm soát. Unit SDK dùng MockTransport của httpx để xác minh chính SDK serialize schema/config mà không gửi mạng. Test báo rõ provider trả lời fixture, không dùng đây làm bằng chứng chất lượng AI thật.

Race dùng tài khoản/nhóm/loại/phiên riêng có tên fixture, commit tạm để hai kết nối nhìn thấy; không thành viên nhóm sử dụng. Cuối test xóa đúngIDfixture, kiểm traemailkhớp trước xóa account, khôi phục counts. Không reset sequence; identity có thể tăng. Không xóa tài khoản/phiếu sử dụng. Dữ liệu cấu hình duy nhất được thêm thật là30FAQ đã được người dùng duyệt.

## CHƯA CHẠY / giới hạn

- **Gemini API thật: CHƯA CHẠY.** Không gọi dịch vụ thật ở bất kỳ automatedtest nào; người dùng tự cấu hình GEMINI_KEY/GEMINI_MODEL trong `.env`, khởi động lại Backend và chạy10–15hộithoại tiếngViệt theo README. Chưa xác nhận khả năng/hạnmức của model/key người dùng chọn hoặc chất lượng semantic/chống hallucination thực tế. Model cần hỗ trợ JSON Structured Outputs; lỗi trả thânthiện, không tự fallback.
- Không thể bảo đảm tuyệt đối AI không hallucinate chỉ bằng prompt/schema. Systeminstruction giới hạn nguồn FAQ và POL chưachốt, UI luôn cảnh báo chưaxácnhận; cần người phụ trách duyệt câu trảlời thực tế trước sửdụngproduction. Không tra cứu đơn hàng/kho/giá/lịch giao hoặc dữ liệu phiếu nhân viên.
- Idempotency bền vững **một phiên/một phiếu**, tận dụng phien_chat.phieu_ma hiện hữu, không cần migration. Không dedup hai phiên độc lập hoặc form truyền thống. Request đồngthời409 cần tải lạilịchsử/retry cùngbody, nội dungkhác409.
- Rate limiter per-process, không phân tán. Gọi Gemini giữ transaction và lock dòngphiên đến20s để serialize/lưu cặp; có thể làm thao tác quản lý tài khoản chờ đọc/khóauser trong thời gian này. Chưa có hàngđợi nền, streaming hoặc loadtest nhiềuworker.
- Chỉnh sửa bản nháp được giữ khi request lỗi trong khung đang mở; chưa tự lưu các chỉnh sửa chưa xác nhận qua lần tải lại trang. Lịch sử lưu bản đề xuất AI và kết quả phiếu đã xác nhận.
- Chưa có policyretention/xóa hội thoại, anonymouschat, UIquảntrịFAQ, gửiảnhchoAI, WebSocket, embedding/vectorDB. Tệp bổ sung theo API phiếu hiện tại, không quaGemini.
- Chưa chạy Firefox/WebKit, thiết bịthật, productionHTTPS, fullaccessibility hoặc tải lớn. Mobile là Chromium emulation.

## File mới/sửa

- Mới Backend: `schemas/chatbot.py`, `services/{faq_service.py,gemini_service.py,chatbot_service.py}`, `api/routes/chatbot.py`.
- Sửa Backend: `main.py` đăng kýrouter; `services/customer_service.py` tách helper tạo phiếu dùng chung cur/transaction, APIcũ giữ nguyên; `requirements.txt`, `.env.example` (không secret/model mẫu).
- Mới Frontend: `frontend/src/chatbot/{Widget.tsx,styles.css}`; sửa `frontend/src/customer/Layout.tsx` chỉ gắnwidget. Không đổi theme/sidebar/dashboard khác.
- Scripts/test: `scripts/{seed_phase5_faq.py,test_phase5.py,test_phase5_race.py}`, `tests/test_gemini.py`, `frontend/playwright.phase5.config.ts`, `frontend/phase5-tests/chatbot.spec.ts`.
- Tài liệu: README và báo cáo này. Hai tài liệu nghiệp vụ gốc giữ nguyên.

Nguồn SDK chính thức: [Google Gen AI Python SDK](https://googleapis.github.io/python-genai/). Hướng dẫnWindows, endpoint và luồng sửdụng trong README mụcGiaiđoạn5.
