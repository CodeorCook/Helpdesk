import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRightLeft, Trash2 } from 'lucide-react';
import { Button } from '../components';
import { managerApi } from './api';
import { ManagerDialog, ManagerStatus } from './Dialog';
import { allGroups, type Group } from './Groups';

type Mapping = {
  type_id: string;
  type_name: string;
  type_active: boolean;
  group_id: string | null;
  waiting: number;
};
type RoutingData = { rows: Mapping[]; groups: Group[] };
type Change = { kind: 'remove' | 'move'; row: Mapping };
const limit = 2;

async function loadRouting(): Promise<RoutingData> {
  const [rows, groups] = await Promise.all([managerApi<Mapping[]>('/routing'), allGroups()]);
  return { rows, groups };
}

export function GroupTypesDialog({ groupId, close, onTypes }: {
  groupId: string;
  close: () => void;
  onTypes: (types: { id: string; name: string }[]) => void;
}) {
  const [data, setData] = useState<RoutingData>();
  const [change, setChange] = useState<Change>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let active = true;
    loadRouting().then(result => { if (active) setData(result); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (notice && !busy) feedback.current?.focus();
  }, [notice, busy]);

  const group = data?.groups.find(item => item.id === groupId);
  const rows = data?.rows ?? [];
  const assigned = rows.filter(row => row.group_id === groupId);
  const unassigned = rows.filter(row => !row.group_id && row.type_active);
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.group_id) counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1);
  }
  const targets = data?.groups.filter(item => item.id !== groupId && item.active && (counts.get(item.id) ?? 0) < limit) ?? [];

  function replaceData(result: RoutingData) {
    setData(result);
    onTypes(result.rows.filter(row => row.group_id === groupId)
      .map(row => ({ id: row.type_id, name: row.type_name })));
  }

  async function mutate(row: Mapping, destination: string | null) {
    if (!data || request.current) return;
    request.current = true;
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const endpoint = `/routing/${row.type_id}`;
      const result = await (destination === null
        ? managerApi<{ message: string }>(`${endpoint}?expected_group_id=${row.group_id}`, { method: 'DELETE' })
        : managerApi<{ message: string }>(endpoint, {
          method: 'PATCH',
          body: JSON.stringify({ group_id: destination, expected_group_id: row.group_id }),
        }));
      setChange(undefined);
      setNotice(result.message);
      replaceData({ ...data, rows: data.rows.map(item => item.type_id === row.type_id
        ? { ...item, group_id: destination } : item) });
    } catch (e) {
      setError((e as Error).message);
    }
    try {
      replaceData(await loadRouting());
    } catch {
      setError(previous => previous || 'Chưa tải lại được ánh xạ. Hãy đóng và mở lại hộp thoại để kiểm tra dữ liệu mới nhất.');
    } finally {
      request.current = false;
      setBusy(false);
    }
  }

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!change) return;
    const destination = change.kind === 'remove' ? null : String(new FormData(event.currentTarget).get('destination'));
    void mutate(change.row, destination);
  }

  return <>
    <ManagerDialog title="Cập nhật loại yêu cầu" onClose={close} busy={busy || !!change}>
      {!data && !error && <p role="status">Đang tải ánh xạ…</p>}
      {error && !change && <p role="alert" className="error-box">{error}</p>}
      {notice && <p ref={feedback} tabIndex={-1} role="status" className="success-box">{notice}</p>}
      {group && <>
        <div className="manager-section-heading"><h3>{group.name}</h3><ManagerStatus active={group.active} inactiveLabel="Đã vô hiệu hóa"/></div>
        <p><strong>{assigned.length}/{limit} loại yêu cầu{assigned.length > limit ? ' – Vượt giới hạn' : ''}</strong></p>
        {assigned.length > limit && <p className="notice">Nhóm hiện đang phụ trách nhiều hơn 2 loại yêu cầu. Vui lòng bỏ bớt hoặc chuyển loại yêu cầu sang nhóm khác.</p>}
        {assigned.length ? <ul className="manager-routing-list">{assigned.map(row => <li key={row.type_id}>
          <span>{row.type_name}{!row.type_active && <small> · Đã ngừng</small>}</span>
          <div className="manager-routing-actions">
            <Button type="button" className="secondary manager-icon-button" title="Chuyển sang nhóm khác"
              aria-label={`Chuyển ${row.type_name} sang nhóm khác`} disabled={busy || !targets.length}
              onClick={() => { setError(''); setChange({ kind: 'move', row }); }}><ArrowRightLeft size={17} aria-hidden="true"/></Button>
            <Button type="button" className="secondary manager-icon-button" title="Bỏ khỏi nhóm"
              aria-label={`Bỏ khỏi nhóm: ${row.type_name}`} disabled={busy}
              onClick={() => { setError(''); setChange({ kind: 'remove', row }); }}><Trash2 size={17} aria-hidden="true"/></Button>
          </div>
        </li>)}</ul> : <p>Nhóm chưa phụ trách loại yêu cầu nào.</p>}
        {!targets.length && assigned.length > 0 && <p className="muted">Chưa có nhóm đích đang hoạt động và còn chỗ.</p>}
        {assigned.length >= limit && <p className="muted">Nhóm đã đạt giới hạn tối đa 2 loại yêu cầu. Vui lòng bỏ bớt loại hiện tại trước khi thêm mới.</p>}
        {!group.active && <p className="muted">Nhóm cần hoạt động để nhận loại yêu cầu mới.</p>}
        <form className="manager-form" onSubmit={event => {
          event.preventDefault();
          const id = new FormData(event.currentTarget).get('type_id');
          const row = unassigned.find(item => item.type_id === id);
          if (row) void mutate(row, groupId);
        }}>
          <label className="field">Loại yêu cầu chưa có nhóm mặc định
            <select name="type_id" required defaultValue="" disabled={busy || !unassigned.length}>
              <option value="">Chọn loại yêu cầu</option>
              {unassigned.map(row => <option key={row.type_id} value={row.type_id}>{row.type_name} · {row.waiting} phiếu chờ</option>)}
            </select>
          </label>
          <Button disabled={busy || !group.active || assigned.length >= limit || !unassigned.length}>Thêm loại yêu cầu</Button>
        </form>
      </>}
      <div className="actions manager-dialog-actions"><Button className="secondary" disabled={busy} onClick={close}>Đóng</Button></div>
    </ManagerDialog>
    {change && group && <ManagerDialog title={change.kind === 'remove' ? 'Xác nhận bỏ ánh xạ' : 'Chuyển nhóm phụ trách'}
      busy={busy} onClose={() => setChange(undefined)}>
      <form className="manager-form" onSubmit={confirm}>
        <p>Loại yêu cầu <strong>{change.row.type_name}</strong></p>
        <p>Nhóm hiện tại <strong>{group.name}</strong></p>
        {change.kind === 'remove' ? <p>Loại yêu cầu sẽ tạm thời không có nhóm xử lý mặc định cho đến khi được gán lại.</p> :
          <label className="field">Nhóm đích
            <select required name="destination" defaultValue="" disabled={busy}>
              <option value="">Chọn nhóm đang hoạt động và còn chỗ</option>
              {targets.map(item => <option value={item.id} key={item.id}>{item.name} ({counts.get(item.id) ?? 0}/{limit})</option>)}
            </select>
          </label>}
        <p className="muted">Phiếu đã tiếp nhận giữ nguyên nhóm và người phụ trách.</p>
        {error && <p role="alert" className="error-box">{error}</p>}
        <div className="actions manager-dialog-actions">
          <Button type="button" className="secondary" disabled={busy} onClick={() => setChange(undefined)}>Hủy</Button>
          <Button disabled={busy || !assigned.some(row => row.type_id === change.row.type_id)}>
            {busy ? 'Đang xử lý…' : change.kind === 'remove' ? 'Xác nhận bỏ ánh xạ' : 'Xác nhận chuyển'}
          </Button>
        </div>
      </form>
    </ManagerDialog>}
  </>;
}
