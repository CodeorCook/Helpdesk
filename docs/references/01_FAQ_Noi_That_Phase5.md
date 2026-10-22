# Bộ kiến thức FAQ – Helpdesk công ty nội thất (đề xuất Giai đoạn 5)

**Trạng thái:** Bản nháp nghiệp vụ v1, chưa được nhóm phê duyệt chính sách thương mại. **Nguồn:** Phạm vi Helpdesk nội thất và tám loại hỗ trợ do nhóm đã chốt; nội dung câu trả lời do trợ lý đề xuất, không phải quy định có thực của một công ty. Không dùng câu trả lời chưa duyệt để cam kết giá, thời gian, quyền lợi, tình trạng đơn hàng, tồn kho hoặc điều kiện bảo hành.

## Nguyên tắc trả lời
- Chỉ xác nhận thông tin có trong FAQ/chính sách đã được nhóm duyệt hoặc dữ liệu truy vấn hợp lệ từ API. Khi không có dữ liệu, nói rõ chưa có thông tin; hướng dẫn lập phiếu.
- Không tự phán quyết đủ điều kiện bảo hành/đổi trả, không hứa giao hàng đúng ngày hay hoàn tiền.
- Không yêu cầu mật khẩu, OTP, số thẻ ngân hàng; không suy đoán trạng thái đơn hàng hoặc tra cứu đơn hàng thật nếu hệ thống chưa có tích hợp.
- Bất cứ nội dung liên quan đến giá, ưu đãi, khuyến mãi, kho, thời hạn, phí hoặc cam kết xử lý đều yêu cầu nguồn chính sách được duyệt.
- Chatbot có thể đề xuất loại hỗ trợ từ 8 danh mục nhưng phải dựa vào ID danh mục trả về từ Backend, không hardcode ID.

## Nhóm A – Tư vấn sản phẩm nội thất (FAQ01–05)

**FAQ01. Công ty có những dòng nội thất nào?**
Trả lời gợi ý: Hệ thống tiếp nhận yêu cầu tư vấn các nhóm sản phẩm như bàn ghế, sofa, giường, tủ và đồ nội thất khác. Để tư vấn chính xác mẫu đang kinh doanh, vui lòng nêu loại sản phẩm và nhu cầu của bạn; nhân viên sẽ kiểm tra thông tin thực tế.
Loại: **Tư vấn sản phẩm nội thất**. Chính sách bổ sung cần chốt: danh mục sản phẩm thực tế.

**FAQ02. Tôi nên chọn bàn ăn kích thước nào?**
Trả lời gợi ý: Bạn cho biết số người sử dụng, kích thước khu vực đặt bàn và phong cách mong muốn. Nhân viên có thể gợi ý phương án phù hợp; chatbot không khẳng định kích thước của một mã hàng khi chưa có catalog được duyệt.
Loại: **Tư vấn sản phẩm nội thất**.

**FAQ03. Sofa vải và sofa da khác nhau thế nào?**
Trả lời gợi ý: Hai loại có đặc tính sử dụng, vệ sinh và cảm giác ngồi khác nhau. Bạn có thể chia sẻ nhu cầu, điều kiện sử dụng và mức ngân sách để nhân viên tư vấn sản phẩm cụ thể.
Loại: **Tư vấn sản phẩm nội thất**.

**FAQ04. Có thể đặt nội thất theo kích thước riêng không?**
Trả lời gợi ý: Khả năng đặt theo kích thước phụ thuộc dịch vụ và từng mẫu sản phẩm. Hiện hệ thống chưa có chính sách xác nhận; bạn có thể gửi kích thước yêu cầu để nhân viên kiểm tra.
Loại: **Tư vấn sản phẩm nội thất**. Cần chốt: có nhận đặt theo yêu cầu hay không.

**FAQ05. Sản phẩm đang có ưu đãi hay giá bao nhiêu?**
Trả lời gợi ý: Tôi chưa có bảng giá hoặc ưu đãi được xác minh. Bạn cho biết tên/mã sản phẩm để nhân viên hỗ trợ kiểm tra thông tin chính xác.
Loại: **Tư vấn sản phẩm nội thất**. Cần chốt: nguồn catalog/bảng giá/khuyến mãi.

## Nhóm B – Hỗ trợ đơn hàng (FAQ06–10)

**FAQ06. Tôi muốn kiểm tra tình trạng đơn hàng.**
Trả lời gợi ý: Hệ thống Helpdesk hiện tiếp nhận yêu cầu về đơn hàng nhưng chưa tích hợp tra cứu đơn hàng trực tiếp. Bạn có thể gửi yêu cầu kèm mã đơn (nếu có) để nhân viên kiểm tra qua quy trình nghiệp vụ của công ty.
Loại: **Hỗ trợ đơn hàng**.

**FAQ07. Tôi muốn đổi địa chỉ nhận hàng.**
Trả lời gợi ý: Vui lòng tạo yêu cầu hỗ trợ, nêu mã đơn và thông tin cần điều chỉnh. Việc thay đổi có thực hiện được hay không cần nhân viên xác minh theo trạng thái đơn và quy định công ty.
Loại: **Hỗ trợ đơn hàng**.

**FAQ08. Tôi có thể hủy đơn không?**
Trả lời gợi ý: Điều kiện hủy đơn chưa được cấu hình trong kho kiến thức. Vui lòng gửi yêu cầu kèm mã đơn để nhân viên xem xét; việc gửi yêu cầu không đồng nghĩa đơn hàng đã bị hủy.
Loại: **Hỗ trợ đơn hàng**. Cần chốt: chính sách hủy.

**FAQ09. Tôi đã đặt sai màu/kích thước sản phẩm.**
Trả lời gợi ý: Bạn hãy nêu mã đơn, thông số hiện tại và thông số mong muốn. Nhân viên sẽ kiểm tra khả năng điều chỉnh; chatbot không tự thay đổi đơn hàng.
Loại: **Hỗ trợ đơn hàng**.

**FAQ10. Làm thế nào để gửi vấn đề về đơn hàng?**
Trả lời gợi ý: Bạn có thể đăng nhập, chọn tạo yêu cầu hỗ trợ và danh mục Hỗ trợ đơn hàng, mô tả vấn đề, đính kèm hình ảnh/tài liệu liên quan nếu có, sau đó theo dõi tại Phiếu của tôi.
Loại: **Hỗ trợ đơn hàng**.

## Nhóm C – Giao hàng và lắp đặt (FAQ11–15)

**FAQ11. Có hỗ trợ giao hàng và lắp đặt không?**
Trả lời gợi ý: Hệ thống có danh mục tiếp nhận yêu cầu Giao hàng và lắp đặt. Phạm vi dịch vụ, địa bàn và phí cụ thể cần nhân viên xác nhận theo chính sách công ty.
Loại: **Giao hàng và lắp đặt**. Cần chốt: khu vực phục vụ, phí.

**FAQ12. Khi nào hàng được giao?**
Trả lời gợi ý: Tôi chưa có dữ liệu lịch giao thực tế hoặc thời gian cam kết. Bạn có thể gửi mã đơn và thời gian mong muốn để nhân viên kiểm tra.
Loại: **Giao hàng và lắp đặt**.

**FAQ13. Nhân viên giao hàng đến trễ thì làm sao?**
Trả lời gợi ý: Bạn có thể lập yêu cầu với mã đơn, thời gian hẹn và tình trạng hiện tại. Nhân viên hỗ trợ sẽ tiếp nhận và phối hợp bộ phận liên quan.
Loại: **Giao hàng và lắp đặt**.

**FAQ14. Tôi nhận hàng thiếu linh kiện lắp đặt.**
Trả lời gợi ý: Vui lòng mô tả món đồ/linh kiện bị thiếu, mã đơn nếu có, và ảnh kiện hàng. Hệ thống có thể giúp bạn tạo phiếu để nhân viên xác minh và hướng dẫn xử lý.
Loại: **Giao hàng và lắp đặt**.

**FAQ15. Lắp đặt xong sản phẩm không chắc chắn.**
Trả lời gợi ý: Bạn nên ngừng sử dụng sản phẩm nếu có dấu hiệu mất an toàn và gửi ảnh/mô tả tình trạng để nhân viên hỗ trợ kiểm tra. Chatbot không đưa hướng dẫn sửa chữa nguy hiểm khi chưa có thông tin kỹ thuật xác thực.
Loại: **Giao hàng và lắp đặt**.

## Nhóm D – Bảo hành và bảo trì (FAQ16–20)

**FAQ16. Sản phẩm được bảo hành bao lâu?**
Trả lời gợi ý: Thời hạn bảo hành phụ thuộc sản phẩm và chính sách mua hàng; hiện chưa có văn bản bảo hành đã duyệt trong kho kiến thức. Bạn có thể gửi tên/mã sản phẩm và chứng từ nếu có để nhân viên xác minh.
Loại: **Bảo hành sản phẩm**. Cần chốt: thời hạn và ngoại lệ theo sản phẩm.

**FAQ17. Sofa bị lún đệm thì yêu cầu hỗ trợ thế nào?**
Trả lời gợi ý: Bạn có thể lập phiếu Bảo hành sản phẩm, mô tả vị trí bị lún, thời điểm phát hiện và gửi hình ảnh nếu có. Nhân viên sẽ xác định hướng xử lý sau khi kiểm tra thông tin.
Loại: **Bảo hành sản phẩm**.

**FAQ18. Bản lề tủ bị hỏng có được bảo hành không?**
Trả lời gợi ý: Việc được bảo hành hay không phụ thuộc tình trạng thực tế và chính sách được áp dụng. Bạn có thể gửi yêu cầu, kèm ảnh phần bản lề và thông tin mua hàng để nhân viên xem xét.
Loại: **Bảo hành sản phẩm**.

**FAQ19. Hết bảo hành có thể yêu cầu sửa chữa không?**
Trả lời gợi ý: Bạn có thể gửi phiếu Sửa chữa và bảo trì để nhân viên kiểm tra khả năng hỗ trợ. Chi phí và thời gian chỉ được xác nhận sau khi có thông tin chính thức.
Loại: **Sửa chữa và bảo trì**.

**FAQ20. Cần bảo dưỡng đồ gỗ như thế nào?**
Trả lời gợi ý: Hãy tham khảo hướng dẫn đi kèm sản phẩm và tránh tự dùng hóa chất/chất tẩy chưa được nhà sản xuất cho phép. Nếu cần hướng dẫn phù hợp với chất liệu cụ thể, vui lòng gửi thông tin sản phẩm để nhân viên tư vấn.
Loại: **Sửa chữa và bảo trì**.

## Nhóm E – Đổi trả và khiếu nại chất lượng (FAQ21–25)

**FAQ21. Tôi muốn đổi hoặc trả hàng.**
Trả lời gợi ý: Bạn có thể tạo yêu cầu Đổi trả sản phẩm, nêu mã đơn (nếu có), lý do và ảnh liên quan. Nhân viên sẽ kiểm tra điều kiện theo chính sách; gửi phiếu chưa có nghĩa là yêu cầu đổi trả đã được chấp thuận.
Loại: **Đổi trả sản phẩm**. Cần chốt: điều kiện, thời hạn, chi phí.

**FAQ22. Hàng giao sai mẫu hoặc sai màu.**
Trả lời gợi ý: Vui lòng cung cấp mô tả hàng đặt, hàng nhận và ảnh thực tế. Nhân viên có thể tiếp nhận yêu cầu Đổi trả sản phẩm để xác minh.
Loại: **Đổi trả sản phẩm**.

**FAQ23. Sản phẩm mới nhận bị trầy xước.**
Trả lời gợi ý: Bạn nên lưu lại ảnh/video tình trạng sản phẩm và bao bì nếu có, sau đó gửi phiếu Khiếu nại chất lượng. Nhân viên sẽ xác minh và hướng dẫn bước tiếp theo.
Loại: **Khiếu nại chất lượng**.

**FAQ24. Tôi không hài lòng với chất lượng sản phẩm.**
Trả lời gợi ý: Bạn hãy cho biết sản phẩm, vấn đề cụ thể, thời điểm phát hiện và kỳ vọng được hỗ trợ. Tôi có thể giúp tạo phiếu Khiếu nại chất lượng để bộ phận phụ trách tiếp nhận.
Loại: **Khiếu nại chất lượng**.

**FAQ25. Bao lâu tôi nhận kết quả khiếu nại?**
Trả lời gợi ý: Thời gian xử lý tùy theo mức ưu tiên và chính sách SLA của phiếu được áp dụng; không thể cam kết một thời hạn cụ thể nếu chưa truy vấn được SLA thực tế. Bạn có thể theo dõi trạng thái trong Phiếu của tôi.
Loại: **Khiếu nại chất lượng**.

## Nhóm F – Thanh toán, hóa đơn và cách sử dụng Helpdesk (FAQ26–30)

**FAQ26. Có những phương thức thanh toán nào?**
Trả lời gợi ý: Kho kiến thức chưa có danh sách phương thức thanh toán được công ty phê duyệt. Bạn có thể gửi yêu cầu Thanh toán và hóa đơn để nhân viên xác nhận.
Loại: **Thanh toán và hóa đơn**. Cần chốt: phương thức thanh toán.

**FAQ27. Tôi cần hóa đơn mua hàng.**
Trả lời gợi ý: Bạn có thể tạo phiếu Thanh toán và hóa đơn, cung cấp mã đơn/chứng từ liên quan và nội dung cần hỗ trợ. Không gửi mật khẩu, OTP hoặc thông tin thẻ thanh toán.
Loại: **Thanh toán và hóa đơn**.

**FAQ28. Tôi bị trừ tiền nhưng chưa rõ giao dịch đã thành công chưa.**
Trả lời gợi ý: Vui lòng không thanh toán lại chỉ dựa trên câu trả lời của chatbot. Hãy kiểm tra kênh thanh toán chính thức và lập phiếu để nhân viên xác minh; chỉ chia sẻ thông tin cần thiết đã che dữ liệu nhạy cảm.
Loại: **Thanh toán và hóa đơn**.

**FAQ29. Làm sao theo dõi phiếu hỗ trợ?**
Trả lời gợi ý: Sau khi đăng nhập, bạn vào Phiếu của tôi hoặc Lịch sử yêu cầu để tra cứu, xem trạng thái và trao đổi công khai với nhân viên đang phụ trách. Chỉ có thể xem phiếu thuộc tài khoản của mình.
Loại: định tuyến hướng dẫn sử dụng, **không bắt buộc lập phiếu mới**.

**FAQ30. Chatbot có thể lập phiếu giúp tôi không?**
Trả lời gợi ý: Tôi có thể hỏi thêm thông tin và tạo bản nháp yêu cầu. Bạn cần đăng nhập, kiểm tra nội dung và xác nhận gửi; chỉ sau xác nhận hệ thống mới lập phiếu thật. Nhân viên phù hợp sẽ chủ động nhấn Tiếp nhận, chatbot không tự giao phiếu.
Loại: hướng dẫn chức năng, **không tự tạo phiếu**.

## Danh sách chính sách cần nhóm chốt trước khi bật trả lời tự động có cam kết
| Mã | Chính sách/dữ liệu cần xác nhận | Trạng thái |
|---|---|---|
| POL01 | Danh mục sản phẩm đang kinh doanh, mã sản phẩm, giá và ưu đãi | CHƯA CHỐT |
| POL02 | Địa bàn và phí giao hàng/lắp đặt, thời gian dự kiến | CHƯA CHỐT |
| POL03 | Thời hạn, điều kiện và loại trừ bảo hành | CHƯA CHỐT |
| POL04 | Điều kiện, thời hạn, phí đổi trả/hủy đơn | CHƯA CHỐT |
| POL05 | Phương thức thanh toán và quy trình xuất hóa đơn | CHƯA CHỐT |
| POL06 | Kênh hỗ trợ chính thức, giờ làm việc của công ty | CHƯA CHỐT |
| POL07 | Quy định sử dụng hình ảnh/chứng từ khách gửi và thời hạn lưu | CHƯA CHỐT |
| POL08 | Tài liệu FAQ được người chịu trách nhiệm phê duyệt, ngày hiệu lực | CHƯA CHỐT |

**Chính sách SLA:** Hiện hệ thống thiết kế theo **mức ưu tiên**, 24/7, không phải theo loại hỗ trợ. Chatbot chỉ công bố hạn của một phiếu khi có dữ liệu SLA thật qua Backend, không tự suy ra từ FAQ.
