# Quy trình Chatbot AI + FAQ và hỗ trợ lập phiếu – Helpdesk nội thất

**Trạng thái:** Đặc tả nghiệp vụ đề xuất v1 để nhóm duyệt trước khi prompt Codex. Không phải xác nhận mã nguồn Giai đoạn 5 đã triển khai.

## I. Phạm vi và giới hạn
- 3 vai trò: KHACH_HANG / NHAN_VIEN / QUAN_TRI_VIEN (hiển thị Quản lý). Chỉ Khách hàng lập phiếu qua chatbot.
- 8 loại hỗ trợ nội thất đã được tạo trong bảng `helpdesk.loai_ho_tro`; tải ID và trạng thái hoạt động từ DB, không tự sinh ID.
- Một phiếu là một bản ghi `phieu_ho_tro` xuyên suốt; không tạo `phieu_yeu_cau` riêng và không tạo phiếu thứ hai khi nhân viên nhận.
- Cơ chế đề xuất nhân viên Phương án A: có nhóm chuyên môn; **chỉ khi nhân viên nhấn Tiếp nhận** mới được phân công.
- Chatbot cung cấp thông tin, trích FAQ được duyệt, đề xuất loại và dự thảo; không quyết định bảo hành/đổi trả, hoàn tiền, giao hàng, ưu tiên, SLA hoặc phân công.
- Thông tin phiên/tin nhắn chatbot khác với tin nhắn công khai giữa khách và nhân viên gắn phiếu; không trộn hai luồng một cách ngầm định.

## II. Luồng chính
1. Người dùng mở widget chatbot ở Trang chủ hoặc không gian Khách hàng; tạo/tiếp tục phiên nếu hợp lệ. Nếu khách chưa đăng nhập, có thể hỏi FAQ chung; lưu trữ lịch sử cá nhân và tạo phiếu chỉ sau khi đăng nhập.
2. Khách đặt câu hỏi. FastAPI tìm tri thức FAQ đã phê duyệt; nếu dùng LLM, cấp **chỉ nội dung được phép**, kèm hướng dẫn không bịa chính sách; trả câu trả lời và đề xuất hành động.
3. Nếu có dấu hiệu muốn được hỗ trợ, hỏi khách có muốn lập phiếu không. Không tự chuyển sang lập phiếu chỉ vì mô tả sự cố.
4. Thu thập thông tin tối thiểu: **tiêu đề**, **mô tả sự cố**, **loại hỗ trợ** hợp lệ. Hỏi bổ sung từng câu cần thiết: sản phẩm liên quan, vấn đề xảy ra thế nào, thời điểm, mã đơn (nếu có), ảnh/tệp (nếu có). Không ép người dùng cung cấp mã đơn nếu không có; không thu thập dữ liệu nhạy cảm thừa.
5. LLM đề xuất bản nháp có cấu trúc; Backend xác minh độ dài, loại hỗ trợ, mọi trường và quyền; không ghi `phieu_ho_tro` ở bước này.
6. Frontend hiển thị **bản nháp có thể chỉnh sửa** và nhãn **CHƯA GỬI**. Người dùng có nút `Chỉnh sửa`, `Hủy`, `Xác nhận tạo phiếu`.
7. Chỉ thao tác xác nhận tường minh từ người dùng đang đăng nhập mới kích hoạt Backend tạo phiếu bằng dịch vụ/nghiệp vụ Giai đoạn 2. Xác nhận cần CSRF và **idempotency key** để tránh lập phiếu đôi khi double click/retry; nếu DB chưa có cơ chế bền vững hỗ trợ khóa idempotency thì Codex phải nêu giới hạn và đề xuất thay đổi có duyệt, không tuyên bố đảm bảo tuyệt đối.
8. Backend tự xác định chủ phiếu từ phiên, trạng thái MOI, ưu tiên mặc định, nguồn hợp lệ theo schema, loại hợp lệ; tạo lịch sử cùng transaction. Không chấp nhận owner/role/status/priority/assignee/SLA do LLM cung cấp.
9. UI hiển thị mã phiếu và đường dẫn `/customer/tickets/:id`. Từ đây phiếu đi theo logic routing nhóm và Phương án A, không tự động phân công.
10. Nếu loại yêu cầu không rõ, hỏi lại hoặc để người dùng chọn từ danh mục; không gán bừa.

## III. Trạng thái hội thoại đề xuất
- `FAQ_CHAT`: hỏi đáp, chưa tạo phiếu.
- `OFFER_DRAFT`: hỏi khách có muốn tạo yêu cầu.
- `COLLECTING`: đang thu thập thông tin còn thiếu.
- `DRAFT_READY`: bản nháp đã hiển thị và có thể sửa.
- `AWAIT_CONFIRMATION`: khách đang cân nhắc xác nhận.
- `SUBMITTING`: đang gọi API lập phiếu; chặn gửi trùng.
- `SUBMITTED`: có mã phiếu thật; chỉ đọc bản nháp đã gửi.
- `CANCELLED`: hủy bản nháp, tiếp tục hỏi đáp nếu muốn.
- `FAILED`: lỗi mạng/đầu vào, giữ bản nháp, cho phép thử lại an toàn.

Các trạng thái này là **logic ứng dụng đề xuất**, không khẳng định CSDL hiện tại đã có cột tương ứng. Trước khi ghi DB, kiểm tra cấu trúc `phien_chat`, `tin_nhan_chatbot` để chọn nơi lưu; migration nếu cần phải xin duyệt.

## IV. Dữ liệu bản nháp đề xuất (không phải API đã tồn tại)
```json
{
  "title": "Yêu cầu bảo hành sofa bị lún đệm",
  "description": "Sofa bị lún phần đệm bên trái, phát hiện gần đây. Khách muốn nhân viên kiểm tra điều kiện bảo hành.",
  "ticket_type_id": "<ID hợp lệ lấy từ API danh mục>",
  "product_name": "Sofa",
  "order_reference": null,
  "incident_time": null,
  "attachment_refs": [],
  "needs_clarification": [],
  "source": "chatbot_draft",
  "confirmed": false
}
```
`product_name/order_reference/incident_time` là **thông tin hội thoại bổ trợ** có thể ghép vào mô tả phiếu; không mặc nhiên có cột tương ứng trong `phieu_ho_tro`. Đầu ra LLM là dữ liệu **không đáng tin cậy**, Backend kiểm tra và lọc trước khi ghi.

## V. Luồng lỗi và trường hợp biên
| Tình huống | Xử lý |
|---|---|
| FAQ không có câu trả lời chắc chắn | Nói rõ chưa có chính sách; hướng dẫn gửi phiếu |
| AI không khả dụng, hết quota, timeout | Trả lời FAQ theo quy tắc nếu có; cho khách dùng form tạo phiếu thường |
| Chưa đăng nhập khi nhấn tạo phiếu | Điều hướng login và chỉ khôi phục bản nháp nếu đủ an toàn; xác nhận lại |
| Người dùng yêu cầu bot tự đổi giá, đổi quyền, đóng phiếu | Từ chối hành động không được phép; chỉ cung cấp luồng hợp lệ |
| LLM đoán sai loại hỗ trợ | Khách sửa trong form; Backend xác thực ID từ DB |
| Hai lần bấm xác nhận/retry mạng | Chặn trong UI và áp idempotency ở Backend khi có cơ chế bền vững |
| Chatbot gửi prompt injection hoặc nội dung từ FAQ chứa chỉ dẫn | FAQ/tin nhắn là dữ liệu, không phải lệnh hệ thống; không thực thi SQL/tool tùy ý |
| Khách A yêu cầu xem phiếu/chat khách B | Trả 404/403 phù hợp; mọi truy vấn phân quyền theo phiên |
| Ảnh/tệp quá kích thước/định dạng | Dùng lại validation/upload/private storage sẵn có, báo lỗi rõ |
| Nhân viên chưa thuộc nhóm phù hợp | Phiếu vẫn chờ, không tự phân công |

## VI. Kiến trúc triển khai đề xuất
```
React Chat Widget
  -> FastAPI chatbot router (auth, rate limit, CSRF đối với mutation)
      -> FAQ retrieval (cau_hoi_mau và tri thức được duyệt)
      -> LLM adapter (API key chỉ ở backend, timeout, giới hạn token/chi phí)
      -> Draft validator (Pydantic + danh mục live DB)
      -> Existing customer ticket service (chỉ sau xác nhận)
  -> PostgreSQL: phien_chat / tin_nhan_chatbot và bảng Helpdesk đã có
```
Không đưa API key về browser. Không đưa tài liệu nội bộ, dữ liệu toàn bộ khách hàng, nhật ký xác thực, mật khẩu, OTP vào prompt LLM. Giới hạn độ dài nội dung, tần suất gọi và chi phí. Gắn nguồn FAQ hoặc nhãn 'chưa được xác minh' cho câu trả lời chính sách.

## VII. Phân chia trách nhiệm
**Codex:** khảo sát schema có liên quan; xây UI/chat API/tích hợp LLM; logic phiên/bản nháp; kiểm thử quyền/CSRF/case lỗi; tích hợp dịch vụ tạo phiếu đang có; tài liệu hóa cấu hình `.env.example`.
**Nhóm đồ án:** duyệt 30 FAQ, chốt chính sách POL01–POL08, chọn nhà cung cấp LLM/ngân sách, tự cấu hình API key, kiểm tra 10–15 hội thoại thật bằng tiếng Việt và phê duyệt cách chatbot xử lý những câu không có chính sách.

## VIII. Bộ ca kiểm thử chấp nhận tối thiểu
1. Hỏi FAQ đã duyệt → đúng nội dung, không tự cam kết thêm.
2. Hỏi ngày giao/giá mà hệ thống không có dữ liệu → nói chưa biết, đề nghị lập phiếu.
3. Khách mô tả sofa lỗi → chatbot phân loại đề xuất Bảo hành sản phẩm, xin thêm thông tin.
4. Khách sửa loại/tiêu đề/mô tả trong bản nháp → dữ liệu được dùng khi xác nhận.
5. Nhấn Hủy → không có phiếu mới.
6. Nhấn Xác nhận một lần → 1 phiếu MOI, có lịch sử, không có nhân viên tự nhận.
7. Nhấn Xác nhận hai lần/retry → không sinh hai phiếu (khi có cơ chế idempotency đã kiểm thử).
8. Chưa đăng nhập → không lập phiếu thật, hướng đăng nhập.
9. Khách A không đọc được lịch sử chat/phiếu của khách B.
10. Nội bộ/ghi chú nhân viên không lộ trong chatbot.
11. LLM API lỗi → vẫn có đường về form tạo phiếu truyền thống.
12. Nhân viên tiếp nhận cùng phiếu và giải quyết → khách đóng/đánh giá qua API cũ.
13. Thử prompt injection yêu cầu bỏ qua quyền → Backend từ chối.
14. Dark mode và mobile chat không tràn/che điều hướng.
15. Tệp đính kèm vẫn kiểm tra MIME/nội dung/kích thước như Giai đoạn 2–4.

## IX. Quyết định cần chốt trước khi bật tính năng thật
- Chọn nhà cung cấp LLM, model, hạn mức và biến môi trường cho secret.
- Chốt POL01–POL08 hoặc đánh dấu rõ **chưa có thông tin**.
- Quyết định khách chưa đăng nhập có được lưu phiên FAQ không; tránh tạo session nhạy cảm ẩn danh không kiểm soát.
- Xác định cơ chế idempotency phù hợp schema hiện tại; phải kiểm chứng nếu muốn bảo đảm chống tạo trùng khi retry.
- Quyết định thời gian lưu hội thoại và quyền xóa/ẩn lịch sử theo yêu cầu dữ liệu của nhóm.
