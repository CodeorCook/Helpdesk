import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Pencil, Plus, Lock, LockOpen } from 'lucide-react';
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
      active: policy?.active ?? false,
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
    <form className="manager-form manager-sla-form" onSubmit={save} onChange={()=>setError('')} noValidate>
      {policy && <p className="muted">{policy.referenced} phiếu tham chiếu. Hạn của phiếu hiện hữu được giữ nguyên.</p>}
      {locked && <p className="notice">Chính sách đã được sử dụng nên thông tin lịch sử được giữ nguyên. Hãy tạo bản mới rồi kích hoạt thay thế để đổi thời lượng.</p>}
      <Input id="manager-sla-name" name="name" label="Tên chính sách" maxLength={100} required defaultValue={policy?.name}
        readOnly={locked} aria-describedby="manager-sla-name-help"/>
      <small id="manager-sla-name-help">Nên đặt tên theo mức ưu tiên, ví dụ “SLA mức ưu tiên Cao”.</small>
      <label className="field">Mức ưu tiên SLA
        <select name="priority_id" required defaultValue={policy?.priority_id ?? ''} disabled={locked || !!policy?.active}>
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
      <p className="notice">{policy ? "Thay đổi hiệu lực bằng icon ổ khóa trong danh sách, có bước xác nhận riêng." : "Chính sách mới mặc định chưa áp dụng. Sau khi tạo, hãy chủ động kích hoạt để thay thế bản đang dùng."}</p>
      <small>Mỗi mức ưu tiên chỉ có một chính sách có hiệu lực tại một thời điểm.</small>
      {error && <p className="error-box" role="alert">{error}</p>}
      <div className="actions manager-dialog-actions">
        <Button type="button" className="secondary" onClick={close} disabled={busy}>Hủy</Button>
        <Button type="submit" disabled={busy || locked}>{busy ? 'Đang lưu…' : policy ? 'Lưu chính sách' : 'Tạo chính sách'}</Button>
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
  const [statePolicy,setStatePolicy]=useState<Policy>();

  useEffect(() => {
    let active = true;
    setError('');setBusy(true);
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
            <td data-label="Tên chính sách"><strong>{policy.name}</strong><small>SLA #{policy.id}</small></td>
            <td data-label="Mức ưu tiên"><span className={`manager-status manager-sla-priority-${priorityTones[policy.priority] ?? 'low'}`}>{policy.priority}</span></td>
            <td data-label="Phản hồi">{duration(policy.response_minutes)}</td>
            <td data-label="Xử lý">{duration(policy.resolution_minutes)}</td>
            <td data-label="Hiệu lực"><span className={`manager-status ${policy.active ? 'manager-status-active' : 'manager-sla-inactive'}`}>{policy.active ? 'Đang áp dụng' : 'Đã khóa / Chưa áp dụng'}</span></td>
            <td data-label="Phiếu tham chiếu">{policy.referenced}</td>
            <td data-label="Thao tác"><div className="manager-routing-actions">
              <Button type="button" className="secondary manager-icon-button" aria-label={`Chỉnh sửa ${policy.name}`} title="Chỉnh sửa"
                disabled={busy} onClick={() => setEditor(policy)}><Pencil size={17} aria-hidden="true"/></Button>
              <Button type="button" className="secondary manager-icon-button" title={policy.active ? 'Khóa chính sách' : 'Kích hoạt chính sách'}
                aria-label={`${policy.active ? 'Khóa' : 'Kích hoạt'} ${policy.name}`} disabled={busy} onClick={() => setStatePolicy(policy)}>
                {policy.active ? <Lock size={17} aria-hidden="true"/> : <LockOpen size={17} aria-hidden="true"/>}
              </Button></div>
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
    {statePolicy && <SLAStateDialog policyId={statePolicy.id} close={() => setStatePolicy(undefined)} saved={() => {
      setStatePolicy(undefined);setNotice('Đã kích hoạt phiên bản mới. Chính sách và deadline phiếu cũ được giữ nguyên.');setRevision(v=>v+1);
    }}/>}
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


function SLAStateDialog({policyId,close,saved}:{policyId:string;close:()=>void;saved:()=>void}) {
  const [data,setData]=useState<{policy:Policy;current:Policy|null}>();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const gate=useRef(false);
  const [revision,setRevision]=useState(0);
  useEffect(()=>{let alive=true;setData(undefined);setError('');
    managerApi<{policy:Policy;current:Policy|null}>(`/sla/${policyId}/state`).then(value=>{if(alive)setData(value);}).catch(e=>{if(alive)setError(e.message);});
    return()=>{alive=false;};},[policyId,revision]);
  async function activate() {
    if(!data||gate.current||data.policy.active)return;
    gate.current=true;setBusy(true);setError('');
    try {
      await managerApi(`/sla/${policyId}/state`,{method:'POST',body:JSON.stringify({active:true,expected:policyValues(data.policy),expected_active_id:data.current?.id??null})});
      saved();
    }catch(e){setError((e as Error).message);}finally{gate.current=false;setBusy(false);}
  }
  return <ManagerDialog title={data?.policy.active?'Khóa chính sách SLA':'Kích hoạt chính sách SLA'} busy={busy} onClose={close}>
    {!data&&!error&&<p role="status">Đang kiểm tra phiên bản áp dụng…</p>}
    {data&&<><h3>{data.policy.name} · #{data.policy.id}</h3><p>{data.policy.priority} · {data.policy.referenced} phiếu tham chiếu.</p>
      {data.policy.active?<p className="notice">Không khóa đơn lẻ vì mức ưu tiên sẽ thiếu SLA. Hãy tạo chính sách thay thế rồi bấm Kích hoạt ở bản đó; hệ thống khóa bản cũ và kích hoạt bản mới trong một transaction.</p>:
        <p>Bạn muốn áp dụng <strong>{data.policy.name}</strong>{data.current?<> thay cho <strong>{data.current.name} · #{data.current.id}</strong></>:<> cho mức ưu tiên này</>}?</p>}
      <p>Phiếu đã gắn chính sách cũ giữ nguyên mã SLA, hạn phản hồi và hạn xử lý. Không tính lại SLA tạm tính của yêu cầu Mới.</p></>}
    {error&&<p className="error-box" role="alert">{error}</p>}
    <div className="actions manager-dialog-actions"><Button className="secondary" disabled={busy} onClick={close}>Hủy</Button>
      {error&&<Button className="secondary" disabled={busy} onClick={()=>setRevision(v=>v+1)}>Tải lại phiên bản</Button>}
      {data&&!data.policy.active&&<Button disabled={busy||!!error} onClick={()=>void activate()}>{busy?'Đang kích hoạt…':'Xác nhận kích hoạt'}</Button>}
    </div>
  </ManagerDialog>;
}
