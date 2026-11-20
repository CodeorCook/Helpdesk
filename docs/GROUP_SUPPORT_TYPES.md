# Nhóm và loại hỗ trợ — kết quả triển khai 19/11/2026

## Hiện trạng được xác minh

Đã đọc metadata PostgreSQL và đối chiếu source. `loai_ho_tro` có 11 loại (8 hoạt động, 3 ngừng). `xu_ly_mac_dinh.ht_ma` là khóa chính, vì vậy một loại chỉ có một nhóm **mặc định**. Popup cũ còn lọc `!group_id && type_active`; tất cả 8 loại hoạt động đã có nhóm mặc định nên nhóm mới không có lựa chọn. Đây là giới hạn cả UI lẫn mô hình định tuyến, không phải thiếu danh mục.

Khóa ngoại `phieu_ho_tro.ht_ma` hiện là `ON DELETE SET NULL`; `xu_ly_mac_dinh.ht_ma` là `ON DELETE CASCADE`. Vì vậy API xóa danh mục chủ động khóa loại, kiểm tra phiếu và ánh xạ rồi từ chối 409 nếu có tham chiếu. Không dựa vào các FK này để tự xóa/null dữ liệu.

## Giao diện và cách dùng

- Giữ route `/manager/groups`, đổi nhãn sidebar thành **Nhóm và loại hỗ trợ**.
- Tab Nhóm hỗ trợ mặc định; tab Loại hỗ trợ lưu bằng `?tab=types`.
- Bảng nhóm có số loại phụ trách `N/2`; nhóm vượt giới hạn hiện cảnh báo, không tự chỉnh dữ liệu.
- Danh mục loại có tìm mã/tên, trạng thái, phân trang Backend 5 bản ghi, modal tạo/sửa, xác nhận ngừng/kích hoạt/xóa. Hiển thị số nhóm, cảnh báo thiếu mặc định, số phiếu/yêu cầu Mới trong modal.
- Tên được chuẩn hóa khoảng trắng khi ghi; trùng tên được kiểm tra bằng chuẩn hóa khoảng trắng và `casefold`, trong khóa điều phối chung. Sửa/xóa kiểm tra snapshot tên/mô tả/trạng thái để trả 409 nếu cũ.
- Ngừng loại giữ nguyên các quan hệ, nhóm, phiếu và lịch sử. Khách không chọn loại đó cho yêu cầu mới. Yêu cầu Mới cũ vẫn xem/sửa được khi giữ chính loại cũ; nhân viên vẫn duyệt được. Không cho chọn một loại ngừng khác để tạo hoặc đổi phân loại.
- Xóa chỉ dành cho loại không có phiếu/nhóm/mặc định tham chiếu; không xóa dữ liệu hàng loạt.

## Quan hệ chuyên môn và mặc định

Migration **chưa được áp dụng** vào DB_HELPDESK:

`docs/migrations/006_group_support_types.sql`

Migration bổ sung duy nhất bảng `helpdesk.nhom_loai_ho_tro(nhom_ma,ht_ma)`, khóa chính kép, hai FK RESTRICT và chỉ mục tra cứu theo loại. Trong transaction với khóa điều phối, sao chép ánh xạ mặc định hiện có sang chuyên môn bằng `ON CONFLICT DO NOTHING`. Không sửa/xóa bảng hay bản ghi cũ, không thay nhóm/người phụ trách của phiếu, không reset sequence. Có thể chạy lại. Kiểm tra tên bảng mới trước khi áp dụng nếu đã có bảng cùng tên từ nguồn khác; `IF NOT EXISTS` không tự sửa cấu trúc khác biệt.

Quản trị viên cần xem script và áp dụng thủ công trong DBeaver khi đã quyết định nâng cấp; không chạy SQL khởi tạo. Sau đó tải lại màn hình. Ứng dụng không chạy migration tự động. Không có script rollback tự xóa bảng chuyên môn: muốn quay lại bản ứng dụng cũ có thể giữ bảng bổ sung, tránh mất quan hệ chuyên môn mới.

Trước migration: đọc chuyên môn theo bảng mặc định để tương thích, hiển thị thông báo thiếu migration và khóa các nút thêm/bỏ chuyên môn; API chuyên môn ghi trả 503 rõ nguyên nhân. CRUD danh mục vẫn dùng được.

Sau migration:

- **Thêm nhóm cùng phụ trách**: thêm cặp nhóm–loại, kể cả loại đã thuộc nhóm khác; không đổi mặc định.
- **Đặt làm mặc định** trong popup nhóm đích: cập nhật nguyên tử API routing hiện có; tự bảo đảm quan hệ chuyên môn của nhóm đích, giữ chuyên môn nhóm nguồn.
- **Bỏ mặc định**: bỏ đúng định tuyến, vẫn giữ chuyên môn. Loại được đánh dấu chưa có mặc định trong tab danh mục.
- **Bỏ quan hệ phụ trách**: xác nhận rồi xóa đúng cặp. Nếu nhóm vẫn là mặc định, API từ chối; cần chủ động chuyển/bỏ mặc định trước.
- Thao tác thêm chuyên môn và đổi mặc định cùng dùng `pg_advisory_xact_lock(741032026)` và transaction như các mutation hiện có, khóa nhóm/loại trước kiểm tra số lượng. Tối đa 2 quan hệ/nhóm, bao gồm loại ngừng hoạt động. Thêm lại cặp hiện có là no-op, không đếm trùng. Nhóm 3 loại cũ được giữ và có thể chủ động giảm về 2; không cản sửa tên/mô tả nhóm.
- Giới hạn 2 được thực thi ở service/API, không phải trigger chống SQL thủ công ngoài ứng dụng.
- Nhiều nhóm cùng chuyên môn không làm phiếu tự xuất hiện cho tất cả nhóm. Hàng đợi vẫn theo nhóm mặc định/nhóm đã chốt và cơ chế tiếp nhận hiện hữu. Không ánh xạ: phiếu vẫn lưu, chờ Quản lý cấu hình/điều phối. Phiếu đã tiếp nhận giữ nhóm/người/lịch sử.
- Quy tắc một nhân viên một nhóm và index hiện hữu được giữ nguyên.

## API

Tất cả dưới `/api/v1/manager`, kiểm tra role/hồ sơ Quản lý hoạt động. POST/PATCH/DELETE dùng mutation_guard hiện hành (CSRF/Origin), SQL tham số, transaction và audit hiện có.

| API | Chức năng |
|---|---|
| GET `/support-types` | search, active, page, page_size (mặc định 5) |
| POST `/support-types` | Tạo danh mục, không tự gán nhóm |
| PATCH `/support-types/{id}` | Sửa tên/mô tả/trạng thái, `expected` snapshot |
| DELETE `/support-types/{id}` | Xóa loại chưa sử dụng, JSON body `expected` snapshot |
| GET `/groups/{id}/support-types` | Danh mục cùng nhóm chuyên môn/mặc định và trạng thái migration |
| POST `/groups/{id}/support-types/{type_id}` | Thêm chuyên môn, tối đa 2 |
| DELETE `/groups/{id}/support-types/{type_id}` | Bỏ đúng chuyên môn, bảo vệ nhóm mặc định |
| GET `/groups`, GET `/groups/{id}` | Bổ sung `type_count`; chi tiết đọc chuyên môn N–N khi có bảng mới |
| PATCH/DELETE `/routing/{type_id}` | Giữ API mặc định; PATCH kiểm tra sức chứa chuyên môn khi đã nâng cấp |

## File thay đổi trong đợt này

- Frontend: `frontend/src/manager/{Layout,Groups,GroupDialog,GroupTypesDialog}.tsx`, `SupportTypes.tsx` (mới), `styles.css`.
- Tương thích loại cũ: `frontend/src/customer/RequestSummary.tsx`, `frontend/src/staff/RequestReview.tsx` (chỉ bổ sung lựa chọn loại hiện hữu đã ngừng).
- Backend: `api/routes/manager.py`, `schemas/manager.py`, `services/manager_service.py`, `services/support_type_service.py` (mới); `services/customer_service.py`, `services/staff_service.py` chỉ cho phép giữ loại ngừng của chính yêu cầu Mới cũ.
- Kiểm thử: `scripts/support_type_checks.py` (mới), hook tùy chọn `--support-types` trong `scripts/test_phase4.py`; `frontend/staff-ui-tests/support-types.spec.ts`, `frontend/playwright.catalog.config.ts` (mới).
- Migration và tài liệu này. Các thay đổi Tổng quan/Báo cáo Bebo đã có trong working tree trước đợt này được giữ nguyên; không thuộc danh sách sửa của đợt này.

## Kiểm thử thực tế

| Kiểm thử | Kết quả/phương pháp |
|---|---|
| TypeScript + production build | PASS `npm run build`; Vite cảnh báo chunk JS >500 kB, không lỗi build |
| Danh mục, duplicates, snapshot cũ, xóa có tham chiếu, CSRF/role | PASS API FastAPI TestClient + SQL PostgreSQL trong transaction rollback |
| Quan hệ nhiều nhóm, mặc định tách biệt, giới hạn 2, giảm 3→2 | PASS với bảng `pg_temp.nhom_loai_ho_tro`, không tạo bảng mới trong helpdesk |
| Hai HTTP cùng tranh chỗ cuối | PASS: 200/409; fixture dùng connection chung được serialize. Kiểm tra thêm một connection PostgreSQL độc lập không lấy được khóa điều phối đang giữ. Chưa chạy stress nhiều transaction ghi độc lập lên bảng sau migration |
| Ngừng loại khi còn MOI | PASS: không có trong catalog Khách; tạo mới 422; sửa MOI cũ + duyệt cùng loại cũ thành công |
| Nhóm mặc định thiếu, tiếp nhận, một thành viên một nhóm, điều phối/chuyển nhóm | PASS hồi quy stage A/B/C, gồm phân quyền/CSRF, stale409, rollback lỗi lịch sử, cùng ID phiếu và một phân công hiệu lực |
| UI desktop/mobile × Light/Dark | PASS 4 Playwright cases, Chrome cài sẵn, API fixture; chuyển tab, 5+1, tạo/sửa/ngừng, thêm chuyên môn đã thuộc nhóm khác, giới hạn nút, xác nhận bỏ, Escape chỉ đóng modal trên cùng, không tràn ngang |
| Unit kế hoạch danh mục nội thất cũ | PASS 4 tests |
| Migration 006 trên DB_HELPDESK thật | CHƯA CHẠY theo yêu cầu. FK của bảng chuyên môn mới chưa được kiểm thử trên database sau nâng cấp; pg_temp chỉ kiểm tra quan hệ/capacity và truy vấn service |
| Dữ liệu sử dụng | Không sửa/xóa. Fixture rollback; đối chiếu số bản ghi trước/sau không đổi. Không gửi email hoặc gọi Gemini |

Lệnh PowerShell từ thư mục project:

```powershell
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase4.py --execute --stage C --support-types
.\.venv\Scripts\python.exe -X utf8 -m unittest tests.test_furniture_catalog
cd frontend
npm run build
npx playwright test --config playwright.catalog.config.ts
```

Ảnh fixture tại `frontend/test-results/group-expertise-{desktop,mobile}-{light,dark}.png` và `group-types-{desktop,mobile}-{light,dark}.png`. Browser test xác minh UX với API fixture; kiểm thử PostgreSQL riêng xác minh API thật, không phải thao tác tạo dữ liệu thật bằng browser.

Không thêm thư viện. Không sửa `.env`, SLA, email, FAQ hoặc Gemini. Không commit/push. Chức năng N–N trên database sử dụng thực tế vẫn chờ người dùng áp dụng migration.
