import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button, Input } from '../components';
import type { Catalog } from '../customer/api';
import { managerApi, type Page } from './api';
import { ManagerDialog } from './Dialog';
import { lastPage, ManagerPagination } from './Pagination';

type PolicyValues = {
  name: string;
  priority_id: number;
  response_minutes: number;
  resolution_minutes: number;
  active: boolean;
};
type Policy = PolicyValues & { id: string; priority: string; referenced: number };
const maximumMinutes = 2147483647;
const numberFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

function duration(minutes: number) {
  const label = `${numberFormat.format(minutes)} phút`;
  if (minutes < 60) return label;
  const unit = minutes >= 1440 ? 'ngày' : 'giờ';
  const divisor = minutes >= 1440 ? 1440 : 60;
  return `${label} (${minutes % divisor ? '≈ ' : ''}${numberFormat.format(minutes / divisor)} ${unit})`;
}

function policyValues(policy: Policy): PolicyValues {
  const { name, priority_id, response_minutes, resolution_minutes, active } = policy;
  return { name, priority_id, response_minutes, resolution_minutes, active };
}

function validMinutes(value: number) {
  return Number.isInteger(value) && value > 0 && value <= maximumMinutes;
}

function SLAPolicyDialog({ policy, priorities, close, saved }: {
  policy?: Policy;
  priorities: Catalog[];
  close: () => void;
  saved: () => void;
}) {
  const locked = Boolean(policy?.referenced);
  const [response, setResponse] = useState(policy ? String(policy.response_minutes) : '');
  const [resolution, setResolution] = useState(policy ? String(policy.resolution_minutes) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const invalidOrder = validMinutes(Number(response)) && validMinutes(Number(resolution)) && Number(resolution) < Number(response);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const fields = new FormData(event.currentTarget);
    const values = {
      name: String(fields.get('name') ?? '').trim(),
      priority_id: Number(fields.get('priority_id') ?? policy?.priority_id),
      response_minutes: Number(response),
      resolution_minutes: Number(resolution),
      active: fields.get('active') === 'on',
    };
    if (!values.name) return setError('Tên chính sách không được để trống.');
    if (!values.priority_id) return setError('Vui lòng chọn mức ưu tiên SLA.');
    if (!validMinutes(values.response_minutes)) return setError('Thời gian phản hồi phải là số phút nguyên dương hợp lệ.');
    if (!validMinutes(values.resolution_minutes)) return setError('Thời gian xử lý phải là số phút nguyên dương hợp lệ.');
    if (invalidOrder) {
      setError('');
      return;
    }

    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await managerApi(`/sla${policy ? '/' + policy.id : ''}`, {
        method: policy ? 'PATCH' : 'POST',
        body: JSON.stringify(policy ? { ...values, expected: policyValues(policy) } : values),
      });
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <ManagerDialog title={policy ? 'Chỉnh sửa chính sách SLA' : 'Tạo chính sách SLA'} onClose={close} busy={busy}>
    <form className="manager-form manager-sla-form" onSubmit={save} noValidate>
      {policy && <p className="muted">{policy.referenced} phiếu tham chiếu. Hạn của phiếu hiện hữu được giữ nguyên.</p>}
      {locked && <p className="notice">Chính sách đã được sử dụng nên chỉ có thể bật hoặc tắt hiệu lực. Để đổi thời lượng, hãy tắt chính sách này rồi tạo phiên bản mới.</p>}
      <Input id="manager-sla-name" name="name" label="Tên chính sách" maxLength={100} required defaultValue={policy?.name}
        readOnly={locked} aria-describedby="manager-sla-name-help"/>
      <small id="manager-sla-name-help">Nên đặt tên theo mức ưu tiên, ví dụ “SLA mức ưu tiên Cao”.</small>
      <label className="field">Mức ưu tiên SLA
        <select name="priority_id" required defaultValue={policy?.priority_id ?? ''} disabled={locked}>
          <option value="">Chọn mức ưu tiên</option>
          {priorities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <div className="manager-sla-durations">
        <div>
          <Input id="manager-sla-response" label="Thời gian phản hồi (phút)" type="number" min={1} max={maximumMinutes}
            step={1} required value={response} onChange={e => setResponse(e.target.value)} readOnly={locked}/>
          {validMinutes(Number(response)) && <small>{duration(Number(response))}</small>}
        </div>
        <div>
          <Input id="manager-sla-resolution" label="Thời gian xử lý (phút)" type="number" min={1} max={maximumMinutes}
            step={1} required value={resolution} onChange={e => setResolution(e.target.value)} readOnly={locked}
            aria-invalid={invalidOrder} aria-describedby={invalidOrder ? 'manager-sla-validation' : undefined}/>
          {validMinutes(Number(resolution)) && <small>{duration(Number(resolution))}</small>}
        </div>
      </div>
      {invalidOrder && <p id="manager-sla-validation" className="field-error" role="alert">Thời gian xử lý phải lớn hơn hoặc bằng thời gian phản hồi.</p>}
      <label><input name="active" type="checkbox" defaultChecked={policy?.active ?? true}/> Chính sách đang có hiệu lực</label>
      <small>Mỗi mức ưu tiên chỉ có một chính sách có hiệu lực tại một thời điểm.</small>
      {error && <p className="error-box" role="alert">{error}</p>}
      <div className="actions manager-dialog-actions">
        <Button type="button" className="secondary" onClick={close} disabled={busy}>Hủy</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Đang lưu…' : policy ? 'Lưu chính sách' : 'Tạo chính sách'}</Button>
      </div>
    </form>
  </ManagerDialog>;
}

const priorityTones: Record<string, string> = { 'Cao': 'high', 'Trung bình': 'medium', 'Thấp': 'low' };

export function ManagerSLA() {
  const [data, setData] = useState<Page<Policy>>();
  const [priorities, setPriorities] = useState<Catalog[]>();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<Policy | 'new'>();

  useEffect(() => {
    let active = true;
    setError('');
    Promise.all([managerApi<Page<Policy>>(`/sla?page=${page}&page_size=5`), managerApi<Catalog[]>('/catalog/priorities')])
      .then(([result, catalog]) => {
        if (!active) return;
        if (result.page > lastPage(result)) {
          setPage(lastPage(result));
          return;
        }
        setData(result);
        setPriorities(catalog);
        setBusy(false);
      }).catch(e => {
        if (active) {
          setError(e.message);
          setBusy(false);
        }
      });
    return () => { active = false; };
  }, [page, revision]);

  function move(next: number) {
    setBusy(true);
    if (next === page) setRevision(value => value + 1);
    else setPage(next);
  }

  return <>
    <div className="page-heading">
      <div>
        <h1>Chính sách SLA</h1>
        <p>Thiết lập hạn phản hồi và xử lý theo mức ưu tiên, tính liên tục 24/7 từ lúc tạo phiếu.</p>
      </div>
      <Button disabled={!priorities?.length} onClick={() => setEditor('new')}>
        <Plus size={17} aria-hidden="true"/> Tạo chính sách SLA
      </Button>
    </div>
    {error && <p className="error-box" role="alert">{error}</p>}
    {notice && <p className="success-box" role="status">{notice}</p>}
    {!data && busy && <p role="status">Đang tải chính sách…</p>}
    {data && <section className="panel manager-list-panel" aria-label="Danh sách chính sách SLA" aria-busy={busy}>
      {data.items.length ? <div className="table-scroll manager-sla-table">
        <table className="ticket-table">
          <thead><tr>{['Tên chính sách', 'Mức ưu tiên', 'Phản hồi', 'Xử lý', 'Hiệu lực', 'Phiếu tham chiếu', 'Thao tác']
            .map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{data.items.map(policy => <tr key={policy.id}>
            <td data-label="Tên chính sách"><strong>{policy.name}</strong></td>
            <td data-label="Mức ưu tiên"><span className={`manager-status manager-sla-priority-${priorityTones[policy.priority] ?? 'low'}`}>{policy.priority}</span></td>
            <td data-label="Phản hồi">{duration(policy.response_minutes)}</td>
            <td data-label="Xử lý">{duration(policy.resolution_minutes)}</td>
            <td data-label="Hiệu lực"><span className={`manager-status manager-status-${policy.active ? 'active' : 'inactive'}`}>{policy.active ? 'Có hiệu lực' : 'Đã tắt'}</span></td>
            <td data-label="Phiếu tham chiếu">{policy.referenced}</td>
            <td data-label="Thao tác">
              <Button type="button" className="secondary manager-icon-button" aria-label={`Chỉnh sửa ${policy.name}`} title="Chỉnh sửa"
                disabled={busy} onClick={() => setEditor(policy)}><Pencil size={17} aria-hidden="true"/></Button>
            </td>
          </tr>)}</tbody>
        </table>
      </div> : <div className="empty-state">
        <h2>Chưa có chính sách SLA</h2>
        <p>Tạo chính sách đầu tiên để xác định hạn phản hồi và xử lý cho phiếu mới.</p>
        <Button disabled={!priorities?.length || busy} onClick={() => setEditor('new')}>Tạo chính sách đầu tiên</Button>
      </div>}
      <ManagerPagination data={data} label="chính sách" move={move} busy={busy}/>
    </section>}
    {editor && priorities && <SLAPolicyDialog policy={editor === 'new' ? undefined : editor} priorities={priorities}
      close={() => setEditor(undefined)} saved={() => {
        setNotice('Đã lưu chính sách. Hạn của phiếu hiện hữu được giữ nguyên.');
        setEditor(undefined);
        setBusy(true);
        if (editor === 'new') setPage(1);
        setRevision(value => value + 1);
      }}/>}
  </>;
}
