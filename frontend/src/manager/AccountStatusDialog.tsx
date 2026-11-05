import { useRef, useState } from 'react';
import { ApiError } from '../api';
import { Button } from '../components';
import { ManagerDialog, ManagerStatus } from './Dialog';
import { managerApi, type Account } from './api';

export function AccountStatusDialog({ account, close, refresh, saved }: {
  account: Account;
  close: () => void;
  refresh: () => void;
  saved: (message: string) => void;
}) {
  const [current, setCurrent] = useState(account);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const submitting = useRef(false);
  const locking = account.status === 'HOAT_DONG';
  const action = locking ? 'khóa' : 'mở khóa';
  const alreadyChanged = current.status !== account.status;

  async function confirm() {
    if (submitting.current || stale || alreadyChanged) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await managerApi<Account>(`/users/${current.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: current.name,
          phone: current.phone,
          status: locking ? 'KHOA' : 'HOAT_DONG',
          expected_updated_at: current.updated_at,
        }),
      });
      saved(`Đã ${action} tài khoản ${current.name}.`);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) {
        try {
          setCurrent(await managerApi<Account>(`/users/${current.id}`));
          refresh();
        } catch {
          setStale(true);
        }
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <ManagerDialog title={`Xác nhận ${action} tài khoản`} onClose={close} busy={busy}>
    <p>{locking
      ? `Bạn có chắc chắn muốn khóa tài khoản ${current.name} không? Người dùng sẽ không thể đăng nhập hoặc tiếp tục sử dụng hệ thống bằng phiên đã có sau khi trạng thái khóa có hiệu lực.`
      : 'Tài khoản sẽ được phép đăng nhập lại bằng thông tin đăng nhập hợp lệ.'}</p>
    <dl className="manager-account-summary">
      <dt>Tên tài khoản</dt><dd>{current.name}</dd>
      <dt>Email</dt><dd>{current.email}</dd>
      <dt>Vai trò</dt><dd>{current.role_label}</dd>
      <dt>Trạng thái hiện tại</dt><dd><ManagerStatus active={current.status === 'HOAT_DONG'}/></dd>
    </dl>
    {error && <p role="alert" className="error-box">{error}</p>}
    {alreadyChanged && <p>Trạng thái đã thay đổi. Hãy đóng hộp thoại để xem danh sách mới nhất.</p>}
    {stale && <p>Chưa tải được thông tin mới. Hãy đóng hộp thoại và thử lại từ danh sách.</p>}
    <div className="actions manager-dialog-actions">
      <Button className="secondary" disabled={busy} onClick={close}>Hủy</Button>
      <Button disabled={busy || stale || alreadyChanged} onClick={() => void confirm()}>
        {busy ? 'Đang xử lý…' : `Xác nhận ${action}`}
      </Button>
    </div>
  </ManagerDialog>;
}
