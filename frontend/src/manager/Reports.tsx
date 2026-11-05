import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { Button, Input } from '../components';
import type { Catalog } from '../customer/api';
import { managerApi, type Page } from './api';
import { allGroups, type Group } from './Groups';
import { lastPage, ManagerPagination } from './Pagination';
import { ReportTrend } from './ReportTrend';
import type { Activity, Analytics, Grain, Metrics } from './reportTypes';
import './reports.css';

const vietnamDateTime = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh',
});
const number = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const dateLabel = (date: string) => date.split('-').reverse().join('/');
const duration = (minutes: number | null) => minutes === null ? 'Chưa có dữ liệu' : `${number.format(minutes)} phút`;
const percentage = (count: number, total: number) => total ? `${number.format(count * 100 / total)}%` : 'Chưa có dữ liệu';
const score = (value: number | null) => value === null ? 'Chưa có dữ liệu' : `${number.format(value)}/5`;
const presets = [
  ['today', 'Hôm nay'], ['7d', '7 ngày gần nhất'], ['30d', '30 ngày gần nhất'],
  ['month', 'Tháng này'], ['custom', 'Khoảng tùy chọn'],
];

function ReportKpis({ metrics: m }: { metrics: Metrics }) {
  const slaSamples = m.resolution_on_time + m.resolution_late;
  const items = [
    ['Yêu cầu mới', m.created, 'Theo ngày tạo phiếu'],
    ['Đã giải quyết', m.resolved, 'Theo lần giải quyết hợp lệ đầu tiên'],
    ['Phản hồi đầu trung bình', duration(m.response_avg), `${m.response_samples} phiếu có phản hồi công khai của nhân viên`],
    ['Giải quyết trung bình', duration(m.resolution_avg), `${m.resolved} phiếu có mốc giải quyết`],
    ['Giải quyết đúng SLA', percentage(m.resolution_on_time, slaSamples), `${m.resolution_on_time}/${slaSamples} phiếu giải quyết có hạn hợp lệ`],
    ['Điểm đánh giá trung bình', score(m.rating_avg), `${m.ratings} lượt đánh giá`],
  ];
  return <div className="report-kpis">{items.map(([label, value, note]) => <article className="panel report-kpi" key={label}>
    <h3>{label}</h3><strong>{value}</strong><small>{note}</small>
  </article>)}</div>;
}

function ReportBars({ label, rows }: { label: string; rows: (readonly [string, number])[] }) {
  const maximum = Math.max(1, ...rows.map(([, count]) => count));
  return <ul className="report-ratings" aria-label={label}>
    {rows.map(([name, count]) => <li key={name}><span>{name}</span><svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
      <rect className="report-rating-track" width="100" height="8" rx="2"/>
      <rect className="report-chart-created" width={count * 100 / maximum} height="8" rx="2"/>
    </svg><strong>{count}</strong></li>)}
  </ul>;
}

function ServiceLevels({ metrics: m }: { metrics: Metrics }) {
  const rows = [
    ['Đúng hạn', m.response_on_time, m.resolution_on_time],
    ['Vượt hạn', m.response_late, m.resolution_late],
    ['Thiếu hạn SLA', m.response_missing, m.resolution_missing],
    ['Đang chờ · đã quá hạn', m.response_open_late, m.resolution_open_late],
    ['Đang chờ · chưa quá hạn', m.response_open_on_time, m.resolution_open_on_time],
  ] as const;
  const responseSamples = m.response_on_time + m.response_late;
  const resolutionSamples = m.resolution_on_time + m.resolution_late;
  return <section className="panel report-print-block">
    <h2>Tốc độ xử lý và SLA</h2>
    <p>Phản hồi đúng hạn: <strong>{responseSamples ? percentage(m.response_on_time, responseSamples) : 'Chưa đủ dữ liệu SLA'}</strong> ({m.response_on_time}/{responseSamples}).
      {' '}Giải quyết đúng hạn: <strong>{resolutionSamples ? percentage(m.resolution_on_time, resolutionSamples) : 'Chưa đủ dữ liệu SLA'}</strong> ({m.resolution_on_time}/{resolutionSamples}).</p>
    <table className="report-sla-table">
      <thead><tr><th scope="col">Kết quả</th><th scope="col">Phản hồi</th><th scope="col">Giải quyết</th></tr></thead>
      <tbody>{rows.map(([label, response, resolution]) => <tr key={label}><th scope="row">{label}</th><td>{response}</td><td>{resolution}</td></tr>)}</tbody>
    </table>
    {resolutionSamples > 0 && <>
      <h3>Tỷ lệ thời lượng SLA đã dùng</h3>
      <ReportBars label="Phân bố thời lượng giải quyết" rows={[
        ['Đến 25%', m.resolution_quarter], ['Trên 25–50%', m.resolution_half],
        ['Trên 50–100%', m.resolution_full], ['Vượt 100%', m.resolution_late],
      ]}/>
    </>}
    <p className="muted">Ba dòng đầu theo ngày hoàn thành từng mốc. Hai dòng đang chờ là ảnh chụp tại thời điểm tổng hợp, chỉ gồm phiếu tạo trong kỳ còn mở và có hạn hợp lệ.</p>
  </section>;
}

function Satisfaction({ report }: { report: Analytics }) {
  const { metrics: m, rating_distribution } = report;
  return <section className="panel report-print-block">
    <h2>Mức độ hài lòng của khách hàng</h2>
    <p>Theo ngày gửi đánh giá trong kỳ.</p>
    {m.closed_in_period > 0 && <p>Phiếu đóng trong kỳ đã có đánh giá tại thời điểm tổng hợp: <strong>{percentage(m.closed_with_rating, m.closed_in_period)}</strong> ({m.closed_with_rating}/{m.closed_in_period}).</p>}
    {!m.ratings ? <p>Chưa có dữ liệu đánh giá.</p> : <>
      <p><strong>{score(m.rating_avg)}</strong> · {m.ratings} lượt đánh giá · {percentage(m.positive, m.ratings)} từ 4–5 sao</p>
      <ReportBars label="Phân bố đánh giá" rows={[5, 4, 3, 2, 1].map(stars =>
        [`${stars} sao`, rating_distribution.find(row => row.stars === stars)?.count ?? 0] as const)}/>
    </>}
  </section>;
}

function GroupsReport({ groups }: { groups: Analytics['groups'] }) {
  return <section className="panel report-group-report">
    <h2>Hiệu quả theo nhóm</h2>
    <p>Gom theo nhóm đang ghi trên phiếu hoặc nhóm mặc định hiện tại khi phiếu chưa chốt nhóm. Số liệu không quy thành tích lịch sử cho người phụ trách hiện tại.</p>
    {!groups.length ? <p>Chưa có hoạt động phù hợp.</p> : <div className="table-scroll report-group-scroll">
      <table className="ticket-table">
        <thead><tr>{['Nhóm', 'Tạo', 'Giải quyết', 'Phản hồi TB', 'Giải quyết TB', 'Giải quyết đúng SLA'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{groups.map(group => {
          const completed = group.resolution_on_time + group.resolution_late;
          return <tr key={group.group_id}>
            <td data-label="Nhóm">{group.group_name}</td><td data-label="Tạo">{group.created}</td>
            <td data-label="Giải quyết">{group.resolved}</td>
            <td data-label="Phản hồi TB">{duration(group.response_avg)}<small>{group.response_samples} mẫu</small></td>
            <td data-label="Giải quyết TB">{duration(group.resolution_avg)}<small>{group.resolved} mẫu</small></td>
            <td data-label="Giải quyết đúng SLA">{percentage(group.resolution_on_time, completed)}<small>{group.resolution_on_time}/{completed} phiếu</small></td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
  </section>;
}

function ActivityTable({ report }: { report: Analytics }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Activity>>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError('');
    const params = new URLSearchParams({ preset: 'custom', start: report.start, end: report.end, page: String(page) });
    if (report.group_id) params.set('group', report.group_id);
    if (report.type_id) params.set('type', report.type_id);
    managerApi<Page<Activity>>(`/reports/activity?${params}`).then(result => {
      if (!active) return;
      if (result.page > lastPage(result)) setPage(lastPage(result));
      else setData(result);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [page, report]);
  return <section className="panel report-screen-only manager-list-panel" aria-label="Lịch sử hoạt động hỗ trợ">
    <h2>Lịch sử hoạt động hỗ trợ</h2>
    <p>Theo thời điểm sự kiện. Bảng chỉ hiển thị tóm tắt hoạt động.</p>
    {error && <p role="alert" className="error-box">{error}</p>}
    {!data && !error && <p role="status">Đang tải hoạt động…</p>}
    {data && <>
      {data.items.length ? <div className="table-scroll"><table className="ticket-table">
        <thead><tr>{['Thời gian', 'Mã phiếu', 'Người thực hiện', 'Loại hoạt động', 'Tóm tắt'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{data.items.map(event => <tr key={event.id}>
          <td data-label="Thời gian">{vietnamDateTime.format(new Date(event.happened_at))}</td>
          <td data-label="Mã phiếu"><Link className="text-link" to={`/manager/tickets/${event.ticket_id}`}>#HT-{event.ticket_id}</Link></td>
          <td data-label="Người thực hiện">{event.actor}</td><td data-label="Loại hoạt động">{event.kind}</td>
          <td data-label="Tóm tắt">{event.detail}</td>
        </tr>)}</tbody>
      </table></div> : <p>Chưa có hoạt động phù hợp.</p>}
      <ManagerPagination data={data} label="hoạt động" move={setPage}/>
    </>}
  </section>;
}

export function ManagerReports() {
  const [preset, setPreset] = useState('30d');
  const [selection, setSelection] = useState({ query: 'preset=30d' });
  const [groups, setGroups] = useState<Group[]>([]);
  const [types, setTypes] = useState<Catalog[]>([]);
  const [report, setReport] = useState<Analytics>();
  const [grain, setGrain] = useState<Grain>('day');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [printed, setPrinted] = useState<Date>();

  useEffect(() => {
    let active = true;
    Promise.all([allGroups(), managerApi<Catalog[]>('/catalog/types')]).then(([groupList, typeList]) => {
      if (active) { setGroups(groupList); setTypes(typeList); }
    }).catch(e => { if (active) setCatalogError(e.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    managerApi<Analytics>(`/reports/analytics?${selection.query}`).then(result => {
      if (!active) return;
      setReport(result);
      setBusy(false);
    }).catch(e => {
      if (active) { setError(e.message); setBusy(false); }
    });
    return () => { active = false; };
  }, [selection]);

  function apply(query: string) {
    setBusy(true);
    setError('');
    setReport(undefined);
    setPrinted(undefined);
    setSelection({ query });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    new FormData(event.currentTarget).forEach((value, key) => {
      if (value) params.set(key, String(value));
    });
    apply(params.toString());
  }

  useEffect(() => {
    if (!printed) return;
    window.print();
  }, [printed]);

  const m = report?.metrics;
  const groupName = report?.group_id ? groups.find(group => group.id === report.group_id)?.name ?? `Nhóm #${report.group_id}` : 'Tất cả';
  const typeName = report?.type_id ? types.find(type => type.id === report.type_id)?.name ?? `Loại #${report.type_id}` : 'Tất cả';

  return <div className="manager-report">
    <div className="page-heading report-screen-only">
      <div><h1>Hoạt động và báo cáo</h1><p>Theo dõi hiệu suất hỗ trợ, SLA và đánh giá theo kỳ.</p></div>
      <Button disabled={busy || !report || !!error} onClick={() => setPrinted(new Date())}><Printer size={17} aria-hidden="true"/> Xuất báo cáo</Button>
    </div>
    <form className="panel report-filters report-screen-only" onSubmit={submit} onReset={() => { setPreset('30d'); apply('preset=30d'); }}>
      <label className="field">Khoảng thời gian
        <select name="preset" value={preset} onChange={e => setPreset(e.target.value)}>
          {presets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="field">Nhóm hỗ trợ
        <select name="group"><option value="">Tất cả nhóm</option>{groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select>
      </label>
      <label className="field">Loại yêu cầu
        <select name="type"><option value="">Tất cả loại</option>{types.map(type => <option value={type.id} key={type.id}>{type.name}</option>)}</select>
      </label>
      {preset === 'custom' && <>
        <Input id="report-start" label="Từ ngày" name="start" type="date" required/>
        <Input id="report-end" label="Đến ngày" name="end" type="date" required/>
      </>}
      <div className="report-filter-actions"><Button type="reset" className="secondary">Đặt lại</Button><Button type="submit">Áp dụng</Button></div>
    </form>
    {catalogError && <p className="error-box report-screen-only" role="alert">{catalogError}</p>}
    {error && <p className="error-box report-screen-only" role="alert">{error}</p>}
    {busy && <p role="status" className="report-screen-only">Đang tổng hợp báo cáo…</p>}
    {report && m && <>
      <header className="report-metadata">
        <div className="report-print-only"><p>Hệ thống quản lý hỗ trợ khách hàng</p><h1>Báo cáo hoạt động hỗ trợ khách hàng</h1></div>
        <p><strong>Kỳ đã áp dụng</strong> · {dateLabel(report.start)} – {dateLabel(report.end)} (giờ Việt Nam)</p>
        <p>Nhóm: {groupName} · Loại yêu cầu: {typeName}</p>
        <p>Chụp số liệu lúc {vietnamDateTime.format(new Date(report.snapshot_at))}</p>
        {printed && <p className="report-print-only">Xuất lúc {vietnamDateTime.format(printed)} (giờ Việt Nam)</p>}
      </header>
      <ReportKpis metrics={m}/>
      <section className="panel report-print-block">
        <div className="manager-section-heading"><h2>Xu hướng yêu cầu</h2>
          <label className="field report-screen-only">Độ chi tiết
            <select value={grain} onChange={event => setGrain(event.target.value as Grain)}>
              <option value="day">Ngày</option><option value="week">Tuần</option><option value="month">Tháng</option>
            </select>
          </label>
        </div>
        <ReportTrend report={report} grain={grain}/>
      </section>
      <div className="report-columns"><ServiceLevels metrics={m}/><Satisfaction report={report}/></div>
      <GroupsReport groups={report.groups}/>
      <section className="panel report-print-block">
        <h2>Điểm cần chú ý và phương pháp tính</h2>
        <p>{m.response_open_late} phiếu tạo trong kỳ đang chờ phản hồi đã quá hạn. {m.resolution_open_late} phiếu tạo trong kỳ đang chờ giải quyết đã quá hạn.</p>
        <p>{m.intake_missing_sla} phiếu tạo trong kỳ thiếu ít nhất một hạn SLA hợp lệ. {m.missing_resolution_time} phiếu đã giải quyết hoặc đóng trong tập phiếu tạo trong kỳ thiếu mốc giải quyết.</p>
        <p>Thời lượng tính từ lúc tạo đến phản hồi công khai đầu tiên của nhân viên hoặc đến lần giải quyết hợp lệ đầu tiên. Phiếu đóng sau khi giải quyết chỉ được tính một lần. Phản hồi và giải quyết lấy theo ngày đạt từng mốc, có thể thuộc phiếu tạo trước kỳ.</p>
        <p>SLA dùng thời gian liên tục 24/7 và hạn đã lưu. Mẫu số chỉ gồm phiếu hoàn thành mốc có hạn hợp lệ. Các số liệu nhóm dựa trên nhóm tại thời điểm tổng hợp. Hoạt động chi tiết được tải riêng và không nằm trong bản in.</p>
      </section>
      <ActivityTable key={report.snapshot_at} report={report}/>
    </>}
  </div>;
}
