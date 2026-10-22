import hashlib
import json
import threading
import time
from collections import deque
from contextlib import contextmanager
from fastapi import HTTPException
from psycopg.errors import LockNotAvailable
from schemas.chatbot import Draft
from schemas.customer import TicketCreate
from services import customer_service as customer,gemini_service as gemini
from services.faq_service import execute,retrieve

_limits={}
_gate=threading.Lock()
def rate(user_id,action):
    now=time.monotonic();key=(str(user_id),action)
    with _gate:
        for old in list(_limits):
            while _limits[old] and now-_limits[old][0]>3600:_limits[old].popleft()
            if not _limits[old]:del _limits[old]
        if key not in _limits and len(_limits)>=4096:raise HTTPException(429,'Trợ lý đang bận, vui lòng thử lại sau.')
        values=_limits.setdefault(key,deque())
        if sum(t>now-60 for t in values)>=(5 if action=='session' else 8) or len(values)>=(40 if action=='session' else 60):
            raise HTTPException(429,'Bạn gửi yêu cầu quá nhanh. Vui lòng chờ một lúc rồi thử lại.')
        values.append(now)

@contextmanager
def cursor(user_id,session_id=None,lock=False):
    try:
        with customer.customer_cursor(user_id) as cur:
            session=None
            if session_id is not None:
                execute(cur,'''SELECT phien_chat_ma::text id,bat_dau created_at,phieu_ma::text ticket_id
                  FROM {phien_chat} WHERE phien_chat_ma=%s AND khach_hang_ma=%s'''+(' FOR UPDATE NOWAIT' if lock else ''),(session_id,user_id))
                session=cur.fetchone()
                if session is None:raise HTTPException(404,'Không tìm thấy phiên chat.')
            yield cur,session
    except LockNotAvailable:
        raise HTTPException(409,'Phiên chat đang xử lý yêu cầu trước. Vui lòng chờ rồi làm mới.') from None

def envelope(content):
    try:
        value=json.loads(content)
        if isinstance(value,dict) and value.get('helpdesk_chatbot_v')==1:return value
    except (ValueError,TypeError):pass
    return {'answer':content,'draft':None,'offer_ticket':False,'sources':[]}

def visible(row):
    if row['sender']=='KHACH':return row
    value=envelope(row['content'])
    return {**row,'content':value['answer'],'draft':value.get('draft'),'offer_ticket':value.get('offer_ticket',False),'sources':value.get('sources',[])}

def latest(cur,session_id):
    execute(cur,"SELECT tncb_ma::text id,noi_dung content FROM {tin_nhan_chatbot} WHERE phien_chat_ma=%s AND nguoi_gui='BOT' ORDER BY tncb_ma DESC LIMIT 1",(session_id,))
    return cur.fetchone()

def store(cur,session_id,sender,content,faq=None):
    execute(cur,'''INSERT INTO {tin_nhan_chatbot}(phien_chat_ma,nguoi_gui,noi_dung,ch_ma,da_tra_loi_duoc)
      VALUES(%s,%s,%s,%s,%s) RETURNING tncb_ma::text id,nguoi_gui sender,noi_dung content,thoi_gian created_at''',
      (session_id,sender,json.dumps(content,ensure_ascii=False) if isinstance(content,dict) else content,faq,True if sender=='BOT' else None))
    return visible(cur.fetchone())

def new_session(user_id):
    with cursor(user_id) as (cur,_):
        execute(cur,'INSERT INTO {phien_chat}(khach_hang_ma) VALUES(%s) RETURNING phien_chat_ma::text id,bat_dau created_at,phieu_ma::text ticket_id',(user_id,))
        return cur.fetchone()

def sessions(user_id,page):
    with cursor(user_id) as (cur,_):
        execute(cur,'SELECT count(*) n FROM {phien_chat} WHERE khach_hang_ma=%s',(user_id,));total=cur.fetchone()['n']
        execute(cur,'SELECT phien_chat_ma::text id,bat_dau created_at,phieu_ma::text ticket_id FROM {phien_chat} WHERE khach_hang_ma=%s ORDER BY phien_chat_ma DESC LIMIT 20 OFFSET %s',(user_id,(page-1)*20))
        return dict(items=cur.fetchall(),total=total,page=page)

def history(user_id,session_id,before=None):
    with cursor(user_id,session_id) as (cur,session):
        execute(cur,'''SELECT tncb_ma::text id,nguoi_gui sender,noi_dung content,thoi_gian created_at
          FROM {tin_nhan_chatbot} WHERE phien_chat_ma=%s'''+(' AND tncb_ma<%s' if before else '')+' ORDER BY tncb_ma DESC LIMIT 51', (session_id,before) if before else (session_id,))
        rows=cur.fetchall();return dict(session=session,messages=[visible(r) for r in reversed(rows[:50])],has_older=len(rows)>50)

def message(user_id,session_id,body):
    gemini.settings() # Missing configuration never writes a question or fake answer.
    if gemini.sensitive(body.content):raise HTTPException(422,'Không gửi mật khẩu, OTP, token hoặc khóa API vào chatbot.')
    with cursor(user_id,session_id,True) as (cur,session):
        if session['ticket_id']:raise HTTPException(409,'Phiên đã tạo phiếu. Vui lòng mở phiếu hiện có hoặc bắt đầu phiên chat mới.')
        old=latest(cur,session_id);previous=envelope(old['content']) if old else {}
        collecting=(body.prepare_draft or previous.get('collecting',False)) and not session['ticket_id']
        execute(cur,'''SELECT nguoi_gui sender,noi_dung content FROM {tin_nhan_chatbot}
          WHERE phien_chat_ma=%s ORDER BY tncb_ma DESC LIMIT 8''',(session_id,));recent=list(reversed(cur.fetchall()))
        context=[dict(sender=r['sender'],content=gemini.minimal((envelope(r['content'])['answer'] if r['sender']=='BOT' else r['content'])[:1500])) for r in recent]
        query=body.content+' '+' '.join(r['content'] for r in context[-4:])
        faqs=retrieve(cur,query)
        safe_faqs=[r for r in faqs if not gemini.sensitive(r['answer']+r['question'])]
        customer.execute(cur,'SELECT ht_ma::text id,ten name FROM {loai_ho_tro} WHERE dang_hoat_dong ORDER BY ht_ma');types=cur.fetchall()
        payload=dict(question=gemini.minimal(body.content),recent=context,collecting=bool(collecting),faq=[dict(id=r['id'],question=r['question'],answer=gemini.minimal(r['answer'][:1800])) for r in safe_faqs],ticket_types=types)
        result=gemini.generate(payload)
        # Test doubles and provider responses both pass the same validation boundary.
        from schemas.chatbot import AIAnswer
        result=AIAnswer.model_validate(result)
        if gemini.sensitive(result.model_dump_json()):raise HTTPException(502,'Phản hồi AI có dữ liệu không an toàn. Vui lòng thử lại.')
        draft=result.draft if collecting else None
        if draft:
            missing=[s[:250] for s in draft.missing_information]
            if draft.type_id not in {t['id'] for t in types}:draft.type_id=None;missing.append('Vui lòng chọn loại hỗ trợ từ danh mục.')
            if not draft.title.strip():missing.append('Vui lòng bổ sung tiêu đề.')
            if not draft.description.strip():missing.append('Vui lòng mô tả vấn đề cần hỗ trợ.')
            draft.missing_information=list(dict.fromkeys(missing))[:8]
            draft.ready_for_confirmation=bool(draft.title.strip() and draft.description.strip() and draft.type_id and not draft.missing_information)
        user=store(cur,session_id,'KHACH',body.content)
        sources=[dict(id=r['id'],question=r['question']) for r in safe_faqs]
        bot=store(cur,session_id,'BOT',dict(helpdesk_chatbot_v=1,answer=result.answer,offer_ticket=result.offer_ticket and not session['ticket_id'],draft=draft.model_dump() if draft else None,collecting=bool(collecting),sources=sources),safe_faqs[0]['id'] if safe_faqs else None)
        return dict(session=session,messages=[user,bot],has_older=False)

def cancel(user_id,session_id):
    with cursor(user_id,session_id,True) as (cur,session):
        if session['ticket_id']:raise HTTPException(409,'Phiên đã tạo phiếu, không thể hủy phiếu qua chatbot.')
        store(cur,session_id,'BOT',dict(helpdesk_chatbot_v=1,answer='Đã hủy bản nháp. Chưa tạo phiếu hỗ trợ.',draft=None,offer_ticket=False,collecting=False,sources=[]))
    return history(user_id,session_id)

def confirm(user_id,session_id,body):
    if body.confirmed is not True:raise HTTPException(422,'Cần xác nhận tạo phiếu rõ ràng.')
    ticket_body=TicketCreate(title=body.title,description=body.description,type_id=body.type_id)
    if gemini.sensitive(ticket_body.model_dump_json()):raise HTTPException(422,'Vui lòng bỏ thông tin bảo mật khỏi phiếu.')
    digest=hashlib.sha256(json.dumps(dict(ticket=ticket_body.model_dump(),draft_id=str(body.draft_message_id)),sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    with cursor(user_id,session_id,True) as (cur,session):
        last=latest(cur,session_id);value=envelope(last['content']) if last else {}
        if session['ticket_id']:
            if value.get('confirmation_digest')!=digest:raise HTTPException(409,'Phiên đã tạo phiếu. Vui lòng mở phiếu hiện có hoặc tạo phiên mới.')
            return dict(ticket=customer.ticket_row(cur,user_id,session['ticket_id']),replayed=True)
        if not last or str(body.draft_message_id)!=last['id'] or not value.get('draft'):
            raise HTTPException(409,'Bản nháp đã thay đổi hoặc đã hủy. Vui lòng mở lại lịch sử mới nhất.')
        ticket=customer.create_ticket_in_transaction(cur,user_id,ticket_body)
        execute(cur,'UPDATE {phien_chat} SET phieu_ma=%s,ket_thuc=clock_timestamp() WHERE phien_chat_ma=%s',(ticket['id'],session_id))
        store(cur,session_id,'BOT',dict(helpdesk_chatbot_v=1,answer='Đã tạo phiếu #HT-'+ticket['id']+'. Nhân viên phù hợp sẽ chủ động tiếp nhận.',draft=None,offer_ticket=False,collecting=False,sources=[],confirmation_digest=digest))
        return dict(ticket=ticket,replayed=False)
