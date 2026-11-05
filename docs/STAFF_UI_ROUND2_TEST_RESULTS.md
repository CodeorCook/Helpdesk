# Hoàn thiện giao diện Nhân viên — Đợt 2, 02/11/2026

## Nguyên nhân và thay đổi

**Lập phiếu thay khách:** panel tìm kiếm là `.panel` rộng toàn bộ vùng nội dung, còn form dùng `.customer-form` chung có `max-width:860px`. Hai panel vì vậy lệch cạnh phải. Thêm wrapper `staff-new-page` và override có scope Staff để cả hai panel cùng rộng100%, không sửa shared Customer/Manager. Fieldset2cột desktop,1cột mobile; tiêu đề/mô tả/khách hàng/tệp và nút chiếm hàng đầy đủ. Dùng các token hiện hữu cho hai theme.

Chức năng được hoàn thiện: tìm khách bằng Enter/nút tìm theo API hiện có, bỏ kết quả đến trễ và reset lựa chọn khi đổi nội dung tìm; chỉ chọn người trong kết quả API (server vẫn kiểm tra khách hoạt động khi tạo). Có trạng thái không tìm thấy. Bắt buộc chọn khách, tiêu đề/loại/ưu tiên/mô tả; kiểm tra cả chuỗi chỉ có khoảng trắng. Khóa ref đồng bộ ngăn hai submit trong cùng lượt event, disable fieldset khi đang gửi. Khi API lỗi giữ form và báo rõ; nếu upload lỗi sau khi tạo vẫn hiển thị biên nhận, không quay lại tạo trùng. Chỉ hiện link chi tiết sau khi GET chi tiết hiện có thành công; ngoài quyền hoặc chưa xác minh được thì giữ biên nhận và đường về hàng đợi. Không giả quyền của người lập phiếu.

**Tổng quan:** bỏ nút Làm mới, vẫn giữ `useEffect` tải GET overview khi vào trang và trạng thái tải. Panel tài khoản, ba thẻ màu và số liệu/backend giữ nguyên.

**Phiếu của tôi:** Backend đã hỗ trợ `page_size` từ1đến50, mặc định10. Chỉ scope=mine gửi `page_size=5` cùng page/bộ lọc. Không cắt mảng Frontend, không đổi staffApi hoặc Backend. Queue không gửi page_size nên vẫn mặc định10. Điều kiện lọc được giữ khi đổi trang, apply filter đặt page1. Footer dựa vào total/page_size thật của response. Chỉ mine thêm class riêng: height:auto, min-height330px desktop/240px mobile; chứa cuộn ngang nếu cần, không ép khung gây cuộn dọc riêng. Thử thực tế scrollHeight/clientHeight xác nhận không có cuộn dọc nội bộ với5hàng. Status màu, nút teal và footer trong panel giữ nguyên.

## File chỉnh sửa

- `frontend/src/staff/NewTicket.tsx`
- `frontend/src/staff/Overview.tsx`
- `frontend/src/staff/Tickets.tsx`
- `frontend/src/staff/styles.css`
- `frontend/staff-ui-tests/staff.spec.ts` (mở rộng fixture/test từ18lên30ca)
- Báo cáo này.

Đã đọc nhưng không cần sửa `frontend/src/staff/api.ts`, API route/service staff và shared FileInput/components. Không sửa Backend/schema/`.env`/Gemini hoặc giao diện Khách hàng/Quản lý.

## Kết quả kiểm thử

| Nhóm | Kết quả | Bằng chứng |
| --- | --- | --- |
| Build | PASS | `npm.cmd run build` lượt cuối, TypeScript/Vite thành công |
| TypeScript strict side-effect imports | PASS | `node node_modules/typescript/bin/tsc --noEmit --noUncheckedSideEffectImports`, không phát sinh lỗi |
| UI desktop/mobile, Light/Dark | PASS30/30 | `npx.cmd --no-install playwright test --config playwright.staff-ui.config.ts`; API fixture trong browser, không giả dữ liệu nghiệp vụ trong app |
| Form bằng nhau / responsive | PASS | Đo x,width hai panel trùng nhau; đo vị trí controls xác nhận2cột desktop/1cột mobile; không tràn ngang; ảnh Light desktop/Dark mobile đã xem |
| Form chức năng / validation | PASS | Lookup tên/email đầy đủ/ID; rỗng không thể tạo; whitespace bị chặn; API503 giữ trường; submit2lần chỉ1request chấp nhận; đúng body/CSRF; biên nhận và link theo quyền |
| Tệp / quyền xem | PASS UI | Quá5MiB chặn trước POST; lỗi415upload sau khi tạo vẫn giữ biên nhận, chỉ1POST tạo; GET chi tiết không được phép thì không hiện link |
| Phân trang | PASS UI | 0phiếu empty/bothdisabled;6phiếu5+1;12phiếu5+5+2; không trùng ID; total/trang/nút đúng; filter mới về1, chuyển trang giữ query; Queue10không page_size override |
| Tổng quan và scope khác | PASS UI | Không còn nút Làm mới trên overview, vẫn gọi API; tài khoản trên stats; queue và các menu/redirect vẫn chạy; Customer/Manager nền/layout không bị đổi |
| API/PostgreSQL thật + browser thật | PASS API A–E +2/2browser | Harness sẵn có `scripts/test_phase3.py --execute --stage E --browser`: login staff hợp lệ → tiếp nhận/phản hồi/tệp/giải quyết → khách đóng/đánh giá → tìm khách thật theo ID → lập phiếu thay khách bằng form mới; API tạo đúng một phiếu nguồnNHAN_VIEN, người lập thật, chưa phân công |
| Dọn fixture | PASS | Harness dùng transaction force_rollback và TemporaryDirectory; counts trước/sau không đổi, không reset sequence; không để lại tài khoản/phiếu/file thử |

Các ca UI mới dùng dữ liệu cô lập tại Playwright, chỉ để kiểm tra giao diện, payload và phản ứng với lỗi. Không dùng chúng làm bằng chứng Backend đã ghi thành công. Bằng chứng ghi SQL/nghiệp vụ thật là harness Phase3 riêng nói trên. Harness không thay mã Backend, không migrate/seed dữ liệu sử dụng và không gọi Gemini.

Trong lượt đầu, phép đếm chuỗi `grid-template-columns` của test hiểu nhầm computed value `repeat(2, minmax(...))` ở fieldset thành3cột. Đã sửa test đo vị trí controls thực tế; không thay CSS đúng để làm theo phép đếm sai. Lượt cuối30/30PASS.

## Chạy lại trên Windows PowerShell

```powershell
# Tại frontend
npm.cmd run build
node node_modules/typescript/bin/tsc --noEmit --noUncheckedSideEffectImports
npx.cmd --no-install playwright test --config playwright.staff-ui.config.ts
# Trở về thư mục gốc; fixture thật rollback, Backend8001/Vite5174 tạm
Set-Location ..
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase3.py --execute --stage E --browser
```

## Giới hạn

Không có idempotency bền vững mới cho API staff tạo phiếu: khóa phía client chặn double-click/in-flight; nếu mất kết nối sau khi server có thể đã commit, cần kiểm tra danh sách trước khi gửi lại, UI có thông báo. Không thêm schema/endpoint để thay đổi việc này. Tìm khách giữ ngưỡng ít nhất2ký tự của API hiện có. Xem chi tiết phụ thuộc nhóm/quyền, không chỉ vì đã lập phiếu. Chưa thử Firefox/WebKit/thiết bị vật lý hoặc triển khai production; mobile là Chromium emulation. Không có lỗi chưa xử lý trong các ca đã chạy.
