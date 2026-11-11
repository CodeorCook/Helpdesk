import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, Pencil, Ban } from 'lucide-react';
import { Button, Input } from '../components';
import { ApiError } from '../api';
import { Completion } from './Completion';
import { RequestDialog } from './RequestDialog';
import { customerApi, formatDate, type Catalog, type Ticket } from './api';
import type { DetailData } from './Detail';

type RequestMode = 'view' | 'edit' | 'cancel';
export const usesRequestSummary = (status: string) => ['MOI', 'DA_HUY', 'DA_DONG'].includes(status);
export function TicketStatus({ ticket }: { ticket: Ticket }) {
  return <span className={`staff-status-badge staff-status-${ticket.status.toLowerCase()}`}>{ticket.status_label}</span>;
}

export function RequestSummary({ id, initial, close, changed }: {
  id: string; initial?: DetailData; close: () => void; changed: (message?: string) => void;
}) {
  const [data, setData] = useState(initial);
  const [mode, setMode] = useState<RequestMode>('view');
  const [types, setTypes] = useState<Catalog[]>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const path = `/tickets/${id}`;

  useEffect(() => {
    if (initial) return;
    let active = true;
    customerApi<DetailData>(path).then(result => {
      if (active) {
        setData(result);
        if (!result.can_modify) setMode('view');
      }
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [initial, path]);

  useEffect(() => {
    if (mode !== 'edit' || !data?.can_modify || types) return;
    let active = true;
    customerApi<Catalog[]>('/ticket-types').then(result => { if (active) setTypes(result); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [mode, data?.can_modify, types]);

  async function reload() {
    setData(await customerApi<DetailData>(path));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.can_modify || submitting.current) return;
    const fields = new FormData(event.currentTarget);
    const cancelling = mode === 'cancel';
    const reason = String(fields.get('reason') ?? '').trim();
    const title = String(fields.get('title') ?? '').trim();
    const description = String(fields.get('description') ?? '').trim();
    if (cancelling ? !reason : !title || !description) {
      setError(cancelling ? 'Vui lòng nhập lý do hủy yêu cầu.' : 'Tiêu đề và mô tả không được để trống.');
      return;
    }

    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const ticket = await customerApi<Ticket>(cancelling ? `${path}/cancel` : path, {
        method: cancelling ? 'POST' : 'PATCH',
        body: JSON.stringify(cancelling ? { reason } : { title, description, type_id: fields.get('type_id') }),
      });
      setData(previous => previous && { ...previous, ...ticket });
      setMode('view');
      const message = cancelling ? 'Đã hủy yêu cầu thành công' : 'Đã cập nhật yêu cầu';
      setNotice(message);
      changed(message);
      if (cancelling && !initial) close();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) {
        setMode('view');
        setData(previous => previous && { ...previous, can_modify: false });
        changed();
        try { await reload(); } catch { /* Keep the actions disabled until the user opens the request again. */ }
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function switchMode(next: RequestMode) {
    setError('');
    setNotice('');
    setMode(next);
  }
  const editable = Boolean(data?.can_modify && data.status === 'MOI');
  const title = editable && mode === 'cancel' ? 'Xác nhận hủy yêu cầu'
    : editable && mode === 'edit' ? 'Chỉnh sửa yêu cầu' : 'Chi tiết yêu cầu';

  return <RequestDialog title={title} busy={busy} close={() => { if (!submitting.current) close(); }}>
    {error && <p role="alert" className="error-box">{error}</p>}
    {notice && <p role="status" className="success-box">{notice}</p>}
    {!data && !error && <p role="status">Đang tải yêu cầu…</p>}
    {data && <>
      <p><strong>#HT-{data.id} · {data.title}</strong></p>
      {editable && mode !== 'view' ? <form className="customer-form" onSubmit={submit}>
        {mode === 'cancel' ? <>
          <p className="customer-cancel-warning"><CircleAlert size={20} aria-hidden="true"/> Sau khi hủy, yêu cầu này sẽ không còn được tiếp nhận xử lý.</p>
          <label className="field">Lý do hủy yêu cầu<textarea name="reason" rows={4} required maxLength={500}/></label>
        </> : <>
          <Input id="customer-request-title" name="title" label="Tiêu đề" defaultValue={data.title} maxLength={200} required/>
          <label className="field">Loại hỗ trợ<select name="type_id" defaultValue={data.type_id ?? ''} key={types ? 'loaded' : 'loading'} required disabled={!types}>
            <option value="">Chọn loại hỗ trợ</option>
            {types?.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
          </select></label>
          <label className="field">Mô tả chi tiết<textarea name="description" defaultValue={data.description} maxLength={20000} rows={5} required/></label>
          <small>Tệp đã tải lên được giữ lại.</small>
        </>}
        <div className="actions">
          <Button type="button" className="secondary" disabled={busy} onClick={() => switchMode('view')}>{mode === 'cancel' ? 'Quay lại' : 'Hủy thay đổi'}</Button>
          <Button type="submit" className={mode === 'cancel' ? 'customer-danger-button' : ''} disabled={busy || (mode === 'edit' && !types)}>
            {busy ? 'Đang lưu…' : mode === 'cancel' ? 'Xác nhận hủy yêu cầu' : 'Lưu thay đổi'}
          </Button>
        </div>
      </form> : <>
        <TicketStatus ticket={data}/>
        <dl className="detail-meta">{[
          ['Loại hỗ trợ', data.type_name ?? 'Chưa phân loại'], ['Thời gian gửi', formatDate(data.created_at)],
          ['Mức ưu tiên', data.priority], ['Nhân viên phụ trách', data.assigned_to ?? 'Chưa phân công'],
        ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <h3>Nội dung yêu cầu</h3><p className="preserve-text">{data.description}</p>
        {!!data.attachments.length && <><h3>Tệp đính kèm</h3><ul>{data.attachments.map(file => <li key={file.id}>
          <a className="text-link" href={`/api/v1/customer/tickets/${id}/attachments/${file.id}`}>{file.name}</a>
        </li>)}</ul></>}
        {data.status === 'DA_DONG' && <>
          {data.closed_by_customer && <p>Khách hàng đã xác nhận hoàn tất.</p>}
          {data.history.length > 0 && <details><summary>Lịch sử trạng thái</summary><ol className="timeline">{data.history.map((item, i) =>
            <li key={i}>{item.current} · {formatDate(item.created_at)}</li>)}</ol></details>}
        </>}
        {data.end_reason && <p className="preserve-text"><strong>{data.termination_kind === 'TU_CHOI_YEU_CAU' ? 'Lý do không tiếp nhận: ' : data.status === 'DA_HUY' ? 'Lý do hủy: ' : 'Lý do đóng: '}</strong>{data.end_reason}</p>}
        {data.termination_kind === 'TU_CHOI_YEU_CAU' && data.closed_at && <p>Thời điểm xử lý: {formatDate(data.closed_at)}</p>}
        {data.status === 'DA_DONG' && data.termination_kind !== 'TU_CHOI_YEU_CAU' && <Completion data={data} reload={reload}/>}
        {!usesRequestSummary(data.status) && <p><Link className="text-link" to={`/customer/tickets/${id}`} onClick={close}>Mở chi tiết và hội thoại</Link></p>}
        <div className="actions customer-profile-actions">
          <Button type="button" className="secondary" onClick={close}>Đóng</Button>
          <Button type="button" className="secondary" disabled={!editable} onClick={() => switchMode('edit')}><Pencil size={16}/> Chỉnh sửa</Button>
          <Button type="button" className="secondary customer-danger-button" disabled={!editable} onClick={() => switchMode('cancel')}><Ban size={16}/> Hủy yêu cầu</Button>
        </div>
      </>}
    </>}
  </RequestDialog>;
}
