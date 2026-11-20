import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Ban, Clipboard, ChevronRight, CircleAlert } from 'lucide-react';
import { Button, Input } from '../components';
import { Attachment } from '../chat/Attachment';
import type { ChatAttachment } from '../chat/useConversation';
import { RequestDialog } from '../customer/RequestDialog';
import { ApiError } from '../api';
import { formatDate, type Catalog } from '../customer/api';
import { staffApi, type StaffTicket } from './api';

type RequestData = StaffTicket & { customer: { name: string }; attachments: ChatAttachment[]; assignment_id?: string | null };
const blank = { title: '', description: '', type_id: '', priority_id: '' };

export function RequestReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<RequestData>();
  const [catalog, setCatalog] = useState<{ types: Catalog[]; priorities: Catalog[] }>();
  const [draft, setDraft] = useState(blank);
  const [confirmFill, setConfirmFill] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectError, setRejectError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [legacyConfirmed,setLegacyConfirmed]=useState(false);
  const [preview,setPreview]=useState<{priority:string;policy:{id:string;name:string;response_minutes:number;resolution_minutes:number}|null}>();
  const [previewError,setPreviewError]=useState('');
  const [previewRevision,setPreviewRevision]=useState(0);
  useEffect(()=>{let alive=true;setPreview(undefined);setPreviewError('');
    if(draft.priority_id)staffApi<{policy:{id:string;name:string;response_minutes:number;resolution_minutes:number}|null}>(`/sla-preview?priority_id=${draft.priority_id}`).then(result=>{if(alive)setPreview({priority:draft.priority_id,policy:result.policy});}).catch(e=>{if(alive)setPreviewError(e.message);});
    return()=>{alive=false;};},[draft.priority_id,previewRevision]);
  const [revision, setRevision] = useState(0);
  const submitting = useRef(false);
  const canApprove = data?.status === 'MOI' && !data.assigned_id && !data.assignment_id;

  useEffect(() => {
    let active = true;
    Promise.all([staffApi<RequestData>(`/tickets/${id}`), staffApi<Catalog[]>('/ticket-types'), staffApi<Catalog[]>('/priorities')])
      .then(([request, types, priorities]) => {
        if (!active) return;
        setData(request);
        setCatalog({ types, priorities });
        setStale(false);
      }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id, revision]);

  function fill() {
    if (!data) return;
    setDraft(previous => ({ ...previous, title: data.title, description: data.description, type_id: data.type_id ?? '' }));
    setConfirmFill(false);
  }

  async function reject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !canApprove || stale || submitting.current) return;
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    if (!reason || reason.length > 500) {
      setRejectError('Vui lòng nhập lý do không tiếp nhận, tối đa 500 ký tự.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    setRejectError('');
    try {
      await staffApi(`/tickets/${id}/reject`, {
        method: 'POST', body: JSON.stringify({ reason, expected_updated_at: data.updated_at }),
      });
      navigate('/staff/queue', { replace: true, state: { rejected: true } });
    } catch (e) {
      const message = (e as Error).message;
      if (e instanceof ApiError && (e.status === 409 || e.status === 404)) {
        setStale(true);
        setError(message);
        setRejectOpen(false);
      } else setRejectError(message);
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !canApprove || submitting.current || stale) return;
    const required = [
      [draft.title.trim(), 'Nhập tiêu đề phiếu hỗ trợ.'], [draft.type_id, 'Chọn loại hỗ trợ.'],
      [draft.description.trim(), 'Nhập mô tả phiếu hỗ trợ.'], [draft.priority_id, 'Chọn mức ưu tiên.'],
    ];
    const missing = required.find(([value]) => !value);
    if (missing) { setError(missing[1]); return; }
    if (!preview?.policy || preview.priority !== draft.priority_id) {setError('Chưa có SLA đang áp dụng hoặc chưa tải được xem trước. Nội dung đã nhập được giữ nguyên.');return;}
    if (data.sla_id && data.sla_phase === 'legacy' && !legacyConfirmed) {setError('Cần xác nhận thay SLA trên yêu cầu cũ chưa xác định tạm tính/chính thức.');return;}
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await staffApi<StaffTicket>(`/tickets/${id}/approve`, {
        method: 'POST', body: JSON.stringify({ ...draft, expected_updated_at: data.updated_at, confirm_legacy_sla_replacement: legacyConfirmed }),
      });
      navigate(`/staff/tickets/${result.id}`, { replace: true, state: { approved: true } });
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && (e.status === 409 || e.status === 404)) setStale(true);
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  return <>
    <div className="page-heading"><div><h1>Xem yêu cầu và lập phiếu hỗ trợ</h1>
      <nav className="staff-review-breadcrumb" aria-label="Đường dẫn điều hướng">
        <Link className="text-link" to="/staff/queue">Yêu cầu chờ tiếp nhận</Link>
        <ChevronRight size={16} aria-hidden="true"/><span aria-current="page">Phiếu #HT-{id}</span>
      </nav></div></div>
    {error && <p className="error-box" role="alert">{error}</p>}
    {stale && <Button className="secondary" onClick={() => {
      setData(undefined); setError(''); setRevision(value => value + 1);
    }}>Tải lại yêu cầu</Button>}
    {!data && !error && <p role="status">Đang tải yêu cầu…</p>}
    {data && data.status !== 'MOI' && <p>Yêu cầu không còn chờ tiếp nhận. <Link className="text-link" to={`/staff/tickets/${id}`}>Xem chi tiết phiếu</Link></p>}
    {data?.status === 'MOI' && !canApprove && <p>Yêu cầu đã có phân công. Hãy làm mới hàng đợi.</p>}
    {data && canApprove && catalog && <div className="staff-review-grid">
      <section className="panel">
        <h2>Yêu cầu khách gửi</h2>
        <dl className="staff-review-original">
          <dt>Mã yêu cầu</dt><dd>#HT-{data.id}</dd>
          <dt>Tên khách hàng</dt><dd>{data.customer.name}</dd>
          <dt>Thời gian gửi yêu cầu</dt><dd>{formatDate(data.created_at)}</dd>
          <div className="staff-review-status">
            <dt>Trạng thái:</dt><dd><span className="staff-status-badge staff-status-moi">{data.status_label}</span></dd>
          </div>
          <dt>Tiêu đề yêu cầu</dt><dd className="preserve-text">{data.title}</dd>
          <dt>Loại hỗ trợ</dt><dd>{data.type_name ?? 'Chưa phân loại'}</dd>
          <dt>Mô tả chi tiết</dt><dd className="preserve-text">{data.description}</dd>
          <dt>Tệp đính kèm</dt><dd>{data.attachments.length ? data.attachments.map(file =>
            <Attachment key={file.id} file={file} role="staff" ticketId={data.id}/>) : 'Không có tệp đính kèm.'}</dd>
        </dl>
        <div className="actions">
          <Button className="secondary" disabled={busy || stale} onClick={() => {
            if (draft.title || draft.description || draft.type_id) setConfirmFill(true);
            else fill();
          }}><Clipboard size={16}/> Dùng thông tin khách gửi</Button>
        </div>
        {confirmFill && <div className="confirm-box" role="group" aria-label="Xác nhận ghi đè bản nháp">
          <p>Thay tiêu đề, loại hỗ trợ và mô tả đang nhập bằng nội dung khách gửi?</p>
          <div className="actions"><Button disabled={busy || stale} onClick={fill}>Thay nội dung</Button>
            <Button className="secondary" onClick={() => setConfirmFill(false)}>Giữ bản nháp</Button></div>
        </div>}
      </section>
      <div className="staff-review-actions">
      <form className="panel customer-form" noValidate onSubmit={approve}>
        <h2>Lập phiếu hỗ trợ</h2>
        <Input id="review-title" label="Tiêu đề phiếu hỗ trợ" maxLength={200} required value={draft.title}
          onChange={e => setDraft({ ...draft, title: e.target.value })}/>
        <label className="field">Loại hỗ trợ<select required value={draft.type_id} onChange={e => setDraft({ ...draft, type_id: e.target.value })}>
          <option value="">Chọn loại hỗ trợ</option>
          {data?.type_id && !catalog.types.some(type => type.id === data.type_id) && <option value={data.type_id}>{data.type_name} (đã ngừng, yêu cầu cũ)</option>}
          {catalog.types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
        </select></label>
        <label className="field">Mô tả đã chuẩn hóa<textarea required rows={7} maxLength={20000} value={draft.description}
          onChange={e => setDraft({ ...draft, description: e.target.value })}/></label>
        <label className="field">Mức độ ưu tiên<select required value={draft.priority_id} onChange={e => setDraft({ ...draft, priority_id: e.target.value })}>
          <option value="">Chọn mức ưu tiên</option>
          {catalog.priorities.map(priority => <option key={priority.id} value={priority.id}>{priority.name}</option>)}
        </select></label>
        <small>Thấp: tư vấn thông thường, ít ảnh hưởng. Trung bình: cần xử lý nhưng chưa khẩn cấp. Cao: sự cố nghiêm trọng hoặc có nguy cơ mất an toàn.</small>
        <section className="notice staff-sla-preview" aria-live="polite"><strong>Chính sách SLA sẽ áp dụng</strong>
          {preview?.priority===draft.priority_id ? preview.policy?<><p>{preview.policy.name} · #{preview.policy.id}</p><p>Phản hồi: {preview.policy.response_minutes} phút · Xử lý: {preview.policy.resolution_minutes} phút.</p></>:<p>Chưa có SLA đang áp dụng cho mức ưu tiên này. Vui lòng liên hệ Quản lý trước khi lập phiếu.</p>:
            <p>{previewError || (draft.priority_id?'Đang tải SLA…':'Chọn mức ưu tiên để xem SLA.')}</p>}
          <Button type="button" className="secondary" disabled={busy || !draft.priority_id} onClick={()=>setPreviewRevision(v=>v+1)}>Cập nhật xem trước SLA</Button>
          <small>Hạn tính liên tục từ lúc khách gửi. Backend gắn phiên bản hiệu lực tại lúc xác nhận; xem trước có thể thay đổi.</small>
        </section>
        {data.sla_id && data.sla_phase==='legacy' && <label className="notice"><input type="checkbox" checked={legacyConfirmed} onChange={e=>setLegacyConfirmed(e.target.checked)}/> Tôi xác nhận thay SLA của yêu cầu cũ bằng SLA hiệu lực theo ưu tiên đã chọn khi xét duyệt. Snapshot SLA trước đó vẫn được lưu.</label>}
        <div className="actions">
          <Button type="submit" disabled={busy || stale || !preview?.policy || preview.priority !== draft.priority_id}>{busy ? 'Đang lập phiếu…' : 'Lập phiếu hỗ trợ'}</Button>
        </div>
      </form>
      <Button style={{ width: '100%' }} className="secondary customer-danger-button staff-review-reject" disabled={busy || stale} onClick={() => {
        setRejectError('');
        setRejectOpen(true);
      }}><Ban size={16} aria-hidden="true"/> Không tiếp nhận</Button>
      </div>
    </div>}
    {rejectOpen && data && <RequestDialog title="Xác nhận không tiếp nhận" busy={busy}
      close={() => { if (!submitting.current) setRejectOpen(false); }}>
      <form className="staff-reject-form" onSubmit={reject}>
        <strong>#HT-{data.id} · {data.title}</strong>
        <p className="customer-cancel-warning"><CircleAlert size={18} aria-hidden="true"/> Yêu cầu sẽ kết thúc mà không lập Phiếu hỗ trợ.</p>
        <label className="field">Lý do không tiếp nhận<textarea name="reason" required maxLength={500} rows={4}/></label>
        {rejectError && <p role="alert" className="error-box">{rejectError}</p>}
        <div className="actions">
          <Button type="button" className="secondary" disabled={busy} onClick={() => setRejectOpen(false)}>Hủy</Button>
          <Button type="submit" className="customer-danger-button" disabled={busy}>{busy ? 'Đang xử lý…' : 'Xác nhận không tiếp nhận'}</Button>
        </div>
      </form>
    </RequestDialog>}
    {!canApprove && <Link className="text-link" to="/staff/queue">Quay lại danh sách</Link>}
  </>;
}
