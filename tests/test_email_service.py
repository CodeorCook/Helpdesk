import os
import smtplib
import unittest
from unittest.mock import MagicMock, patch

from services import email_service

ITEM = {
    'phieu_ma': 411, 'event': 'rejected', 'attempts': 1,
    'payload': {'recipient': 'customer@example.invalid', 'name': 'Khách <A>', 'title': '<script>Test</script>',
                'type': 'Bảo hành', 'created_at': '2026-11-11T13:00:00+00:00', 'reason': '<b>Không phù hợp</b>'},
}
SETTINGS = {'SMTP_HOST': 'smtp.example.invalid', 'SMTP_FROM': 'helpdesk@example.invalid',
            'SMTP_USER': '', 'SMTP_PORT': '25', 'SMTP_USE_TLS': 'false', 'DB_SCHEMA': 'helpdesk'}
MAIL_SETTINGS = {'MAIL_SERVER': 'smtp.gmail.com', 'MAIL_PORT': '587', 'MAIL_FROM': 'helpdesk@example.invalid',
                 'MAIL_FROM_NAME': 'Hỗ trợ nội thất', 'MAIL_USERNAME': 'helpdesk@example.invalid',
                 'MAIL_PASSWORD': 'test password'}


class EmailTests(unittest.TestCase):
    def test_mail_fallback_and_smtp_precedence(self):
        with patch.dict(os.environ, {**MAIL_SETTINGS, 'SMTP_PORT': '25'}, clear=True):
            settings = email_service.smtp_settings()
            self.assertEqual((settings.port, settings.starttls, settings.password), (587, True, 'testpassword'))
            with patch.dict(os.environ, {'SMTP_HOST': SETTINGS['SMTP_HOST']}):
                with self.assertRaisesRegex(ValueError, 'incomplete_smtp_settings'):
                    email_service.smtp_settings()
            with patch.dict(os.environ, SETTINGS):
                settings = email_service.smtp_settings()
                self.assertEqual((settings.port, settings.starttls, settings.username), (25, False, ''))

    def test_mail_starttls_and_authentication(self):
        for authentication_error, expected in [(None, 'sent'), (smtplib.SMTPAuthenticationError(535, b'detail'), 'failed')]:
            with self.subTest(expected=expected), patch.dict(os.environ, {**MAIL_SETTINGS, 'DB_SCHEMA': 'helpdesk'}, clear=True):
                claim, finish = MagicMock(), MagicMock()
                claim.__enter__().cursor.return_value.__enter__().fetchone.return_value = ITEM
                with patch.object(email_service, 'get_connection', side_effect=[claim, finish]), \
                     patch.object(email_service, 'outbox_exists', return_value=True), \
                     patch.object(email_service.smtplib, 'SMTP') as relay:
                    relay.return_value.login.side_effect = authentication_error
                    self.assertTrue(email_service.deliver_next())
                    relay.assert_called_once_with('smtp.gmail.com', 587, timeout=10)
                    self.assertEqual([call[0] for call in relay.return_value.method_calls[:2]], ['starttls', 'login'])
                    finish_cursor = finish.__enter__().cursor.return_value.__enter__()
                    self.assertEqual(finish_cursor.execute.call_args.args[1], (expected, 411, 'rejected'))
                    if authentication_error:
                        relay.return_value.send_message.assert_not_called()
                    else:
                        self.assertEqual(relay.return_value.send_message.call_args.args[0]['From'].addresses[0].display_name,
                                         'Hỗ trợ nội thất')

    def test_templates_recipient_fallback_escaping_and_links(self):
        for event, (subject, status, _) in email_service.EVENTS.items():
            with self.subTest(event=event):
                item = {**ITEM, 'event': event}
                message = email_service.build_message(item, SETTINGS['SMTP_FROM'], 'https://helpdesk.example.invalid')
                self.assertEqual(message['To'], ITEM['payload']['recipient'])
                self.assertIn(subject, message['Subject'])
                plain = message.get_body(preferencelist=('plain',)).get_content()
                html = message.get_body(preferencelist=('html',)).get_content()
                self.assertIn(status, plain)
                self.assertIn('20:00', plain)
                self.assertIn('&lt;script&gt;', html)
                self.assertNotIn('<script>', html)
                self.assertIn('https://helpdesk.example.invalid/customer/tickets/411', html)
                self.assertIn(event, message['Message-ID'])
        self.assertNotIn('javascript:', email_service.build_message(ITEM, SETTINGS['SMTP_FROM'], 'javascript:alert(1)').as_string())

    def test_mock_delivery_and_retry_states(self):
        scenarios = [
            ('sent', None, None),
            ('pending', OSError('connection failure'), None),
            ('uncertain', None, smtplib.SMTPServerDisconnected('interrupted after DATA')),
        ]
        for expected, connection_error, delivery_error in scenarios:
            with self.subTest(expected=expected), patch.dict(os.environ, SETTINGS, clear=True):
                claim_connection, finish_connection = MagicMock(), MagicMock()
                claim_cursor = claim_connection.__enter__().cursor.return_value.__enter__()
                claim_cursor.fetchone.return_value = ITEM
                finish_cursor = finish_connection.__enter__().cursor.return_value.__enter__()
                with patch.object(email_service, 'get_connection', side_effect=[claim_connection, finish_connection]), \
                     patch.object(email_service, 'outbox_exists', return_value=True), \
                     patch.object(email_service.smtplib, 'SMTP', side_effect=connection_error) as relay:
                    relay.return_value.send_message.side_effect = delivery_error
                    self.assertTrue(email_service.deliver_next())
                    self.assertTrue(claim_connection.__exit__.called)
                    self.assertEqual(finish_cursor.execute.call_args.args[1], (expected, 411, 'rejected'))
                    if connection_error is None:
                        self.assertEqual(relay.return_value.send_message.call_args.args[0]['To'], ITEM['payload']['recipient'])
