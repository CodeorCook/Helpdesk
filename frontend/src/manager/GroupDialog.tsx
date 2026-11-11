import { useEffect, useState, type FormEvent } from 'react';
import { GroupTypesDialog } from './GroupTypesDialog';
import { UserMinus } from 'lucide-react';
import { Button, Input } from '../components';
import { ManagerDialog, ManagerStatus } from './Dialog';
import { MemberDialog } from './MemberDialog';
import { MembershipDialog } from './MembershipDialog';
import { managerApi } from './api';
import { ticketMetrics } from './metrics';
import type { GroupDetail } from './Groups';

export function GroupDialog({ id, close, changed }: { id: string; close: () => void; changed: () => void }) {
  const path = `/groups/${id}`;
  const [data, setData] = useState<GroupDetail>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<GroupDetail['people'][number]>();
  const [editingTypes, setEditingTypes] = useState(false);

  useEffect(() => {
    let active = true;
    managerApi<GroupDetail>(path).then(result => {
      if (active) setData(result);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [path]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || busy) return;
    const fd = new FormData(event.currentTarget);
    const expected = { name: data.name, description: data.description, active: data.active };
    const active = fd.get('active') === 'on';
    const name = String(fd.get('name')).trim();
    if (!name) {
      setError('Vui lòng nhập tên nhóm.');
      return;
    }
    if (data.active && !active && !window.confirm('Vô hiệu hóa nhóm? Các phiếu trong hàng đợi nhóm sẽ chờ điều phối.')) return;

    setBusy(true);
    setError('');
    try {
      await managerApi(path, { method: 'PATCH', body: JSON.stringify({ name, active, description: fd.get('description') || null, expected }) });
      changed();
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshMembers(message: string) {
    setNotice(message);
    changed();
    try {
      const fresh = await managerApi<GroupDetail>(path);
      // Keep the original edit snapshot so a concurrent group change still triggers a conflict on save.
      setData(previous => previous && { ...previous, people: fresh.people, pending: fresh.pending, stats: fresh.stats });
    } catch {
      setError('Thao tác đã thành công nhưng chưa tải lại được danh sách. Hãy đóng và mở lại chi tiết nhóm.');
    }
  }

  async function remove(employeeId: string, name: string) {
    if (busy || !window.confirm(`Bỏ ${name} khỏi nhóm này?`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await managerApi(`${path}/members/remove`, { method: 'POST', body: JSON.stringify({ employee_id: employeeId }) });
      await refreshMembers('Đã cập nhật nhóm. Đã bỏ thành viên.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <>
    <ManagerDialog title={data ? `Chỉnh sửa nhóm · ${data.name}` : 'Chỉnh sửa nhóm hỗ trợ'} onClose={close} busy={busy || adding || editingTypes || !!moving} wide>
      {error && <p role="alert" className="error-box">{error}</p>}
      {notice && <p role="status" className="success-box">{notice}</p>}
      {!data && !error && <p role="status">Đang tải chi tiết nhóm…</p>}
      {data && <>
        <section className="manager-group-section">
          <h3>Thông tin nhóm và chuyên môn</h3>
          <div className="manager-group-info">
            <form id="manager-edit-group" className="manager-form" onSubmit={save}>
              <Input id="group-name" label="Tên nhóm" name="name" defaultValue={data.name} maxLength={100} required/>
              <label className="field">Mô tả nhóm<textarea name="description" defaultValue={data.description ?? ''} rows={3} maxLength={5000}/></label>
              <label><input type="checkbox" name="active" defaultChecked={data.active}/> Nhóm đang hoạt động</label>
            </form>
            <div>
              <h4>Loại yêu cầu phụ trách</h4>
              {data.types.length ? <ul className="manager-group-types">{data.types.map(type => <li key={type.id}>{type.name}</li>)}</ul>
                : <p>Chưa có loại hỗ trợ được ánh xạ.</p>}
              <Button type="button" className="secondary" disabled={busy} onClick={() => setEditingTypes(true)}>Cập nhật loại yêu cầu</Button>
            </div>
          </div>
        </section>
        <section className="manager-group-section">
          <h3>Thống kê phiếu của nhóm</h3>
          <div className="table-scroll">
            <table className="ticket-table manager-group-stats">
              <thead><tr>{ticketMetrics.map(([key, label]) => <th key={key} scope="col">{label}</th>)}</tr></thead>
              <tbody><tr>{ticketMetrics.map(([key, label]) => <td key={key} data-label={label}>{data.stats?.[key] ?? '—'}</td>)}</tr></tbody>
            </table>
          </div>
          <p className="muted">{data.pending} phiếu đang giao chưa kết thúc. Hãy điều phối các phiếu liên quan trước khi vô hiệu hóa nhóm hoặc bỏ thành viên.</p>
        </section>
        <section className="manager-group-section">
          <div className="manager-section-heading"><h3>Thành viên nhóm</h3>
            <Button type="button" disabled={busy || !data.active} onClick={() => {
              setError('');
              setNotice('');
              setAdding(true);
            }}>Thêm thành viên</Button>
          </div>
          {!data.active && <p className="muted">Chỉ có thể thêm thành viên vào nhóm đang hoạt động.</p>}
          {data.people.length ? <div className="table-scroll"><table className="ticket-table">
            <thead><tr><th>Nhân viên</th><th>Trạng thái</th><th>Phiếu đang xử lý (mọi nhóm)</th><th>Thao tác</th></tr></thead>
            <tbody>{data.people.map(person => <tr key={person.id}>
              <td data-label="Nhân viên">{person.name}<small>#{person.id}</small>
                {(person.memberships?.length ?? 0) > 1 && <small>Đang thuộc {person.memberships?.length} nhóm</small>}
              </td>
              <td data-label="Trạng thái"><ManagerStatus active={person.status === 'HOAT_DONG'}/></td>
              <td data-label="Phiếu đang xử lý">{person.workload}</td>
              <td data-label="Thao tác"><div className="actions">
                {person.status === 'HOAT_DONG' && !!person.memberships?.length &&
                  <Button type="button" className="secondary" disabled={busy} onClick={() => setMoving(person)}>Chuyển nhóm</Button>}
                <Button type="button" className="secondary manager-icon-button"
                title="Bỏ thành viên" aria-label={`Bỏ thành viên ${person.name}`} disabled={busy}
                onClick={() => void remove(person.id, person.name)}>
                <UserMinus size={17} aria-hidden="true"/>
              </Button></div></td>
            </tr>)}</tbody>
          </table></div> : <p>Chưa có thành viên.</p>}
        </section>
        <div className="actions manager-dialog-actions">
          <Button className="secondary" type="button" disabled={busy} onClick={close}>Đóng</Button>
          <Button form="manager-edit-group" type="submit" disabled={busy}>{busy ? 'Đang xử lý…' : 'Lưu nhóm'}</Button>
        </div>
      </>}
    </ManagerDialog>
    {editingTypes && data && <GroupTypesDialog groupId={id} close={() => setEditingTypes(false)}
      onTypes={types => setData(previous => previous && { ...previous, types })}/>}
    {adding && data && <MemberDialog groupId={id} existing={data.people.map(person => person.id)}
      close={() => setAdding(false)} added={async () => {
        await refreshMembers('Đã cập nhật nhóm. Đã thêm thành viên.');
        setAdding(false);
      }}/>}
    {moving?.memberships && <MembershipDialog person={{...moving, memberships: moving.memberships}} currentGroup={id}
      close={() => setMoving(undefined)} saved={async message => {
        await refreshMembers(message);
        setMoving(undefined);
      }}/>}
  </>;
}
