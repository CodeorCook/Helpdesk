# Debug Gemini 503 — 22/10/2026

## Nguyên nhân đã xác nhận

Đã gọi thủ công bằng câu hỏi tổng hợp, đúng `GenerateContentConfig` của chatbot và model/key đang cấu hình; không dùng hội thoại hoặc dữ liệu khách hàng.

Trước sửa, Google trả **400 / ClientError**:

```text
Unknown name "additional_properties"; at generation_config.response_schema; Cannot find field
```

`AIAnswer` và `Draft` có `ConfigDict(extra="forbid")`, làm JSON Schema chứa `additionalProperties: false`. SDK google-genai **1.75.0** serialize qua `response_schema` thành `additional_properties`; endpoint Gemini đang cấu hình từ chối thuộc tính này. Handler cũ đổi mọi400/401/403/404 thành503 và không log lỗi gốc, khiến Frontend chỉ thấy lỗi cấu hình chung. Đây không phải lỗi phiên, CSRF, FAQ hoặc dữ liệu PostgreSQL.

## Thay đổi tối thiểu

- `services/gemini_service.py:13`: lọc log bằng cách chỉ giữ các chẩn đoán kỹ thuật đã biết. Không log nguyên exception/response/request, header, key, cookie, prompt, hội thoại hoặc tên/email tùy ý. Với thông báo không nhận dạng an toàn, log mã lỗi/loại exception và ghi nội dung đã ẩn. Có nhận dạng deadline/timeout tạm thời.
- `services/gemini_service.py:38`, `:106`: log mã Google gốc, loại exception và chẩn đoán đã lọc; Frontend vẫn chỉ nhận thông báo thân thiện, không nhận debug kỹ thuật.
- `services/gemini_service.py:43`: chuẩn hóa bản sao schema gửi đi, **chỉ bỏ additionalProperties ở mọi cấp**. Giữ required, nullability, giới hạn độ dài/số phần tử. Không sửa schema Pydantic gốc.
- `services/gemini_service.py:55`: dùng một hàm tạo GenerateContentConfig chung cho runtime và bài thử thủ công; giữ MIME application/json, Structured Outputs, system instruction, timeout20s, model/key từ ENV. Kết quả vẫn phải qua `AIAnswer.model_validate_json`; trường thừa/giá trị sai bị từ chối.
- `scripts/test_gemini_structured_live.py:14`: bài thử thủ công opt-in `--execute`, đọc đúng GEMINI_KEY/GEMINI_MODEL bằng os.getenv, dùng config chatbot; không in key hoặc response, không ghi DB.
- `tests/test_gemini.py` đổi tên thành `tests/test_gemini_adapter.py`: tránh trùng tên file `test_gemini.py` do người dùng thêm ở thư mục gốc. File gốc có lời gọi Gemini ở top-level; một lượt discovery ban đầu đã nhập nhầm và chạy nó. Giữ nguyên file gốc của người dùng. Lượt unittest sau đổi tên không còn gọi API thật; các bài unit dùng HTTP mock.

Không đổi `.env`, GEMINI_MODEL, GEMINI_KEY, dependency, API, FAQ, phiên chat, CSRF, tạo phiếu, CSDL hoặc Frontend. `schemas/chatbot.py` và `services/chatbot_service.py` giữ nguyên.

## Kết quả

| Kiểm tra | Kết quả |
| --- | --- |
| Tái hiện live trước sửa với đúng config chatbot | Xác nhận400/ClientError/unknown additional_properties |
| Live sau chuẩn hóa schema | Có một lượt504/ServerError tạm thời từ Google; thử lại cùng config/model/key **PASS**, JSON hợp lệ theo AIAnswer |
| Unit mặc định | **24/24 PASS**: serialization SDK qua HTTP mock không còn thuộc tính lỗi, nested Draft/type_id vẫn nullable, required/bounds vẫn giữ; raw Pydantic vẫn forbid extra; response thêm role/owner bị từ chối; log không lộ secret/PII/prompt; Frontend không nhận kỹ thuật |
| Hồi quy Phase5 API/PostgreSQL/browser | **PASS**: API/DB thật với provider mock; sở hữu phiên, auth/CSRF, FAQactive/context, draft/cancel/xác nhận/replay/rollback, lỗi quota/timeout/JSON, lifecycle staff→customer; **2/2 browser** desktop/mobile Light/Dark; fixture rollback và counts không đổi |

## Kiểm tra lại

Tại thư mục gốc Backend, Windows PowerShell:

```powershell
# Chỉ khi chủ động muốn gọi Gemini thật; có thể dùng quota, không ghi DB
.\.venv\Scripts\python.exe -X utf8 scripts/test_gemini_structured_live.py --execute
# Unit mặc định, không gọi Gemini thật
.\.venv\Scripts\python.exe -X utf8 -m unittest discover -s tests -v
# Hồi quy API/DB/React thật, chỉ Gemini provider mock; fixture rollback
.\.venv\Scripts\python.exe -X utf8 scripts/test_phase5.py --execute --browser
```

Khởi động lại Backend bằng `uvicorn main:app --reload` trong .venv (hoặc `.\.venv\Scripts\python.exe -m uvicorn main:app --reload`). Giữ nguyên Frontend đang chạy, đăng nhập Khách hàng, mở Trợ lý AI, chọn Phiên chat mới và hỏi một câu FAQ. Nếu còn lỗi, xem log terminal Backend `services.gemini_service`: mã Google gốc/loại exception/chẩn đoán an toàn. 504 sau sửa là deadline của nhà cung cấp và khác với400schema ban đầu; chưa tăng timeout hoặc tự đổi model để che lỗi. Không bảo đảm nhà cung cấp luôn sẵn sàng chỉ từ một lượt live thành công.

Nguồn tham khảo về Structured Outputs/subset JSON Schema: [Google Gemini](https://ai.google.dev/gemini-api/docs/structured-output). Kết luận root cause dựa vào request SDK đã quan sát và lỗi Google tái hiện thực tế, không suy đoán từ tài liệu.
