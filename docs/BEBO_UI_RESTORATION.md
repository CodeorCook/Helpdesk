# Khôi phục giao diện Bebo

Nguồn thiết kế là commit f717172 của nhánh bebo. Thay đổi được giữ trong workspace để người dùng xem lại.

## Đối chiếu giao diện

| Thành phần gốc | Kết quả | Dữ liệu và hành vi |
|---|---|---|
| Tiêu đề, nhãn, nút Xuất báo cáo | Khôi phục bố cục | Tên tài khoản từ Auth và liên kết tới Báo cáo |
| Card Bento chia hai cột | Khôi phục | Đổi thành một cột ở kích thước nhỏ |
| Donut lớn, số giữa, hover, highlight | Khôi phục | Tổng hợp toàn bộ phiếu tạo trong kỳ |
| Bốn mục Đang xử lý, Đã hoàn tất, Chờ tiếp nhận, Quá hạn | Khôi phục | Các tập không chồng nhau, thêm Khác khi có trạng thái còn lại |
| Click Donut và nút phân đoạn | Khôi phục | Backend lọc trước LIMIT/OFFSET, về trang 1 |
| Hôm nay, 7 ngày qua, Tháng này | Khôi phục | Theo Asia/Ho_Chi_Minh và ngày tạo phiếu |
| Thanh tải theo nhóm | Khôi phục | Phiếu đang xử lý hoặc tạm dừng tạo trong kỳ, tỷ trọng giữa các nhóm |
| Ba widget SLA, phản hồi, CSAT | Khôi phục | Analytics cùng kỳ, giữ tên sự kiện và mẫu số rõ ràng |
| Bảng phiếu nổi bật | Khôi phục | Nhóm thay cột vị trí khách, người phụ trách thật, nhãn SLA thật |
| Giao nhanh | Chuyển thành liên kết | Xem / Phân công lại mở chi tiết với popup điều phối có xác nhận |
| Thanh chọn và thao tác hàng loạt | Không khôi phục | Bản gốc chỉ cập nhật React, không có giao dịch nghiệp vụ thật |
| Đóng hàng loạt | Không khôi phục | Khách hàng xác nhận đóng sau khi Nhân viên giải quyết |
| Nội dung footer widget cố định | Thay bằng mẫu số | Không có căn cứ cho các cam kết tốc độ và mức hài lòng của bản gốc |
| Giao diện Báo cáo, KPI, biểu đồ, bảng nhóm | Giữ | Tự cập nhật bộ lọc hợp lệ sau debounce 250 ms |
| Nhật ký, CSV và in | Giữ | Nhật ký lọc Backend, CSV chống công thức, in cùng snapshot đang xem |

Overview sử dụng lại 74 trong 87 class furni của JSX gốc. Các class còn lại thuộc thanh hàng loạt, menu điều phối mô phỏng và footer widget được thay bằng thông tin mẫu số. Mọi class furni đang dùng đều có định nghĩa CSS. CSS gốc được giới hạn bên trong .furni-dashboard để tránh ảnh hưởng các vai trò khác.

## API và định nghĩa số liệu

GET /api/v1/manager/overview nhận preset today, 7d hoặc month. Trường hợp không truyền preset giữ hành vi hiện có. Các trường bổ sung gồm period_start, period_end, segments và workload.

Phiếu quá hạn đang mở được tách trước khỏi tập Đang xử lý và Chờ tiếp nhận. Đang xử lý gồm DANG_XU_LY và TAM_DUNG chưa quá hạn. Đã hoàn tất gồm DA_GIAI_QUYET và DA_DONG. Chờ tiếp nhận gồm MOI chưa quá hạn. Các trạng thái còn lại thuộc Khác. Tổng các lát bằng tổng số phiếu. Đây là ảnh chụp trạng thái hiện tại của các phiếu tạo trong kỳ.

GET /api/v1/manager/tickets nhận dashboard_segment và sort=intervention. Chế độ attention lấy các phiếu MOI, DANG_XU_LY, TAM_DUNG. Thứ tự ưu tiên là đang quá hạn, chưa phân công, sắp đến hạn trong 60 phút, rồi các phiếu khác. Trong mỗi mức, sắp theo ưu tiên cao trước, hạn gần nhất và thời điểm tạo. Bộ lọc ngày và phân đoạn chạy trước đếm tổng và phân trang 5 phiếu.

Widget chất lượng dùng GET /api/v1/manager/reports/analytics cùng kỳ. Tỷ lệ SLA lấy số phiếu giải quyết đúng hạn chia số phiếu giải quyết có deadline hợp lệ. Phản hồi lấy thời điểm phản hồi công khai thật đầu tiên trong kỳ. CSAT dùng ngày gửi đánh giá trong kỳ. Các widget mô tả rõ các tập sự kiện khác với tập phiếu tạo trong kỳ của Donut.

Báo cáo dùng cùng selection cho mọi KPI, biểu đồ và xuất dữ liệu. Khi khoảng ngày chưa đủ hoặc sai thứ tự, hệ thống giữ kết quả đã áp dụng và khóa xuất. Lịch sử hoạt động vẫn dùng q, actor_name, kind ở Backend trước phân trang. CSV vẫn dùng reportCsv.ts. In dùng trình duyệt, ẩn sidebar và các điều khiển bằng CSS print.

## Kiểm thử

Kiểm thử API dùng scripts/test_phase4.py --execute --stage D với transaction rollback và SMTP đã tắt. Các ca bổ sung đối chiếu kỳ thống kê, tính không chồng lấn Donut, thứ tự ưu tiên trước phân trang và quyền Quản lý.

Kiểm thử Playwright dùng API fixture cô lập, kiểm tra desktop/mobile, Sáng/Tối, bộ lọc tự cập nhật, ngày tùy chọn, CSV và giao diện in. Ảnh tại frontend/test-results/bebo-overview-*.png và bebo-reports-*.png là ảnh dữ liệu fixture, không phải dữ liệu người dùng thật.

Không cần migration hoặc biến môi trường mới. Vite có cảnh báo bundle vượt 500 kB sau khi phục hồi thiết kế. Không thực hiện chia bundle trong đợt giao diện này.

Kết quả đã chạy gồm TypeScript và npm run build PASS, các ca Playwright Tổng quan, Báo cáo, CSV, Giám sát và hội thoại Quản lý trên desktop/mobile đều PASS sau khi sửa selector kiểm tra biểu đồ in. PostgreSQL stage D PASS, bao gồm 7 phiếu fixture chia 5+2, phân đoạn không trùng, so sánh kỳ today/7d/month, quyền dữ liệu và transaction rollback.

Các file thay đổi trong đợt này gồm frontend/src/manager/Overview.tsx, furnidesk.css, Reports.tsx, api.ts, api/routes/manager.py, schemas/manager.py, services/manager_service.py, frontend/staff-ui-tests/staff.spec.ts, scripts/test_phase4.py và tài liệu này. Các file reportCsv.ts, ReportTrend.tsx, reportTypes.ts, UnifiedChart.tsx và reports.css được giữ nguyên trong đợt này.
