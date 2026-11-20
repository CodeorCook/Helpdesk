import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Pencil, Power, Trash2 } from 'lucide-react';
import { Button, Input } from '../components';
import { managerApi, type Page } from './api';
import { ManagerDialog, ManagerStatus } from './Dialog';
import { ManagerPagination, lastPage } from './Pagination';

export type SupportType = { id: string; name: string; description: string | null; active: boolean;
  groups: { id: string; name: string; is_default: boolean }[]; tickets: number; waiting: number };
export const typeSnapshot = (row: SupportType) => ({ name: row.name, description: row.description, active: row.active });

function TypeForm({ row, close, saved }: { row?: SupportType; close: () => void; saved: () => void }) {
  const [busy, setBusy] = useState(false);
  const gate = useRef(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{name:string;description:string|null;active:boolean}>();
  async function send(body: {name:string;description:string|null;active:boolean}) {
    if (gate.current) return;
    gate.current = true; setBusy(true); setError('');
    try {
      await managerApi(`/support-types${row ? `/${row.id}` : ''}`, { method: row ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...body, ...(row ? { expected: typeSnapshot(row) } : {}) }) });
      saved();
    } catch (e) { setError((e as Error).message); setPending(undefined); }
    finally { gate.current = false; setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const body = { name: String(fd.get('name')).trim(), description: String(fd.get('description') || '').trim() || null, active: fd.get('active') === 'on' };
    if (!body.name) { setError('Vui lòng nhập tên loại hỗ trợ.'); return; }
    if (row?.active && !body.active) setPending(body);
    else void send(body);
  }
  return <>
    <ManagerDialog title={row ? 'Chỉnh sửa loại hỗ trợ' : 'Thêm loại hỗ trợ'} busy={busy || !!pending} onClose={close}>
      <form className="manager-form" onSubmit={submit}>
        <Input id="support-type-name" name="name" label="Tên loại hỗ trợ" required maxLength={100} defaultValue={row?.name}/>
        <label className="field">Mô tả<textarea name="description" rows={3} maxLength={5000} defaultValue={row?.description ?? ''}/></label>
        <label><input type="checkbox" name="active" defaultChecked={row?.active ?? true}/> Đang hoạt động</label>
        {row && <p className="muted">{row.tickets} phiếu tham chiếu · {row.waiting} yêu cầu Mới. Mã loại và lịch sử được giữ nguyên.</p>}
        {error && <p role="alert" className="error-box">{error}</p>}
        <div className="actions manager-dialog-actions"><Button type="button" className="secondary" disabled={busy} onClick={close}>Hủy</Button>
          <Button disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu loại hỗ trợ'}</Button></div>
      </form>
    </ManagerDialog>
    {pending && <ManagerDialog title="Xác nhận ngừng hoạt động" busy={busy} onClose={() => setPending(undefined)}>
      <p>Ngừng hoạt động <strong>{row?.name}</strong>? Loại này sẽ không được chọn cho yêu cầu và ánh xạ mới. Ánh xạ hiện có, {row?.waiting} yêu cầu Mới và lịch sử phiếu được giữ nguyên.</p>
      <div className="actions"><Button className="secondary" disabled={busy} onClick={() => setPending(undefined)}>Hủy</Button>
        <Button disabled={busy} onClick={() => void send(pending)}>Xác nhận ngừng hoạt động</Button></div>
    </ManagerDialog>}
  </>;
}

export function SupportTypes() {
  const [draft, setDraft] = useState({ search: '', active: '' });
  const [filters, setFilters] = useState(draft);
  const [data, setData] = useState<Page<SupportType>>();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<SupportType | 'new'>();
  const [action, setAction] = useState<{row:SupportType;kind:'toggle'|'delete'}>();
  const [busy, setBusy] = useState(false);
  const gate = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    const query = new URLSearchParams({ search: filters.search, page: String(page), page_size: '5' });
    if (filters.active) query.set('active', filters.active);
    managerApi<Page<SupportType>>(`/support-types?${query}`).then(result => {
      if (!alive) return;
      if (page > lastPage(result)) { setPage(lastPage(result)); return; }
      setData(result); setLoading(false);
    }).catch(e => { if (alive) { setError(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [filters, page, revision]);
  async function confirm() {
    if (!action || gate.current) return;
    gate.current = true; setBusy(true); setError('');
    const {row, kind} = action;
    try {
      await managerApi(`/support-types/${row.id}`, { method: kind === 'delete' ? 'DELETE' : 'PATCH',
        body: JSON.stringify({ ...(kind === 'toggle' ? {...typeSnapshot(row), active: !row.active} : {}), expected: typeSnapshot(row) }) });
      setNotice(kind === 'delete' ? 'Đã xóa loại chưa sử dụng.' : 'Đã cập nhật trạng thái loại hỗ trợ.');
      setAction(undefined); setRevision(v => v + 1);
    } catch (e) { setError((e as Error).message); }
    finally { gate.current = false; setBusy(false); }
  }
  return <>
    <div className="page-heading"><div><h2>Loại hỗ trợ</h2><p>Danh mục dùng cho yêu cầu mới; ngừng hoạt động vẫn bảo toàn lịch sử.</p></div>
      <Button onClick={() => setEditing('new')}>Thêm loại hỗ trợ</Button></div>
    <form className="panel manager-types-filter" onSubmit={e => { e.preventDefault(); setPage(1); setFilters({...draft}); }}>
      <Input id="support-type-search" label="Mã hoặc tên loại" value={draft.search} maxLength={200} onChange={e => setDraft({...draft,search:e.target.value})}/>
      <label className="field">Trạng thái<select value={draft.active} onChange={e => setDraft({...draft,active:e.target.value})}>
        <option value="">Tất cả</option><option value="true">Hoạt động</option><option value="false">Ngừng hoạt động</option></select></label>
      <Button disabled={loading}>Lọc loại hỗ trợ</Button>
    </form>
    {error && !action && <p className="error-box" role="alert">{error}</p>}
    {notice && <p className="success-box" role="status">{notice}</p>}
    {data && <section className="panel manager-list-panel" aria-label="Danh sách loại hỗ trợ">
      <div className="table-scroll manager-types-table"><table className="ticket-table"><thead><tr>
        {['Mã loại','Tên loại hỗ trợ','Mô tả','Trạng thái','Nhóm phụ trách','Thao tác'].map(label => <th key={label}>{label}</th>)}
      </tr></thead><tbody>{data.items.map(row => <tr key={row.id}>
        <td data-label="Mã loại">{row.id}</td><td data-label="Tên loại hỗ trợ"><strong>{row.name}</strong></td>
        <td data-label="Mô tả"><span className="manager-type-description" title={row.description ?? ''}>{row.description || '—'}</span></td>
        <td data-label="Trạng thái"><ManagerStatus active={row.active} inactiveLabel="Ngừng hoạt động"/></td>
        <td data-label="Nhóm phụ trách" title={row.groups.map(g => `${g.name}${g.is_default ? ' (mặc định)' : ''}`).join(', ')}>{row.groups.length} nhóm
          {!row.groups.some(g => g.is_default) && <small>Chưa có nhóm mặc định</small>}</td>
        <td data-label="Thao tác"><div className="manager-routing-actions">
          <Button className="secondary manager-icon-button" title="Chỉnh sửa" aria-label={`Chỉnh sửa ${row.name}`} onClick={() => setEditing(row)}><Pencil size={17}/></Button>
          <Button className="secondary manager-icon-button" title={row.active ? 'Ngừng hoạt động' : 'Kích hoạt lại'} aria-label={`${row.active ? 'Ngừng' : 'Kích hoạt'} ${row.name}`} onClick={() => {setError('');setAction({row,kind:'toggle'});}}><Power size={17}/></Button>
          <Button className="secondary manager-icon-button" title="Xóa loại chưa sử dụng" aria-label={`Xóa ${row.name}`} onClick={() => {setError('');setAction({row,kind:'delete'});}}><Trash2 size={17}/></Button>
        </div></td></tr>)}</tbody></table>{!data.total && <p>Không tìm thấy loại hỗ trợ.</p>}</div>
      <ManagerPagination data={data} label="loại hỗ trợ" busy={loading} move={setPage}/>
    </section>}
    {loading && <p role="status">Đang tải danh mục…</p>}
    {editing && <TypeForm row={editing === 'new' ? undefined : editing} close={() => setEditing(undefined)} saved={() => {
      setEditing(undefined);setNotice('Đã lưu loại hỗ trợ.');setRevision(v => v+1);
    }}/>}
    {action && <ManagerDialog title={action.kind === 'delete' ? 'Xác nhận xóa loại hỗ trợ' : action.row.active ? 'Xác nhận ngừng hoạt động' : 'Xác nhận kích hoạt lại'} busy={busy} onClose={() => setAction(undefined)}>
      <p><strong>{action.row.name}</strong></p>
      <p>{action.row.tickets} phiếu tham chiếu · {action.row.waiting} yêu cầu Mới · {action.row.groups.length} nhóm phụ trách.</p>
      <p>{action.kind === 'delete' ? 'Chỉ xóa khi không có bất kỳ tham chiếu nào. Nếu đã sử dụng, hãy chọn Ngừng hoạt động.' : 'Không sửa ánh xạ hoặc phiếu hiện hữu. Loại ngừng hoạt động không được chọn cho yêu cầu mới.'}</p>
      {error && <p role="alert" className="error-box">{error}</p>}
      <div className="actions"><Button className="secondary" disabled={busy} onClick={() => setAction(undefined)}>Hủy</Button>
        <Button disabled={busy} onClick={() => void confirm()}>{busy ? 'Đang xử lý…' : 'Xác nhận'}</Button></div>
    </ManagerDialog>}
  </>;
}
