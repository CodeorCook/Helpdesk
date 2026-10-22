import os
from dotenv import load_dotenv
from google import genai

load_dotenv()

api_key = os.getenv("GEMINI_KEY")
model = os.getenv("GEMINI_MODEL")

if not api_key or not model:
    raise RuntimeError("Thiếu GEMINI_KEY hoặc GEMINI_MODEL trong .env")

try:
    client = genai.Client(api_key=api_key)

    response = client.models.generate_content(
        model=model,
        contents="Xin chào, hãy trả lời bằng tiếng Việt trong một câu."
    )

    print("MODEL:", model)
    print("KẾT QUẢ:", response.text)

except Exception as exc:
    print("LOẠI LỖI:", type(exc).__name__)
    print("CHI TIẾT:", str(exc))