import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { staffApi } from './api';

type Data = { assigned: number; queue: number; recommended: number; team: number; unrouted: number; groups: number; overdue: number };
type StatKey = 'assigned' | 'queue' | 'overdue';
const stats: { key: StatKey; label: string; path: string; note: string }[] = [
  { key: 'assigned', label: 'Phiếu được giao', path: 'mine', note: 'Phiếu của tôi' },
  { key: 'queue', label: 'Chờ tiếp nhận', path: 'queue', note: 'Danh sách chờ' },
  { key: 'overdue', label: 'SLA quá hạn', path: 'mine', note: 'Cần theo dõi' },
];

export function StaffOverview() {
  const [data, setData] = useState<Data>();
  const [error, setError] = useState('');
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError('');
    try { setData(await staffApi<Data>('/overview')); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);

  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">LẮNG NGHE · HỖ TRỢ · GIẢI QUYẾT</span><h1>Tổng quan hỗ trợ</h1><p>Xin chào {user?.name}. Theo dõi yêu cầu và chủ động tiếp nhận phiếu phù hợp.</p></div>
      </div>
      {busy && <p role="status">Đang tải thống kê…</p>}
      {error && <p role="alert" className="error-box">{error}</p>}
      <section className="panel staff-account-panel">
        <h2>Thông tin tài khoản</h2>
        <div className="staff-account-details">
          <div><span>Email</span><strong>{user?.email}</strong></div>
          <div><span>Vai trò</span><strong>{user?.role_label}</strong></div>
        </div>
      </section>
      {data && (
        <>
          <div className="stats-grid staff-stats-grid" aria-label="Thống kê hỗ trợ">
            {stats.map(({ key, label, path, note }) => (
              <Link className={`panel staff-stat staff-stat-${key}`} key={key} to={`/staff/${path}`}>
                <p>{label}</p><h2>{data[key]}</h2><small>{key === 'queue' ? `Trong đó ${data.recommended} phiếu ưu tiên cho bạn` : note}</small>
              </Link>
            ))}
          </div>
          {(!data.groups || data.unrouted > 0) && (
            <p className="notice" role="status">
              {!data.groups ? 'Bạn chưa thuộc nhóm hỗ trợ hoạt động. ' : ''}
              Có {data.unrouted} yêu cầu chờ điều phối do thiếu nhóm hoạt động hoặc nhân viên đủ điều kiện. Quản lý cần cấu hình nhóm, thành viên và ánh xạ loại hỗ trợ; hệ thống không tự giao phiếu.
            </p>
          )}
          <section className="panel">
            <h2>Tiếp nhận có xác nhận</h2>
            <p>“Ưu tiên cho bạn” được đánh dấu trong danh sách chờ theo khối lượng phiếu chưa giải quyết, không phản ánh trạng thái online. Nhân viên đủ điều kiện trong nhóm đều có thể tiếp nhận.</p>
            <p>SLA được theo dõi khi đã có chính sách và hạn trên phiếu; cảnh báo chỉ cập nhật khi tải màn hình.</p>
          </section>
        </>
      )}
    </>
  );
}
