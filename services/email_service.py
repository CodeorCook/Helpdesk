"""Transactional outbox for customer notifications, delivered outside business transactions."""
import asyncio
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from datetime import datetime
from email.errors import HeaderParseError
from email.headerregistry import Address
from email.message import EmailMessage
from html import escape
import logging
import os
import smtplib
import ssl
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from psycopg import sql
from psycopg.rows import dict_row

from core.database import database_schema, get_connection

log = logging.getLogger('uvicorn.error.helpdesk.email')
EVENTS = {
    'created': ('Đã nhận yêu cầu hỗ trợ', 'Đang chờ xét duyệt', 'Chúng tôi đã nhận thông tin và sẽ kiểm tra yêu cầu của quý khách.'),
    'approved': ('Đã tiếp nhận yêu cầu hỗ trợ', 'Đang xử lý', 'Nhân viên hỗ trợ đã tiếp nhận yêu cầu của quý khách.'),
    'rejected': ('Thông báo không tiếp nhận yêu cầu hỗ trợ', 'Đã đóng – Không tiếp nhận',
                 'Yêu cầu chưa đủ điều kiện tiếp nhận. Quý khách có thể tạo yêu cầu mới nếu vẫn cần hỗ trợ.'),
    'cancelled': ('Xác nhận hủy yêu cầu hỗ trợ', 'Đã hủy bởi khách hàng', 'Chúng tôi đã ghi nhận việc quý khách hủy yêu cầu.'),
}


@dataclass(frozen=True, repr=False)
class SMTPSettings:
    host: str
    port: int
    sender: str
    sender_name: str
    username: str
    password: str
    starttls: bool


def smtp_settings():
    # Either host/from marker selects the entire SMTP family. Empty example values
    # allow MAIL fallback, but partial SMTP configuration cannot borrow MAIL values.
    if os.getenv('SMTP_HOST', '').strip() or os.getenv('SMTP_FROM', '').strip():
        keys = ('SMTP_HOST', 'SMTP_FROM', 'SMTP_PORT', 'SMTP_FROM_NAME', 'SMTP_USER', 'SMTP_PASSWORD')
        tls_key = 'SMTP_USE_TLS'
    else:
        keys = ('MAIL_SERVER', 'MAIL_FROM', 'MAIL_PORT', 'MAIL_FROM_NAME', 'MAIL_USERNAME', 'MAIL_PASSWORD')
        tls_key = 'MAIL_STARTTLS'
    host, sender, port, sender_name, username, password = (os.getenv(key, '').strip() for key in keys)
    if not host and not sender:
        return None
    if host.lower() == 'smtp.gmail.com':
        password = ''.join(password.split())
    tls = os.getenv(tls_key, 'true').strip().lower()
    try:
        port = int(port or '587')
    except ValueError:
        raise ValueError('invalid_smtp_port') from None
    if not host or not sender or bool(username) != bool(password):
        raise ValueError('incomplete_smtp_settings')
    if not 1 <= port <= 65535 or tls not in ('true', 'false') or (port == 587 and tls == 'false'):
        raise ValueError('invalid_smtp_transport')
    if port == 465:
        raise ValueError('implicit_tls_not_supported')
    try:
        Address(display_name=sender_name, addr_spec=sender)
    except (ValueError, HeaderParseError):
        raise ValueError('invalid_smtp_sender') from None
    return SMTPSettings(host, port, sender, sender_name, username, password, tls == 'true')


def table(name):
    return sql.Identifier(database_schema(), name)


def outbox_exists(cur):
    cur.execute('SELECT to_regclass(%s) AS relation', (table('email_outbox').as_string(cur),))
    return cur.fetchone()['relation'] is not None


def enqueue(cur, ticket_id, event, reason=None):
    if not outbox_exists(cur):
        log.info('email_outbox_unavailable event=%s ticket=%s', event, ticket_id)
        return
    cur.execute(sql.SQL('''INSERT INTO {} (phieu_ma,event,payload)
        SELECT p.phieu_ma,%s,jsonb_build_object('recipient',n.email,'name',n.ho_ten,
            'title',p.tieu_de,'type',l.ten,'created_at',p.ngay_tao,'reason',%s::text)
        FROM {} p JOIN {} n ON n.nd_ma=p.khach_hang_ma LEFT JOIN {} l USING(ht_ma)
        WHERE p.phieu_ma=%s ON CONFLICT (phieu_ma,event) DO NOTHING''').format(
        table('email_outbox'), table('phieu_ho_tro'), table('nguoi_dung'), table('loai_ho_tro')),
        (event, reason, ticket_id))


def build_message(item, sender, frontend_url='', sender_name=''):
    payload = item['payload']
    subject, status, intro = EVENTS[item['event']]
    reference = f"#HT-{item['phieu_ma']}"
    sent = datetime.fromisoformat(payload['created_at']).astimezone(ZoneInfo('Asia/Ho_Chi_Minh'))
    fields = [('Mã yêu cầu', reference), ('Tiêu đề', payload['title']), ('Loại hỗ trợ', payload['type'] or 'Chưa phân loại'),
              ('Thời điểm gửi', sent.strftime('%d/%m/%Y %H:%M')), ('Trạng thái', status)]
    if payload['reason']:
        fields.append(('Lý do', payload['reason']))
    url = urlsplit(frontend_url)
    link = (f"{frontend_url.rstrip('/')}/customer/tickets/{item['phieu_ma']}"
            if url.scheme in ('http', 'https') and url.hostname and not url.username and not url.password
            and not url.query and not url.fragment else '')
    greeting = f"Xin chào {payload['name']},"
    signoff = 'Trân trọng,\nBộ phận hỗ trợ khách hàng'
    msg = EmailMessage()
    msg['From'] = Address(display_name=sender_name, addr_spec=sender)
    msg['To'], msg['Subject'] = payload['recipient'], f'{subject} {reference}'
    msg['Message-ID'] = f"<helpdesk-{item['phieu_ma']}-{item['event']}@{sender.rsplit('@', 1)[-1]}>"
    msg.set_content('\n\n'.join(filter(None, [greeting, intro, '\n'.join(f'{k}: {v}' for k, v in fields), link, signoff])))
    rows = ''.join(f'<tr><th style="text-align:left;padding:8px;border-bottom:1px solid #dce9e8">{escape(k)}</th>'
                   f'<td style="padding:8px;border-bottom:1px solid #dce9e8;white-space:pre-wrap">{escape(v)}</td></tr>' for k, v in fields)
    action = f'<p><a style="color:#08686b" href="{escape(link, quote=True)}">Xem chi tiết yêu cầu</a></p>' if link else ''
    msg.add_alternative(f'''<html lang="vi"><body style="font:16px Arial,sans-serif;color:#153a3d">
        <div style="max-width:600px;margin:auto;padding:20px"><h1 style="font-size:22px;color:#08686b">Helpdesk Nội thất</h1>
        <p>{escape(greeting)}</p><p>{escape(intro)}</p><table style="width:100%;border-collapse:collapse">{rows}</table>
        {action}<p>Trân trọng,<br>Bộ phận hỗ trợ khách hàng</p></div></body></html>''', subtype='html')
    return msg


def deliver_next(settings=None):
    settings = settings or smtp_settings()
    if settings is None:
        return False
    with get_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        if not outbox_exists(cur):
            return False
        cur.execute(sql.SQL('''WITH next AS (
            SELECT phieu_ma,event FROM {} WHERE state='pending' AND next_attempt<=now()
            ORDER BY next_attempt,phieu_ma,event LIMIT 1 FOR UPDATE SKIP LOCKED
        ) UPDATE {} o SET state='sending',attempts=attempts+1 FROM next
            WHERE o.phieu_ma=next.phieu_ma AND o.event=next.event RETURNING o.*''').format(
            table('email_outbox'), table('email_outbox')))
        item = cur.fetchone()
    if not item:
        return False

    state = 'failed'
    attempting_delivery = False
    smtp = None
    try:
        message = build_message(item, settings.sender, os.getenv('EMAIL_FRONTEND_URL', ''), settings.sender_name)
        smtp = smtplib.SMTP(settings.host, settings.port, timeout=10)
        if settings.starttls:
            smtp.starttls(context=ssl.create_default_context())
        if settings.username:
            smtp.login(settings.username, settings.password)
        attempting_delivery = True
        smtp.send_message(message)
        state = 'sent'
    except smtplib.SMTPAuthenticationError as exc:
        log.warning('smtp_authentication_failed code=%s', exc.smtp_code)
    except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused, smtplib.SMTPDataError) as exc:
        state = 'pending' if item['attempts'] < 3 else 'failed'
        log.warning('smtp_rejected category=%s', type(exc).__name__)
    except (OSError, smtplib.SMTPException, ValueError) as exc:
        state = 'uncertain' if attempting_delivery else ('pending' if item['attempts'] < 3 else 'failed')
        log.warning('smtp_failure category=%s', type(exc).__name__)
    finally:
        if smtp is not None:
            with suppress(OSError):
                smtp.close()
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(sql.SQL("""UPDATE {} SET state=%s,next_attempt=now()+interval '1 minute' * attempts
                WHERE phieu_ma=%s AND event=%s AND state='sending'""").format(table('email_outbox')),
                (state, item['phieu_ma'], item['event']))
        log.info('email_delivery ticket=%s event=%s state=%s', item['phieu_ma'], item['event'], state)
    return True


@asynccontextmanager
async def lifespan(app):
    try:
        settings = smtp_settings()
    except ValueError as exc:
        log.warning('smtp_configuration_invalid reason=%s', exc)
        yield
        return
    if settings is None:
        log.warning('smtp_not_configured: email notifications remain queued when outbox is available')
        yield
        return
    stop = asyncio.Event()

    async def dispatch():
        while not stop.is_set():
            try:
                if await asyncio.to_thread(deliver_next, settings):
                    continue
            except Exception as exc:
                log.error('email_worker_failure category=%s', type(exc).__name__)
            try:
                await asyncio.wait_for(stop.wait(), 5)
            except TimeoutError:
                pass

    task = asyncio.create_task(dispatch())
    try:
        yield
    finally:
        stop.set()
        await task
