# Kiểm tra cập nhật giao diện Nhân viên — 02/11/2026

## TS2882: nguyên nhân và cách sửa

CSS tồn tại tại `frontend/src/staff/styles.css`. Import thực tế trên đĩa tại `App.tsx:9` đã là `./staff/styles.css`, đúng theo vị trí file; `../src/staff/styles.css` người dùng nêu cũng quy về cùng thư mục nhưng dư bước. Không sửa thành đường dẫn khác hoặc xóa import.

Project dùng một `frontend/tsconfig.json`, include `src` và `vite.config.ts`. Không có `tsconfig.app.json`/`tsconfig.node.json`, không cần tạo chúng. Thiếu `src/vite-env.d.ts` và chưa nạp `vite/client`, nên compiler không có các khai báo module CSS/asset của Vite. TypeScript cục bộ5.9.3 với `--noUncheckedSideEffectImports` tái hiện6 lỗi thiếu module/type ở App, main, chat và chatbot. Sau thêm đúng một dòng chuẩn `/// <reference types="vite/client" />`, kiểm tra này PASS. Không thêm `declare module '*.css'` tự viết, không nới tsconfig hoặc tắt kiểm tra.

## Tương thích và chỉnh sửa tối thiểu

- Menu thực tế trong StaffLayout đã gộp chờ tiếp nhận/đề xuất và ẩn mục Phiếu trong nhóm; class `staff-dashboard` đã có. Giữ nguyên file này.
- Route cũ `/staff/recommended` đã chuyển `/staff/queue`, `/staff/team` đã chuyển `/staff/mine`. Giữ redirect/route guard; thêm key queue/mine để không mang trang/bộ lọc/dữ liệu cũ sang scope mới.
- Trong StaffTickets, thêm phiên bản request để phản hồi tải cũ không ghi đè lần lọc/tải mới; vô hiệu kết quả cũ khi effect kết thúc. Giữ nguyên URL/params/body và API tiếp nhận.
- Lỗi tiếp nhận409 trước đây bị `load()` xóa ngay. Đổi thứ tự: tải lại danh sách, sau đó giữ thông báo lỗi tiếp nhận cho người dùng.
- Nút Lọc chiếm hai ô ở grid4/2cột và một hàng ở mobile; cân đối hai trường ngày với nút lọc, không tạo cột ngầm/tràn ngang.
- Account đã nằm trên ba thẻ thống kê; số assigned/queue/recommended/overdue giữ nguyên dữ liệu từ API. Badge trạng thái sáu mã khớp CSS; Xem phiếu dùng cùng primary teal với Lọc phiếu. Panel bảng có khung cuộn cố định và phân trang bên trong.
- Import/export/props/route types được kiểm tra toàn bộ bằng TypeScript. API dùng đúng staffApi prefix `/api/v1/staff`: overview, tickets với scope queue/mine và search/type/status/priority/from/to/page, catalogs, POST accept. Không sửa API/backend.
- CSS mới có tên/ancestor staff riêng; các selector shared cũ còn được Manager dùng nên không đổi hàng loạt. Kiểm tra nền card/layout Customer/Manager riêng ở hai theme để tránh recolor ngoài phạm vi. Không đổi components.tsx/Overview.tsx vì không phát hiện lỗi cần sửa.

## File thay đổi

1. `frontend/src/vite-env.d.ts` — khai báo client chuẩn Vite.
2. `frontend/src/App.tsx` — key cho hai instance danh sách theo scope.
3. `frontend/src/staff/Tickets.tsx` — bỏ phản hồi stale, giữ lỗi tiếp nhận sau refresh.
4. `frontend/src/staff/styles.css` — nút lọc cân đối theo responsive grid.
5. `frontend/playwright.staff-ui.config.ts`, `frontend/staff-ui-tests/staff.spec.ts` — smoke riêng với API fixture chỉ ở test.
6. Báo cáo này.

## Kiểm thử

| Kiểm tra | Kết quả |
| --- | --- |
| `npm.cmd run build` trong frontend | PASS, TypeScript và Vite production build thành công |
| `node node_modules/typescript/bin/tsc --noEmit --noUncheckedSideEffectImports` | PASS, trước sửa có6 lỗiCSS, sau sửa0 lỗi |
| Smoke18ca desktop/mobile | PASS18/18: ba trang Sáng/Tối; menu/nhãn ưu tiên; redirect cũ; đúng params lọc; reset theo scope; phản hồi stale; tiếp nhận/CSRF request và giữ lỗi409; panel cuộn/phân trang; màu badge/nút; account trên stats; Customer/Manager không recolor và không tràn ngang |

```powershell
Set-Location frontend
npm.cmd run build
node node_modules/typescript/bin/tsc --noEmit --noUncheckedSideEffectImports
npx.cmd --no-install playwright test --config playwright.staff-ui.config.ts
```

Smoke chạy Vite5175 và Chromium/iPhone13 emulation, request API được fixture tại browser; không kết nối Backend/PostgreSQL hoặc Gemini, không giả kết quả nghiệp vụ thật ngoài test. Phạm vi:3route ×2theme ×2viewport, redirect và filter/reset/race/accept/409 mỗi viewport, Customer/Manager mỗi viewport. Không có script lint trong package.json. Không tuyên bố kiểm thử Backend/đăng nhập thật/phân công thật trong lần sửa Frontend này.

Giữ nguyên Backend, CSDL, `.env`, chatbot, login/logout và quy tắc tiếp nhận. Nếu VS Code giữ diagnostic cũ sau khi tệp mới được tạo, dùng **TypeScript: Restart TS Server**; có thể chọn **Use Workspace Version (5.9.3)**. Chưa thử Firefox/WebKit hoặc điện thoại vật lý; ảnh render và mobile là Chromium emulation.
