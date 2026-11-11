import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRightLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Conversation } from '../chat/Conversation';
import { Button } from '../components';
import { formatDate } from '../customer/api';
import type { StaffTicket } from '../staff/api';
import { managerApi } from './api';
import { ManagerDialog } from './Dialog';
import { allGroups, type Group } from './Groups';

export type ManagerDetail = StaffTicket & {
  customer: { id: string; name: string };
  assignment_id: string | null;
  assignments: { id: string; employee: string; started_at: string; ended_at: string | null }[];
  history: { current: string; created_at: string }[];
};

function AssignmentDialog({ ticket, close, saved }: { ticket: ManagerDetail; close: () => void; saved: () => Promise<void> }) {
  const [groups, setGroups] = useState<Group[]>();
  const [group, setGroup] = useState(ticket.group_id ?? '');
  const [employee, setEmployee] = useState('');
  const [people, setPeople] = useState<{ id: string; name: string; workload: number }[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    allGroups().then(result => { if (active) setGroups(result); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setPeople(undefined);
    if (group) managerApi<typeof people>(`/groups/${group}/eligible-employees`).then(result => {
      if (active) setPeople(result);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [group]);

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !employee || !groups?.some(item => item.id === group && item.active)) return;
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    if (!reason) { setError('Vui lòng ghi lý do điều phối.'); return; }
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await managerApi(`/tickets/${ticket.id}/assignment`, {
        method: 'POST',
        body: JSON.stringify({ group_id: group, employee_id: employee === 'QUEUE' ? null : employee,
          expected_assignment_id: ticket.assignment_id, expected_updated_at: ticket.updated_at, reason }),
      });
      await saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <ManagerDialog title="Phân công lại phiếu" onClose={close} busy={busy}>
    <dl className="manager-account-summary">
      <dt>Mã phiếu</dt><dd>#HT-{ticket.id}</dd>
      <dt>Nhóm hiện tại</dt><dd>{ticket.group_name || 'Chưa xác định'}</dd>
      <dt>Người phụ trách</dt><dd>{ticket.assigned_to || 'Chưa phân công'}</dd>
    </dl>
    <form className="manager-form" onSubmit={assign}>
      <label className="field">Nhóm đích
        <select required value={group} disabled={busy || !groups} onChange={event => {
          setGroup(event.target.value); setEmployee(''); setPeople(undefined); setError('');
        }}>
          <option value="">Chọn nhóm hoạt động</option>
          {groups?.filter(item => item.active || item.id === ticket.group_id)
            .map(item => <option key={item.id} value={item.id} disabled={!item.active}>{item.name}{!item.active ? ' (đã ngừng)' : ''}</option>)}
        </select>
      </label>
      <label className="field">Phương án nhận phiếu
        <select required value={employee} disabled={busy || !group} onChange={event => setEmployee(event.target.value)}>
          <option value="">Chọn phương án</option><option value="QUEUE">Đưa về hàng đợi nhóm đích</option>
          {people?.map(person => <option key={person.id} value={person.id}>{person.name} · {person.workload} phiếu đang xử lý</option>)}
        </select>
      </label>
      <label className="field">Lý do điều phối<textarea name="reason" required maxLength={1000} rows={3} disabled={busy}/></label>
      {error && <p role="alert" className="error-box">{error}</p>}
      <div className="actions manager-dialog-actions">
        <Button type="button" className="secondary" onClick={close} disabled={busy}>Hủy</Button>
        <Button disabled={busy || !employee}>{busy ? 'Đang phân công…' : 'Xác nhận phân công lại'}</Button>
      </div>
    </form>
  </ManagerDialog>;
}

export function ManagerTicketDetail() {
  const { id } = useParams();
  return <TicketDetail key={id} id={id!}/>;
}

function TicketDetail({ id }: { id: string }) {
  const [data, setData] = useState<ManagerDetail>();
  const [assignment, setAssignment] = useState<ManagerDetail>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const version = useRef(0);
  const load = useCallback(async () => {
    const request = ++version.current;
    setLoading(true);
    try {
      const result = await managerApi<ManagerDetail>(`/tickets/${id}`);
      if (request === version.current) { setData(result); setError(''); }
    } catch (e) {
      if (request === version.current) setError((e as Error).message);
    } finally {
      if (request === version.current) setLoading(false);
    }
  }, [id]);
  useEffect(() => { void load(); return () => { version.current++; }; }, [load]);

  return <>
    <div className="manager-detail-navigation">
      <nav aria-label="Đường dẫn điều hướng">
        <Link to="/manager/tickets" className="text-link">Giám sát phiếu</Link>
        <ChevronRight size={16} aria-hidden="true"/><span aria-current="page">Phiếu #HT-{id}</span>
      </nav>
      <Button className="secondary manager-icon-button" aria-label="Làm mới phiếu" title="Làm mới phiếu"
        disabled={loading} onClick={() => void load()}><RefreshCw size={17} aria-hidden="true"/></Button>
    </div>
    {error && <p role="alert" className="error-box">{error}</p>}
    {notice && <p role="status" className="success-box">{notice}</p>}
    {!data && loading && <p role="status">Đang tải phiếu…</p>}
    {data && <>
      <div className="page-heading"><div><h1>{data.title}</h1><p>{data.customer.name} · Khách hàng #{data.customer.id}</p></div>
        <span className="badge">{data.status_label}</span></div>
      <div className="detail-grid">
        <div>
          <section className="panel"><h2>Nội dung yêu cầu</h2><p className="preserve-text">{data.description}</p></section>
          <Conversation role="manager" ticketId={data.id} revision={`${data.status}:${data.assignment_id}`} reload={load}/>
        </div>
        <aside>
          <section className="panel"><h2>Thông tin phiếu</h2><dl className="detail-meta">
            {[['Nhóm', data.group_name || 'Chưa xác định'], ['Phụ trách', data.assigned_to || 'Chưa phân công'],
              ['Loại hỗ trợ', data.type_name || 'Chưa phân loại'], ['Ưu tiên', data.priority]].map(([label, value]) =>
              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl></section>
          <section className="panel"><h2>SLA của phiếu</h2><span className="badge">{data.sla_state}</span>
            <p>{data.sla_name || 'Chưa cấu hình SLA'}</p><dl className="detail-meta">
              {[['Hạn phản hồi', data.response_due], ['Hạn xử lý', data.resolution_due],
                ['Phản hồi đầu', data.first_response_at], ['Giải quyết lúc', data.resolved_at]].map(([label, value]) =>
                <div key={label}><dt>{label}</dt><dd>{value ? formatDate(value) : 'Chưa có'}</dd></div>)}
            </dl>
          </section>
          <section className="panel"><h2>Lịch sử phân công</h2>
            {data.assignments.length ? <ol className="timeline">{data.assignments.map(item => <li key={item.id}>
              <strong>{item.employee}</strong><small>{formatDate(item.started_at)}</small>
              <small>{item.ended_at ? `Kết thúc: ${formatDate(item.ended_at)}` : 'Đang hiệu lực'}</small>
            </li>)}</ol> : <p>Chưa có phân công.</p>}
          </section>
          <section className="panel"><h2>Lịch sử trạng thái</h2>
            <ol className="timeline">{data.history.map((item, i) => <li key={i}>
              <strong>{item.current}</strong><small>{formatDate(item.created_at)}</small>
            </li>)}</ol>
          </section>
        </aside>
      </div>
      {['MOI', 'DANG_XU_LY', 'TAM_DUNG'].includes(data.status) && <div className="manager-ticket-actions">
        <Button disabled={loading || !!error} onClick={() => setAssignment(data)}><ArrowRightLeft size={17} aria-hidden="true"/> Phân công lại</Button>
      </div>}
    </>}
    {assignment && <AssignmentDialog ticket={assignment} close={() => { setAssignment(undefined); void load(); }}
      saved={async () => {
        setAssignment(undefined);
        setNotice('Đã phân công lại phiếu.');
        await load();
      }}/>}
  </>;
}
