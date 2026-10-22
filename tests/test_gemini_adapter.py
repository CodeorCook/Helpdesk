import json
import os
import unittest
from unittest.mock import patch
import httpx
from fastapi import HTTPException
from google import genai
from google.genai import types
from services import gemini_service as service
from schemas.chatbot import AIAnswer

class GeminiTests(unittest.TestCase):
    def test_only_required_environment_names(self):
        with patch.dict(os.environ,{'GEMINI_KEY':'','GEMINI_MODEL':'','GOOGLE_API_KEY':'must-not-use'}):
            with self.assertRaises(HTTPException) as e:service.settings()
            self.assertEqual(e.exception.status_code,503)
        with patch.dict(os.environ,{'GEMINI_KEY':'unit-test-only','GEMINI_MODEL':''}):
            with self.assertRaises(HTTPException):service.settings()

    def test_real_sdk_serialization_and_structured_output_offline(self):
        original=genai.Client;seen=[]
        answer=dict(answer='Chưa có chính sách được xác nhận.',offer_ticket=False,draft=None)
        def transport(request):
            seen.append(json.loads(request.content));self.assertEqual(request.headers['x-goog-api-key'],'unit-test-only')
            self.assertIn('configured-model-for-offline-test',str(request.url))
            return httpx.Response(200,json={'candidates':[{'content':{'role':'model','parts':[{'text':json.dumps(answer)}]},'finishReason':'STOP'}]})
        with httpx.Client(transport=httpx.MockTransport(transport)) as http:
            def client(**kwargs):
                options=kwargs['http_options'].model_copy(update={'httpx_client':http})
                return original(**{**kwargs,'http_options':options})
            with patch.dict(os.environ,{'GEMINI_KEY':'unit-test-only','GEMINI_MODEL':'configured-model-for-offline-test'}),patch.object(genai,'Client',side_effect=client):
                result=service.generate({'question':'Sofa bảo hành thế nào?','faq':[],'recent':[]})
        self.assertEqual(result.answer,answer['answer']);self.assertEqual(len(seen),1)
        self.assertEqual(seen[0]['generationConfig']['responseMimeType'],'application/json')
        schema=seen[0]['generationConfig']['responseSchema']
        self.assertTrue(schema);self.assertNotIn('tools',seen[0])
        def check(value):
            if isinstance(value,dict):
                self.assertNotIn('additional_properties',value);self.assertNotIn('additionalProperties',value)
                for child in value.values():check(child)
            elif isinstance(value,list):
                for child in value:check(child)
        check(schema)
        self.assertTrue(schema['properties']['draft']['nullable'])
        self.assertTrue(schema['properties']['draft']['properties']['type_id']['nullable'])
        self.assertEqual(schema['properties']['answer']['max_length'],6000)
        self.assertEqual(set(schema['required']),{'answer','offer_ticket','draft'})

    def test_provider_schema_does_not_weaken_pydantic_validation(self):
        from pydantic import ValidationError
        raw=AIAnswer.model_json_schema()
        self.assertFalse(raw['additionalProperties'])
        self.assertFalse(raw['$defs']['Draft']['additionalProperties'])
        self.assertNotIn('additionalProperties',json.dumps(service.response_schema()))
        for value in [dict(answer='OK',offer_ticket=False,draft=None,role='manager'),
                      dict(answer='OK',offer_ticket=True,draft=dict(title='Sofa',description='Lún',type_id=None,missing_information=[],ready_for_confirmation=False,owner=99)),
                      dict(answer='x'*6001,offer_ticket=False,draft=None)]:
            with self.assertRaises(ValidationError):AIAnswer.model_validate(value)

    def test_filtered_provider_error_log_without_sensitive_response(self):
        from google.genai.errors import ClientError
        message='Unknown name "additional_properties" at generation_config.response_schema: Cannot find field. prompt=Nguyen Van A; email=private@example.com; key=secret-value; Authorization: Bearer private; Cookie=session-private'
        exc=ClientError(400,{'error':{'message':message}})
        with self.assertLogs(service.logger,level='WARNING') as log:service.log_failure(exc)
        text=' '.join(log.output)
        for value in ('400','ClientError','additional_properties','Cannot find field'):self.assertIn(value,text)
        for value in ('Nguyen','private@example.com','secret-value','Bearer','session-private','prompt='):self.assertNotIn(value,text)

    def test_client_error_is_logged_but_not_returned_to_frontend(self):
        from google.genai.errors import ClientError
        with patch.dict(os.environ,{'GEMINI_KEY':'unit-test-only','GEMINI_MODEL':'configured-model-for-offline-test'}),patch.object(genai,'Client') as client:
            client.return_value.__enter__.return_value.models.generate_content.side_effect=ClientError(400,{'error':{'message':'Unknown name "additional_properties": Cannot find field. prompt=private-value'}})
            with self.assertLogs(service.logger,level='WARNING'),self.assertRaises(HTTPException) as error:service.generate({'question':'synthetic'})
        self.assertEqual(error.exception.status_code,503)
        self.assertNotIn('additional_properties',error.exception.detail);self.assertNotIn('private-value',error.exception.detail)

    def test_generated_extra_fields_are_rejected_after_normalized_schema(self):
        from types import SimpleNamespace
        with patch.dict(os.environ,{'GEMINI_KEY':'unit-test-only','GEMINI_MODEL':'configured-model-for-offline-test'}),patch.object(genai,'Client') as client:
            client.return_value.__enter__.return_value.models.generate_content.return_value=SimpleNamespace(text=json.dumps(dict(answer='OK',offer_ticket=False,draft=None,role='manager')))
            with self.assertLogs(service.logger,level='WARNING'),self.assertRaises(HTTPException) as error:service.generate({'question':'synthetic'})
        self.assertEqual(error.exception.status_code,502)

    def test_sensitive_data_and_minimal_contact(self):
        self.assertTrue(service.sensitive('mật khẩu: secret-value'))
        self.assertTrue(service.sensitive('OTP=123456'))
        self.assertNotIn('abc@example.com',service.minimal('abc@example.com 0912345678'))
        self.assertNotIn('0912345678',service.minimal('abc@example.com 0912345678'))

if __name__=='__main__':unittest.main()
