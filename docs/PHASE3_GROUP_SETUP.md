# Cấu hình nhóm Giai đoạn 3 — đã được duyệt và áp dụng

Kiểm tra ban đầu: chưa có nhóm, thành viên, ánh xạ loại hỗ trợ, hồ sơ nhân viên hoặc chính sách SLA. Người dùng đã duyệt rõ phương án dưới đây; đã chạy script --apply thành công và chạy lại an toàn. Kết quả: 4 nhóm và 8 ánh xạ. Không tạo tài khoản/thành viên hoặc SLA. Kiểm thử dùng fixture riêng được rollback/dọn đúng ID.

Đề xuất tạo 4 nhóm hoạt động và 8 ánh xạ danh mục đang hoạt động:

| Nhóm | Loại hỗ trợ |
| --- | --- |
| Tư vấn và đơn hàng | Tư vấn sản phẩm nội thất; Hỗ trợ đơn hàng; Thanh toán và hóa đơn |
| Giao hàng và lắp đặt | Giao hàng và lắp đặt |
| Bảo hành và bảo trì | Bảo hành sản phẩm; Sửa chữa và bảo trì |
| Chất lượng và đổi trả | Khiếu nại chất lượng; Đổi trả sản phẩm |

`scripts/configure_support_groups.py` mặc định chỉ xem trước. Sau khi người dùng duyệt rõ phương án, `--apply` tạo nhóm/ánh xạ trong một transaction; chạy lại an toàn. Không đổi ID danh mục, không ghi lên phiếu, không ghi đè ánh xạ khác, không bật lại nhóm đã ngừng. Khi có mâu thuẫn hoặc thay đổi đồng thời, dừng/rollback.

```powershell
.\.venv\Scripts\python.exe -X utf8 scripts/configure_support_groups.py
# Chỉ sau khi duyệt phương án:
.\.venv\Scripts\python.exe -X utf8 scripts/configure_support_groups.py --apply
```

Phương án này **chưa tạo tài khoản nhân viên hay thành viên nhóm**. Cần có tài khoản NHAN_VIEN hoạt động, hồ sơ nhan_vien và thành viên nhóm được phê duyệt/cấu hình tiếp theo; quản lý tài khoản/nhóm thuộc Giai đoạn 4. Không có tài khoản/mật khẩu mặc định, không có đăng ký nhân viên công khai. Chưa cấu hình SLA và không tạo deadline. Sau khi chỉ tạo nhóm/ánh xạ mà chưa có nhân viên đủ điều kiện, phiếu vẫn chờ tiếp nhận.
