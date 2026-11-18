import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { managerApi, type DashboardOverview } from './api';
import { ticketMetrics, type NamedCount } from './metrics';
import './styles.css';

function Trend({ title, periods }: { title: string; periods: NamedCount[] }) {
  const max = Math.max(1, ...periods.map(period => period.count));
  return <section className="panel manager-chart">
    <h2>{title}</h2>
    <p>Theo ngày tạo phiếu · giờ Việt Nam</p>
    {periods.length ? <ul className="manager-trend">
      {periods.map(({ name, count }) => <li key={name}>
        <span>{name}</span>
        <span className="manager-bar-track" aria-hidden="true"><i style={{ width: `${count / max * 100}%` }}/></span>
        <strong>{count}</strong>
      </li>)}
    </ul> : <p>Chưa có dữ liệu.</p>}
  </section>;
}

import { UnifiedChart } from './UnifiedChart';
import type { StaffPage } from '../staff/api';
import type { Analytics } from './reportTypes';
import './furnidesk.css';

const format = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const stats = [...ticketMetrics, ['users', 'Tài khoản', 'teal']] as const;

export function ManagerOverview() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardOverview>();
  const [error, setError] = useState('');
  const [recent, setRecent] = useState<StaffPage>();
  const [recentError, setRecentError] = useState('');
  const [analytics, setAnalytics] = useState<Analytics>();
  const [analyticsError, setAnalyticsError] = useState('');

  useEffect(() => {
    let active = true;
    managerApi<DashboardOverview>('/overview').then(result => {
      if (active) setData(result);
    }).catch(e => { if (active) setError(e.message); });
    managerApi<StaffPage>('/tickets?page=1&page_size=5').then(result => {
      if (active) setRecent(result);
    }).catch(e => { if (active) setRecentError(e.message); });
    managerApi<Analytics>('/reports/analytics?preset=30d').then(result => {
      if (active) setAnalytics(result);
    }).catch(e => { if (active) setAnalyticsError(e.message); });
    return () => { active = false; };
  }, []);

  const metrics = analytics?.metrics;
  const slaSamples = metrics ? metrics.resolution_on_time + metrics.resolution_late : 0;

  return <div className="furni-dashboard">
    <div className="page-heading"><div>
      <span className="eyebrow">GIÁM SÁT · ĐIỀU PHỐI · CẢI THIỆN</span>
      <h1>Tổng quan Helpdesk</h1>
      <p>Xin chào {user?.name}. Số liệu từ hệ thống hỗ trợ khách hàng nội thất.</p>
    </div><Link to="/manager/reports" className="button secondary">Hoạt động và báo cáo</Link></div>
    {error && <p className="error-box" role="alert">{error}</p>}
    {!error && !data && <p role="status">Đang tải tổng quan…</p>}
    {data && <>
      <div className="manager-stats">
        {stats.map(([key, label, color]) => <Link key={key}
          to={key === 'users' ? '/manager/users' : '/manager/tickets'}
          className={`panel manager-stat manager-tone-${color}`}>
          <span>{label}</span><strong>{data[key]}</strong>
        </Link>)}
      </div>
      <UnifiedChart data={data}/>
      <div className="manager-charts">
        <Trend title="Phiếu mới theo tuần" periods={data.by_week ?? []}/>
        <Trend title="Phiếu mới theo tháng" periods={data.by_month ?? []}/>
      </div>
    </>}
    <section className="panel">
      <h2>Chất lượng hỗ trợ · 30 ngày gần nhất</h2>
      {analyticsError ? <p role="alert">{analyticsError}</p> : !metrics ? <p role="status">Đang tải chỉ số…</p> :
        <dl className="detail-meta">
          <div><dt>Giải quyết đúng SLA</dt><dd>{slaSamples
            ? `${format.format(metrics.resolution_on_time * 100 / slaSamples)}% (${metrics.resolution_on_time}/${slaSamples} phiếu)`
            : 'Chưa có dữ liệu'}</dd></div>
          <div><dt>Phản hồi đầu trung bình</dt><dd>{metrics.response_avg === null ? 'Chưa có dữ liệu'
            : `${format.format(metrics.response_avg)} phút · ${metrics.response_samples} phiếu`}</dd></div>
          <div><dt>Điểm đánh giá trung bình</dt><dd>{metrics.rating_avg === null ? 'Chưa có dữ liệu'
            : `${format.format(metrics.rating_avg)}/5 · ${metrics.ratings} lượt`}</dd></div>
        </dl>}
    </section>
    <section className="furni-table-card">
      <div className="furni-table-header"><h2>Phiếu cập nhật gần đây</h2></div>
      {recentError ? <p role="alert">{recentError}</p> : !recent ? <p role="status">Đang tải phiếu…</p> :
        recent.items.length ? <div className="furni-table-container"><table className="furni-table">
          <thead><tr><th>Mã phiếu</th><th>Nội dung yêu cầu</th><th>Nhân viên phụ trách</th><th>Tình trạng SLA</th></tr></thead>
          <tbody>{recent.items.map(ticket => <tr key={ticket.id}>
            <td><Link to={`/manager/tickets/${ticket.id}`} className="text-link">#HT-{ticket.id}</Link></td>
            <td>{ticket.title}</td><td>{ticket.assigned_to || 'Chưa phân công'}</td><td>{ticket.sla_state}</td>
          </tr>)}</tbody>
        </table></div> : <p>Chưa có phiếu hỗ trợ.</p>}
      <div className="furni-table-footer"><Link to="/manager/tickets" className="text-link">Giám sát phiếu</Link></div>
    </section>
    <section className="panel"><h2>Thông tin tài khoản</h2><p>{user?.email}</p>
      <p>Quản lý · Chưa có cảnh báo SLA chạy nền. Số liệu cập nhật khi tải màn hình.</p>
    </section>
  </div>;
}
