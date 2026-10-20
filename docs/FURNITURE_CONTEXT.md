# Điều chỉnh ngữ cảnh công ty nội thất

Tên đề tài giữ nguyên **Hệ thống quản lý hỗ trợ khách hàng (Helpdesk)**. Phạm vi áp dụng là công ty giả định kinh doanh và cung cấp dịch vụ nội thất; không phải ERP/CRM bán hàng/thương mại điện tử. Không thêm module kho/sản phẩm/đơn hàng/bảo hành, actor, bảng hoặc endpoint.

## Kiểm tra dữ liệu ngày 20/10/2026

`helpdesk.loai_ho_tro`: `ht_ma` BIGINT identity, PRIMARY KEY; `ten` VARCHAR NOT NULL UNIQUE; `mo_ta` TEXT tùy chọn; `dang_hoat_dong` BOOLEAN NOT NULL, mặc định true.

Hai bảng tham chiếu: `phieu_ho_tro.ht_ma` (ON DELETE SET NULL) và `xu_ly_mac_dinh.ht_ma` (ON DELETE CASCADE). Không thực hiện DELETE. Cả 5 mục hiện tại chưa có phiếu tham chiếu và chưa có cấu hình xử lý mặc định tham chiếu.

| ID hiện có | Tên hiện tại | Đề xuất |
| --- | --- | --- |
| 1 | Tài khoản | Giữ bản ghi, dang_hoat_dong=false |
| 2 | Kỹ thuật | Giữ bản ghi, dang_hoat_dong=false |
| 3 | Thanh toán | Giữ ID, đổi thành Thanh toán và hóa đơn, cập nhật mô tả |
| 4 | Khiếu nại | Giữ ID, đổi thành Khiếu nại chất lượng, cập nhật mô tả |
| 5 | Khác | Giữ bản ghi, dang_hoat_dong=false |

Thêm 6 mục bằng ID do PostgreSQL sinh: Tư vấn sản phẩm nội thất; Hỗ trợ đơn hàng; Giao hàng và lắp đặt; Bảo hành sản phẩm; Sửa chữa và bảo trì; Đổi trả sản phẩm. Kết quả dự kiến: 8 loại hoạt động, 3 bản ghi cũ không hoạt động; không đổi ID hoặc cập nhật bất kỳ phiếu/tài khoản/cấu hình phân nhóm nào.

## Script xem trước và cập nhật

`scripts/update_furniture_catalog.py` mặc định chỉ đọc. Cần duyệt rõ phương án trên trước khi ghi, theo quy định bảo vệ dữ liệu đã đặt ở Giai đoạn 2.

```powershell
.\.venv\Scripts\python.exe -X utf8 scripts/update_furniture_catalog.py
```

Preview đầu tiên có plan SHA-256: `6131e7be7544da55078e9c1c50d139581355c2ee75c65ed4465f93702df20a00`. Nếu không còn thao tác cần áp dụng, chạy lại lệnh thực thi cũng thoát thành công mà không ghi dữ liệu, kể cả dùng lại SHA của plan đã duyệt; nếu còn thay đổi thì bắt buộc khớp SHA để tránh áp dụng plan cũ.

Sau khi được duyệt, thực thi bằng `--execute --expect-plan <SHA-256 trong preview đã duyệt>`. Script kiểm tra lại đúng database/schema; khóa ngắn các bảng danh mục và tham chiếu, timeout 3 giây; từ chối nếu snapshot/ảnh hưởng thay đổi so với preview. Mọi thay đổi cùng transaction, hậu kiểm không còn thao tác cần áp dụng trước khi commit. Chạy lại preview sau thành công phải có operations rỗng; không tạo trùng và không reset identity. Không tự đổi nhãn mục cũ đã có phiếu hoặc cấu hình tham chiếu: khi lập plan mới, sẽ giữ mục đó và đề xuất thêm mục mới.

Đã được người dùng phê duyệt rõ ràng và thực thi đúng plan trên. Hậu kiểm: 8 loại hoạt động; ID 3/4 được giữ nguyên; các loại thêm mới có ID 6–11; ID 1/2/5 còn nguyên và không hoạt động. Preview sau cập nhật trả `operations: []`, chứng minh lần chạy kế tiếp không còn thay đổi cần áp dụng. Không chạy SQL khởi tạo.

## Nội dung giao diện

- Trang chủ: mô tả công ty nội thất, ví dụ phiếu giao/lắp bàn ăn, bảo hành sofa, bảo quản tủ gỗ; các ví dụ vẫn gắn nhãn minh họa.
- Tạo phiếu: hướng dẫn cung cấp tên sản phẩm, mã đơn hàng/hóa đơn nếu có, vấn đề giao nhận/lắp đặt/chất lượng; đây là nội dung tự do trong phiếu hiện có, không thêm trường hoặc module quản lý đơn hàng.
- FAQ: thêm hướng dẫn bảo hành/đổi trả, chỉ yêu cầu thông tin nếu có; không hứa tự động chấp thuận hay đặt chính sách bảo hành/đổi trả giả định.
- Giữ tên đề tài, ba vai trò, layout, Inter, Primary #0D9DA4, Accent #FCE688. Không sửa CSS, endpoint, nghiệp vụ xác thực hoặc luồng phiếu Giai đoạn 1–2.

## Kiểm thử đã chạy

| Kiểm tra | Kết quả |
| --- | --- |
| 4 unit test plan danh mục | PASS: giữ ID, không DELETE, không đổi nhãn mục đã có tham chiếu, phát hiện snapshot đổi và plan sau cập nhật rỗng |
| Áp dụng plan được duyệt | PASS: commit 6 mục mới, cập nhật 2 mục, ngừng chọn mới 3 mục cũ |
| Chạy lại cùng lệnh --execute và SHA đã duyệt | PASS: thoát 0, operations rỗng, không ghi thêm dữ liệu |
| npm run build | PASS: TypeScript + Vite |
| Smoke Chromium desktop/mobile | PASS: 6 test (4 luồng Khách hàng Giai đoạn 2 + 2 smoke nội thất) |
| Smoke nội thất | PASS: Trang chủ/nhãn minh họa, FAQ bảo hành/đổi trả, đăng nhập thật, dropdown đúng 8 loại từ PostgreSQL, hướng dẫn tạo phiếu, không tràn ngang |
| API PostgreSQL A→E | PASS: đăng ký/đăng nhập, tạo/tra cứu/chủ sở hữu, tin nhắn/tệp, hồ sơ/đóng/đánh giá; dữ liệu thử rollback và file tạm được dọn |
| Health | PASS: HTTP 200, DB_HELPDESK/schema helpdesk, 20 bảng/33 khóa ngoại |
| Kiểm tra render | PASS: đã xem ảnh Trang chủ desktop và Tạo phiếu mobile |
| py_compile và git diff --check | PASS |

Lần preview đầu có lỗi do cấu hình read_only được đặt sau khi mở transaction; đã sửa thứ tự, chạy lại preview thành công trước khi xin duyệt/thực thi. Không có dữ liệu được ghi trong lần preview lỗi.

Không có lỗi chặn còn lại. Các smoke dùng transaction rollback, không tạo dữ liệu minh họa được hiểu là dữ liệu thật. Chưa stress test tranh chấp khóa đồng thời; script có timeout khóa và đối chiếu SHA snapshot để dừng an toàn khi có thay đổi chưa được duyệt. SQL tham chiếu khởi tạo được giữ nguyên như tài liệu lịch sử; không chạy lại để đưa danh mục cũ vào database hiện tại.

File thêm/sửa trong lần này: `frontend/src/pages/Home.tsx`, `frontend/src/customer/NewTicket.tsx`, `scripts/update_furniture_catalog.py`, `tests/test_furniture_catalog.py`, `frontend/phase2-tests/furniture.spec.ts`, `README.md`, tài liệu này.
