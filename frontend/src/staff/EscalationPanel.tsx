import {useRef,useState} from 'react';
import {AlertTriangle} from 'lucide-react';
import {Button} from '../components';
import {RequestDialog} from '../customer/RequestDialog';
import {formatDate} from '../customer/api';
import {staffApi,type StaffTicket} from './api';

export type Escalation={id:string;ticket_id:string;requester_id:string;requester:string;source_group_id:string;source_group:string;
  reason:string;created_at:string;status:'CHO_XU_LY'|'DA_DIEU_PHOI'|'TU_CHOI';handled_at:string|null;outcome:string|null;
  manager:string|null;assigned_to:string|null;assigned_id:string|null;result_assignment_id:string|null};
const labels={CHO_XU_LY:'Đang chờ Quản lý điều phối',DA_DIEU_PHOI:'Đã điều phối',TU_CHOI:'Từ chối điều phối'};

export function EscalationHistory({items}:{items:Escalation[]}) {
  return <>{items.map(item=><article className="staff-escalation-result" key={item.id}>
    <span className={item.status==='CHO_XU_LY'?'badge staff-escalation-pending':'badge'}>{labels[item.status]}</span>
    <p className="preserve-text">{item.reason}</p><small>{item.requester} · {formatDate(item.created_at)}</small>
    {item.outcome&&<><p className="preserve-text">Kết quả: {item.outcome}</p><small>{item.manager} · {item.handled_at&&formatDate(item.handled_at)}</small>
      {item.assigned_to&&<p>Người nhận khi điều phối: {item.assigned_to}</p>}</>}
  </article>)}</>;
}

export function EscalationPanel({ticket,items,configured,canProcess,reload}:{ticket:StaffTicket;items:Escalation[];configured:boolean;canProcess:boolean;reload:()=>Promise<void>}) {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const gate=useRef(false);
  const pending=items.some(item=>item.status==='CHO_XU_LY');
  const eligible=canProcess&&ticket.sla_phase!=='provisional'&&['DANG_XU_LY','TAM_DUNG'].includes(ticket.status);
  return <section className="panel"><h2>Điều phối khẩn</h2>
    {!configured&&<p className="muted">Chưa cấu hình điều phối khẩn. Cần áp dụng migration 007_ticket_escalation.sql.</p>}
    {notice&&<p className="success-box" role="status">{notice}</p>}
    {configured&&eligible&&!pending&&<Button className="secondary staff-escalate-button" onClick={()=>{setError('');setOpen(true);}}><AlertTriangle size={17}/> Chuyển khẩn lên Quản lý</Button>}
    <EscalationHistory items={items}/>
    {configured&&items.length>0&&<Button className="secondary" disabled={busy} onClick={async()=>{
      if(gate.current)return;gate.current=true;setBusy(true);
      try{await reload();}finally{gate.current=false;setBusy(false);}
    }}>{busy?'Đang tải…':'Cập nhật điều phối'}</Button>}
    {configured&&!items.length&&!eligible&&<p className="muted">Chỉ người phụ trách phiếu đang xử lý hoặc tạm dừng được gửi yêu cầu.</p>}
    {open&&<RequestDialog title="Chuyển phiếu khẩn lên Quản lý" busy={busy} close={()=>setOpen(false)}>
      <p><strong>#HT-{ticket.id} · {ticket.title}</strong></p>
      <dl className="detail-meta"><div><dt>Nhóm</dt><dd>{ticket.group_name}</dd></div><div><dt>Phụ trách</dt><dd>{ticket.assigned_to}</dd></div>
        <div><dt>Ưu tiên</dt><dd>{ticket.priority}</dd></div><div><dt>SLA</dt><dd>{ticket.sla_state}</dd></div></dl>
      <form className="customer-form" onSubmit={async e=>{
        e.preventDefault();if(gate.current)return;
        const reason=String(new FormData(e.currentTarget).get('reason')||'').trim();
        if(!reason){setError('Vui lòng mô tả cụ thể lý do điều phối.');return;}
        gate.current=true;setBusy(true);setError('');
        try{await staffApi(`/tickets/${ticket.id}/escalations`,{method:'POST',body:JSON.stringify({reason,expected_updated_at:ticket.updated_at})});
          setOpen(false);setNotice('Đã gửi yêu cầu điều phối khẩn. Phụ trách, trạng thái và SLA giữ nguyên.');await reload();
        }catch(err){setError((err as Error).message);}finally{gate.current=false;setBusy(false);}
      }}>
        <label className="field">Lý do cần điều phối<textarea name="reason" required maxLength={2000} rows={5}
          placeholder="Vượt chuyên môn, quá tải hoặc cần chuyển nhóm khác… Hãy mô tả tình huống cụ thể."/></label>
        {error&&<p className="error-box" role="alert">{error}</p>}
        <div className="actions"><Button type="button" className="secondary" disabled={busy} onClick={()=>setOpen(false)}>Hủy</Button>
          <Button disabled={busy}>{busy?'Đang gửi…':'Xác nhận chuyển khẩn'}</Button></div>
      </form>
    </RequestDialog>}
  </section>;
}
