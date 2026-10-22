"""Manual opt-in only: synthetic question, no DB/personal conversation. May consume Gemini quota."""
import argparse
import json
import logging
import os
import sys
from pathlib import Path
from fastapi import HTTPException
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from core import database  # Load the existing Backend-root .env; never overwrite it.
from schemas.chatbot import AIAnswer
from services.gemini_service import generation_config,log_failure,settings

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    if not args.execute:parser.error('Cần --execute để gọi Gemini thật bằng câu hỏi tổng hợp; không chạy trong unit test mặc định.')
    gemini_key=os.getenv('GEMINI_KEY')
    gemini_model=os.getenv('GEMINI_MODEL')
    try:settings() # Same validation as runtime; no default model/key.
    except HTTPException as exc:
        print('CHƯA CHẠY: '+exc.detail);return 2
    from google import genai
    from google.genai import types,errors
    payload=dict(question='Làm sao gửi yêu cầu hỗ trợ nội thất?',collecting=False,recent=[],ticket_types=[],faq=[dict(id='manual-fixture',question='Làm sao gửi yêu cầu?',answer='Khách đăng nhập, kiểm tra bản nháp và nhấn xác nhận để gửi phiếu. Không tự phân công nhân viên.')])
    logging.basicConfig(level=logging.WARNING,format='%(levelname)s %(name)s %(message)s')
    try:
        with genai.Client(api_key=gemini_key.strip(),vertexai=False,http_options=types.HttpOptions(timeout=20000,retry_options=types.HttpRetryOptions(attempts=1))) as client:
            response=client.models.generate_content(model=gemini_model.strip(),contents=json.dumps(payload,ensure_ascii=False),config=generation_config())
        result=AIAnswer.model_validate_json(response.text or '')
        print('PASS: Gemini thật trả JSON hợp lệ theo AIAnswer, dùng đúng GenerateContentConfig của chatbot; không lưu DB hoặc in key/nội dung phản hồi.')
        return 0
    except errors.APIError as exc:
        log_failure(exc);print('FAIL: Gemini từ chối request; mã lỗi và chẩn đoán kỹ thuật an toàn nằm ở dòng log trên.');return 1
    except Exception as exc:
        print('FAIL: '+type(exc).__name__+' (không in nội dung exception hoặc phản hồi để bảo vệ dữ liệu).');return 1

if __name__=='__main__':raise SystemExit(main())
