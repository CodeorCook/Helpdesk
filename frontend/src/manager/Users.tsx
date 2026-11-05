import { useEffect,useState,type FormEvent } from 'react';
import { Link,useParams } from 'react-router-dom';
import { Lock, LockOpen } from 'lucide-react';
import { useAuth } from '../auth';
import { AccountStatusDialog } from './AccountStatusDialog';
import { ManagerPagination, lastPage } from './Pagination';
import { Button,Input } from '../components';
import { formatDate } from '../customer/api';
import { EmployeeDialog } from './EmployeeDialog';
import { ManagerStatus } from './Dialog';
import { managerApi,roles,type Account,type Page } from './api';

export function ManagerUsers() {
  const { user } = useAuth();
  const [data, setData] = useState<Page<Account>>();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState<Account>();
  const [busy, setBusy] = useState(true);

  function refresh() {
    setBusy(true);
    setRevision(value => value + 1);
  }

  function move(nextPage: number) {
    if (nextPage === page) {
      refresh();
      return;
    }
    setBusy(true);
    setPage(nextPage);
  }

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    new FormData(event.currentTarget).forEach((value, key) => {
      if (String(value).trim()) params.set(key, String(value).trim());
    });
    setPage(1);
    setQuery(params.toString());
    refresh();
  }

  useEffect(() => {
    let active = true;
    setError('');
    managerApi<Page<Account>>(`/users?page=${page}&page_size=5&${query}`).then(result => {
      if (!active) return;
      if (result.page > lastPage(result)) {
        setPage(lastPage(result));
        return;
      }
      setData(result);
      setBusy(false);
    }).catch(e => {
      if (active) {
        setError(e.message);
        setBusy(false);
      }
    });
    return () => { active = false; };
  }, [page, query, revision]);

  return <>
    <div className="page-heading"><div>
      <h1>Tài khoản và phân quyền</h1>
      <p>Tìm kiếm tài khoản, quản lý trạng thái và quyền truy cập.</p>
    </div><Button onClick={() => setCreating(true)}>Tạo nhân viên hỗ trợ</Button></div>
    <form className="panel manager-users-filter" onSubmit={filter}>
      <Input id="manager-user-search" name="search" label="Tên, email hoặc ID" maxLength={150}/>
      <label className="field">Vai trò
        <select name="role"><option value="">Tất cả</option>
          {Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="field">Trạng thái tài khoản
        <select name="status"><option value="">Tất cả</option>
          <option value="HOAT_DONG">Hoạt động</option><option value="KHOA">Đã khóa</option>
        </select>
      </label>
      <Button>Lọc tài khoản</Button>
    </form>
    {error && <p className="error-box" role="alert">{error}</p>}
    {notice && <p className="success-box" role="status">{notice}</p>}
    {!data && !error && <p role="status">Đang tải tài khoản…</p>}
    {data && <section className="panel manager-list-panel" aria-label="Danh sách tài khoản" aria-busy={busy}>
      <div className="table-scroll manager-users-table">
        <table className="ticket-table">
          <thead><tr>{['Tài khoản', 'Vai trò', 'Trạng thái', 'Thao tác'].map(label => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{data.items.map(account => {
            const active = account.status === 'HOAT_DONG';
            const self = user?.id === account.id && active;
            const Icon = active ? Lock : LockOpen;
            const label = active ? 'Khóa tài khoản' : 'Mở khóa tài khoản';
            return <tr key={account.id}>
              <td data-label="Tài khoản"><Link className="text-link" to={`/manager/users/${account.id}`}>{account.name} · #{account.id}</Link><small>{account.email}</small></td>
              <td data-label="Vai trò">{account.role_label}</td>
              <td data-label="Trạng thái"><ManagerStatus active={active}/></td>
              <td data-label="Thao tác"><Button type="button" className="secondary manager-icon-button manager-account-action"
                aria-label={`${label} ${account.name}`} title={self ? 'Không thể tự khóa tài khoản đang đăng nhập' : label}
                disabled={busy || self} onClick={() => setTarget(account)}><Icon size={17} aria-hidden="true"/></Button></td>
            </tr>;
          })}</tbody>
        </table>
        {!data.total && <p className="empty-state">Không có tài khoản phù hợp.</p>}
      </div>
      <ManagerPagination data={data} label="tài khoản" move={move} busy={busy}/>
    </section>}
    {target && <AccountStatusDialog account={target} close={() => setTarget(undefined)} refresh={refresh} saved={message => {
      setTarget(undefined);
      setNotice(message);
      refresh();
    }}/>}
    {creating && <EmployeeDialog onClose={() => setCreating(false)} onCreated={account => {
      setCreating(false);
      setNotice(`Đã tạo Nhân viên hỗ trợ #${account.id}. Hãy bàn giao mật khẩu qua kênh riêng đã được tổ chức chấp thuận.`);
      refresh();
    }}/>}
  </>;
}

export function ManagerUser(){const {id}=useParams();const [data,setData]=useState<Account>();const [error,setError]=useState('');const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);async function load(){try{setData(await managerApi<Account>(`/users/${id}`))}catch(e){setError((e as Error).message)}}useEffect(()=>{void load()},[id]);async function save(e:FormEvent<HTMLFormElement>,role=false){e.preventDefault();if(!data)return;const form=e.currentTarget;const fd=new FormData(form);if(!window.confirm(role?'Xác nhận thay đổi vai trò?':'Xác nhận lưu thông tin và trạng thái tài khoản?'))return;setBusy(true);setError('');try{const body=role?{role:fd.get('role'),current_password:fd.get('current_password'),confirmed:fd.get('confirmed')==='on',expected_updated_at:data.updated_at}:{name:fd.get('name'),phone:fd.get('phone')||null,status:fd.get('status'),expected_updated_at:data.updated_at};setData(await managerApi<Account>(`/users/${id}${role?'/role':''}`,{method:role?'POST':'PATCH',body:JSON.stringify(body)}));if(role)form.reset();setNotice('Đã cập nhật tài khoản.')}catch(e){setError((e as Error).message);await load()}finally{setBusy(false)}}return <><Link to="/manager/users" className="text-link">← Tài khoản</Link><h1>Chi tiết tài khoản</h1>{error&&<p role="alert" className="error-box">{error}</p>}{notice&&<p role="status" className="success-box">{notice}</p>}{data&&<><section className="panel"><h2>{data.name} · #{data.id}</h2><p>{data.email} · {data.role_label}</p><small>Tạo: {formatDate(data.created_at)}. Email/mật khẩu không chỉnh sửa qua màn hình này.</small></section><form key={data.updated_at} className="panel customer-form" onSubmit={e=>void save(e)}><Input id="account-name" name="name" label="Họ tên" defaultValue={data.name} maxLength={100} required/><Input id="account-phone" name="phone" label="Số điện thoại" defaultValue={data.phone||''} maxLength={20}/><label className="field">Trạng thái tài khoản<select name="status" defaultValue={data.status}><option value="HOAT_DONG">Hoạt động</option><option value="KHOA">Đã khóa</option></select></label><p>Không tự khóa tài khoản đang đăng nhập. Nhân viên còn phiếu chưa kết thúc phải được điều phối trước khi khóa.</p><Button disabled={busy}>Lưu tài khoản</Button></form><form className="panel customer-form" onSubmit={e=>void save(e,true)}><h2>Phân quyền có xác nhận</h2><p>Chỉ thay vai trò khi tài khoản chưa có nghiệp vụ hoặc thành viên nhóm. Không tự thay quyền; giữ ít nhất một Quản lý hoạt động.</p><label className="field">Vai trò mới<select name="role" defaultValue="" required><option value="" disabled>Chọn vai trò</option>{Object.entries(roles).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><Input id="role-confirm-password" name="current_password" label="Mật khẩu Quản lý đang đăng nhập" type="password" autoComplete="current-password" required maxLength={1024}/><label><input name="confirmed" type="checkbox" required/> Tôi xác nhận thay đổi quyền truy cập của tài khoản này.</label><Button disabled={busy}>Xác nhận phân quyền</Button></form></>}</>}
