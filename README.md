# Hệ thống quản lý hỗ trợ khách hàng

Phạm vi áp dụng: công ty giả định kinh doanh và cung cấp dịch vụ nội thất.

Backend FastAPI được giữ tại thư mục gốc; frontend React + Vite + TypeScript nằm trong `frontend/`.
Đã triển khai xác thực, đăng ký công khai chỉ cho Khách hàng và toàn bộ luồng Khách hàng: tạo/tra cứu phiếu, chi tiết/lịch sử, trao đổi công khai, tệp, hồ sơ, đóng và đánh giá. Đã bổ sung nghiệp vụ Nhân viên hỗ trợ theo Phương án: hàng đợi/đề xuất, tiếp nhận có xác nhận, lập phiếu thay khách, phân loại/ưu tiên/chuyển trong nhóm, trao đổi công khai/nội bộ, tệp và giải quyết. Đã có quản lý tài khoản/quyền, nhóm/thành viên/routing, điều phối khác nhóm, chính sách SLA và báo cáo thật. SLA tự áp cho phiếu mới khi có chính sách.

## Chạy trên Windows / VS Code

Mở thư mục dự án trong VS Code. Terminal PowerShell thứ nhất, tại thư mục gốc Backend:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
# Chỉ thực hiện nếu CHƯA có .env; giữ nguyên .env hiện có.
# Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

Không bắt buộc activate virtualenv, không cần thay ExecutionPolicy. Backend: `http://127.0.0.1:8000`, Swagger: `http://127.0.0.1:8000/docs`, health: `http://127.0.0.1:8000/health/db`.

Terminal thứ hai:

```powershell
cd frontend
npm ci
npm run dev
```

Frontend: `http://localhost:5173`. Dùng đúng hostname localhost; nếu đổi hostname/port, sửa `FRONTEND_ORIGINS` và cấu hình Vite tương ứng. Dev server proxy `/api` tới `http://127.0.0.1:8000` để cookie cùng origin với giao diện.

```powershell
npm run build
```