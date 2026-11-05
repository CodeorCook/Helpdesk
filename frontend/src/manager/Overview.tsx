import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { managerApi, type DashboardOverview } from './api';
import { ticketMetrics, type NamedCount } from './metrics';
import './styles.css';

function Donut({ title, items }: { title: string; items: NamedCount[] }) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  let start = 0;
  const colors = items.map((_, index) => `var(--manager-chart-${index % 8 + 1})`);
  const segments = items.map((item, index) => {
    const end = start + item.count / total * 100;
    const segment = `${colors[index]} ${start}% ${end}%`;
    start = end;
    return segment;
  });

  return <section className="panel manager-chart">
    <h2>{title}</h2>
    {total > 0 ? <div className="manager-donut-layout">
      <div className="manager-donut" aria-hidden="true" style={{ background: `conic-gradient(${segments.join(',')})` }}>
        <span><strong>{total}</strong><small>phiếu</small></span>
      </div>
      <ul className="manager-chart-legend">
        {items.map(({ name, count }, index) => <li key={name}>
          <i aria-hidden="true" style={{ background: colors[index] }}/><span>{name}</span><strong>{count}</strong>
        </li>)}
      </ul>
    </div> : <p>Chưa có dữ liệu.</p>}
  </section>;
}

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

const stats = [...ticketMetrics, ['users', 'Tài khoản', 'teal']] as const;

export function ManagerOverview() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardOverview>();
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    managerApi<DashboardOverview>('/overview').then(result => {
      if (active) setData(result);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);

  return <>
    <div className="page-heading"><div>
      <span className="eyebrow">GIÁM SÁT · ĐIỀU PHỐI · CẢI THIỆN</span>
      <h1>Tổng quan Helpdesk</h1>
      <p>Xin chào {user?.name}. Số liệu từ hệ thống hỗ trợ khách hàng nội thất.</p>
    </div></div>
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
      <div className="manager-charts">
        <Donut title="Theo trạng thái" items={data.by_status}/>
        <Donut title="Theo nhóm" items={data.by_group}/>
        <Donut title="Theo loại yêu cầu" items={data.by_type}/>
        <Donut title="Theo ưu tiên" items={data.by_priority}/>
        <Trend title="Phiếu mới theo tuần" periods={data.by_week ?? []}/>
        <Trend title="Phiếu mới theo tháng" periods={data.by_month ?? []}/>
      </div>
    </>}
    <section className="panel"><h2>Thông tin tài khoản</h2><p>{user?.email}</p>
      <p>Quản lý · Chưa có cảnh báo SLA chạy nền. Số liệu cập nhật khi tải màn hình.</p>
    </section>
  </>;
}
