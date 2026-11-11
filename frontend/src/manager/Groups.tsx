import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { Button, Input } from '../components';
import { ManagerDialog, ManagerStatus } from './Dialog';
import { ManagerPagination, lastPage } from './Pagination';
import { GroupDialog } from './GroupDialog';
import { managerApi, type Membership, type Page } from './api';
import type { TicketCounts } from './metrics';

export type Group = { id: string; name: string; description: string | null; active: boolean; members: number; pending: number };
export type GroupDetail = Group & {
  people: { id: string; name: string; status: string; workload: number; memberships?: Membership[] }[];
  types: { id: string; name: string }[];
  stats: TicketCounts;
};

export async function allGroups() {
  const result: Group[] = [];
  for (let page = 1; ; page++) {
    const data = await managerApi<Page<Group>>(`/groups?page=${page}&page_size=100`);
    result.push(...data.items);
    if (result.length >= data.total || !data.items.length) return result;
  }
}

function CreateGroup({ close, created }: { close: () => void; created: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get('name')).trim();
    if (!name) {
      setError('Vui lòng nhập tên nhóm.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await managerApi('/groups', {
        method: 'POST',
        body: JSON.stringify({ name, description: fields.get('description') || null, active: true }),
      });
      created();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <ManagerDialog title="Tạo nhóm hỗ trợ" onClose={close} busy={busy}>
    <form className="manager-form" onSubmit={submit}>
      <Input id="group-create-name" name="name" label="Tên nhóm" maxLength={100} required/>
      <label className="field">Mô tả nhóm<textarea name="description" rows={3} maxLength={5000}/></label>
      {error && <p role="alert" className="error-box">{error}</p>}
      <div className="actions manager-dialog-actions">
        <Button type="button" className="secondary" onClick={close} disabled={busy}>Hủy</Button>
        <Button disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo nhóm'}</Button>
      </div>
    </form>
  </ManagerDialog>;
}

export function ManagerGroups() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [data, setData] = useState<Page<Group>>();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selected = id ?? editing;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    managerApi<Page<Group>>(`/groups?page=${page}`).then(result => {
      if (!active) return;
      if (result.page > lastPage(result)) {
        setPage(lastPage(result));
        return;
      }
      setData(result);
      setLoading(false);
    }).catch(e => {
      if (active) {
        setError(e.message);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [page, revision]);

  function closeGroup() {
    if (id) navigate('/manager/groups', { replace: true });
    else setEditing(undefined);
  }

  return <>
    <div className="page-heading">
      <div><h1>Nhóm hỗ trợ</h1><p>Quản lý nhóm chuyên môn, thành viên và khối lượng phiếu.</p></div>
      <Button onClick={() => setCreating(true)}>Tạo nhóm hỗ trợ</Button>
    </div>
    {error && <p role="alert" className="error-box">{error}</p>}
    {notice && <p role="status" className="success-box">{notice}</p>}
    {data ? <section className="panel manager-list-panel" aria-label="Danh sách nhóm hỗ trợ">
      <div className="table-scroll manager-groups-table">
        <table className="ticket-table">
          <thead><tr>{['Nhóm', 'Thành viên', 'Phiếu đang giao', 'Trạng thái', 'Thao tác'].map(label => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{data.items.map(group => <tr key={group.id}>
            <td data-label="Nhóm"><strong>{group.name}</strong><small>{group.description}</small></td>
            <td data-label="Thành viên">{group.members}</td>
            <td data-label="Phiếu đang giao">{group.pending}</td>
            <td data-label="Trạng thái"><ManagerStatus active={group.active} inactiveLabel="Đã vô hiệu hóa"/></td>
            <td data-label="Thao tác"><Button type="button" className="secondary manager-icon-button"
              aria-label={`Chỉnh sửa nhóm ${group.name}`} title="Chỉnh sửa nhóm" onClick={() => setEditing(group.id)}>
              <Pencil size={17} aria-hidden="true"/>
            </Button></td>
          </tr>)}</tbody>
        </table>
        {!data.total && <p>Chưa có nhóm.</p>}
      </div>
      <ManagerPagination data={data} label="nhóm" busy={loading} move={next => {
        setLoading(true);
        if (next === page) setRevision(value => value + 1);
        else setPage(next);
      }}/>
    </section> : !error && <p role="status">Đang tải nhóm…</p>}
    {creating && <CreateGroup close={() => setCreating(false)} created={() => {
      setCreating(false);
      setNotice('Đã tạo nhóm hỗ trợ.');
      setRevision(value => value + 1);
    }}/>}
    {selected && <GroupDialog key={selected} id={selected} close={closeGroup}
      changed={() => setRevision(value => value + 1)}/>}
  </>;
}

export const ManagerGroup = ManagerGroups;
