import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  Filter,
  Info,
  Printer,
  RotateCcw,
  Search,
  User,
  X,
} from 'lucide-react';
import { Button, Input } from '../components';
import type { Catalog } from '../customer/api';
import { managerApi, type Page } from './api';
import { allGroups, type Group } from './Groups';
import { lastPage, ManagerPagination } from './Pagination';
import { ReportTrend } from './ReportTrend';
import type { Activity, Analytics, Grain, Metrics } from './reportTypes';
import './reports.css';

const number = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const dateLabel = (date: string) => date.split('-').reverse().join('/');
const duration = (minutes: number | null) =>
  minutes === null ? 'Chưa có dữ liệu' : `${number.format(minutes)} phút`;
const percentage = (count: number, total: number) =>
  total ? `${number.format((count * 100) / total)}%` : 'Chưa có dữ liệu';
const score = (value: number | null) =>
  value === null ? 'Chưa có dữ liệu' : `${number.format(value)}/5`;
const presets = [
  ['today', 'Hôm nay'],
  ['7d', '7 ngày gần nhất'],
  ['30d', '30 ngày gần nhất'],
  ['month', 'Tháng này'],
  ['custom', 'Khoảng tùy chọn'],
];

const formatDateTime = (dateStr: string) => {
  const d = new Date(dateStr);
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${day}/${month}/${year} • ${hours}:${minutes}`;
};

function exportToCSV(report: Analytics, groupName: string, typeName: string) {
  const m = report.metrics;
  const slaSamples = m.resolution_on_time + m.resolution_late;
  const escapeCell = (val: string | number | null | undefined) => {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  const rows: (string | number)[][] = [
    ['BÁO CÁO HOẠT ĐỘNG VÀ HIỆU SUẤT HỖ TRỢ KHÁCH HÀNG - FURNIDESK'],
    ['Kỳ báo cáo', `${dateLabel(report.start)} đến ${dateLabel(report.end)} (giờ Việt Nam)`],
    ['Nhóm hỗ trợ', groupName],
    ['Loại yêu cầu', typeName],
    ['Thời điểm xuất báo cáo', new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })],
    [],
    ['1. CÁC CHỈ SỐ KPI VẬN HÀNH CỐT LÕI'],
    ['Chỉ số', 'Giá trị', 'Đơn vị / Ghi chú'],
    ['Yêu cầu mới tiếp nhận', m.created, 'Phiếu (theo ngày tạo)'],
    ['Đã giải quyết', m.resolved, 'Phiếu (lần giải quyết hợp lệ đầu tiên)'],
    ['Phản hồi đầu trung bình', m.response_avg !== null ? m.response_avg : 'N/A', 'Phút'],
    ['Giải quyết trung bình', m.resolution_avg !== null ? m.resolution_avg : 'N/A', 'Phút'],
    [
      'Tỷ lệ đạt SLA giải quyết',
      slaSamples ? `${((m.resolution_on_time * 100) / slaSamples).toFixed(1)}%` : 'N/A',
      `${m.resolution_on_time}/${slaSamples} phiếu có hạn hợp lệ`,
    ],
    ['Điểm đánh giá CSAT trung bình', m.rating_avg !== null ? `${m.rating_avg.toFixed(1)}/5` : 'N/A', `${m.ratings} lượt đánh giá`],
    ['Tỷ lệ hài lòng (4-5 sao)', m.ratings ? `${((m.positive * 100) / m.ratings).toFixed(1)}%` : 'N/A', `${m.positive}/${m.ratings} lượt`],
    [],
    ['2. TỐC ĐỘ XỬ LÝ VÀ CHỈ SỐ CAM KẾT SLA'],
    ['Hạng mục kiểm soát', 'Mốc phản hồi', 'Mốc giải quyết'],
    ['Đúng hạn cam kết SLA', m.response_on_time, m.resolution_on_time],
    ['Vượt hạn (Trễ hạn SLA)', m.response_late, m.resolution_late],
    ['Đang chờ xử lý - Đã quá hạn', m.response_open_late, m.resolution_open_late],
    ['Đang chờ xử lý - Còn trong hạn', m.response_open_on_time, m.resolution_open_on_time],
    ['Thiếu hạn SLA hợp lệ', m.response_missing, m.resolution_missing],
    [],
    ['3. HIỆU QUẢ THEO NHÓM CHUYÊN MÔN NỘI THẤT'],
    ['Tên nhóm', 'Phiếu tạo', 'Đã giải quyết', 'Phản hồi TB (phút)', 'Giải quyết TB (phút)', 'Đạt SLA (%)'],
    ...report.groups.map(g => {
      const comp = g.resolution_on_time + g.resolution_late;
      const slaRate = comp ? `${((g.resolution_on_time * 100) / comp).toFixed(1)}%` : 'N/A';
      return [
        g.group_name,
        g.created,
        g.resolved,
        g.response_avg !== null ? g.response_avg : 'N/A',
        g.resolution_avg !== null ? g.resolution_avg : 'N/A',
        slaRate,
      ];
    }),
    [],
    ['4. PHÂN BỐ ĐÁNH GIÁ MỨC ĐỘ HÀI LÒNG KHÁCH HÀNG (CSAT)'],
    ['Mức độ', 'Số lượt đánh giá'],
    ...[5, 4, 3, 2, 1].map(stars => [
      `${stars} sao`,
      report.rating_distribution.find(r => r.stars === stars)?.count ?? 0,
    ]),
  ];

  // \uFEFF is UTF-8 Byte Order Mark (BOM) ensuring Windows Excel opens Vietnamese text without mojibake
  const csvContent = '\uFEFF' + rows.map(row => row.map(escapeCell).join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.setAttribute('download', `FurniDesk-BaoCao-${report.start}-${report.end}.csv`);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

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
  return (
    <div className="report-kpis">
      {items.map(([label, value, note]) => (
        <article className="panel report-kpi" key={label}>
          <h3>{label}</h3>
          <strong>{value}</strong>
          <small>{note}</small>
        </article>
      ))}
    </div>
  );
}

function ReportBars({ label, rows }: { label: string; rows: (readonly [string, number])[] }) {
  const maximum = Math.max(1, ...rows.map(([, count]) => count));
  return (
    <ul className="report-ratings" aria-label={label}>
      {rows.map(([name, count]) => (
        <li key={name}>
          <span>{name}</span>
          <svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
            <rect className="report-rating-track" width="100" height="8" rx="2" />
            <rect className="report-chart-created" width={(count * 100) / maximum} height="8" rx="2" />
          </svg>
          <strong>{count}</strong>
        </li>
      ))}
    </ul>
  );
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
  return (
    <section className="panel report-print-block">
      <h2>Tốc độ xử lý và SLA</h2>
      <p>
        Phản hồi đúng hạn:{' '}
        <strong>{responseSamples ? percentage(m.response_on_time, responseSamples) : 'Chưa đủ dữ liệu SLA'}</strong>{' '}
        ({m.response_on_time}/{responseSamples}). Giải quyết đúng hạn:{' '}
        <strong>{resolutionSamples ? percentage(m.resolution_on_time, resolutionSamples) : 'Chưa đủ dữ liệu SLA'}</strong>{' '}
        ({m.resolution_on_time}/{resolutionSamples}).
      </p>
      <table className="report-sla-table">
        <thead>
          <tr>
            <th scope="col">Kết quả</th>
            <th scope="col">Phản hồi</th>
            <th scope="col">Giải quyết</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, response, resolution]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{response}</td>
              <td>{resolution}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {resolutionSamples > 0 && (
        <>
          <h3>Tỷ lệ thời lượng SLA đã dùng</h3>
          <ReportBars
            label="Phân bố thời lượng giải quyết"
            rows={[
              ['Đến 25%', m.resolution_quarter],
              ['Trên 25–50%', m.resolution_half],
              ['Trên 50–100%', m.resolution_full],
              ['Vượt 100%', m.resolution_late],
            ]}
          />
        </>
      )}
      <p className="muted">
        Ba dòng đầu theo ngày hoàn thành từng mốc. Hai dòng đang chờ là ảnh chụp tại thời điểm tổng hợp, chỉ gồm phiếu tạo
        trong kỳ còn mở và có hạn hợp lệ.
      </p>
    </section>
  );
}

function Satisfaction({ report }: { report: Analytics }) {
  const { metrics: m, rating_distribution } = report;
  return (
    <section className="panel report-print-block">
      <h2>Mức độ hài lòng của khách hàng</h2>
      <p>Theo ngày gửi đánh giá trong kỳ.</p>
      {m.closed_in_period > 0 && (
        <p>
          Phiếu đóng trong kỳ đã có đánh giá tại thời điểm tổng hợp:{' '}
          <strong>{percentage(m.closed_with_rating, m.closed_in_period)}</strong> ({m.closed_with_rating}/
          {m.closed_in_period}).
        </p>
      )}
      {!m.ratings ? (
        <p>Chưa có dữ liệu đánh giá.</p>
      ) : (
        <>
          <p>
            <strong>{score(m.rating_avg)}</strong> · {m.ratings} lượt đánh giá · {percentage(m.positive, m.ratings)} từ 4–5
            sao
          </p>
          <ReportBars
            label="Phân bố đánh giá"
            rows={[5, 4, 3, 2, 1].map(
              stars => [`${stars} sao`, rating_distribution.find(row => row.stars === stars)?.count ?? 0] as const
            )}
          />
        </>
      )}
    </section>
  );
}

function GroupsReport({ groups }: { groups: Analytics['groups'] }) {
  return (
    <section className="panel report-group-report">
      <h2>Hiệu quả theo nhóm</h2>
      <p>
        Gom theo nhóm đang ghi trên phiếu hoặc nhóm mặc định hiện tại khi phiếu chưa chốt nhóm. Số liệu không quy thành tích
        lịch sử cho người phụ trách hiện tại.
      </p>
      {!groups.length ? (
        <p>Chưa có hoạt động phù hợp.</p>
      ) : (
        <div className="table-scroll report-group-scroll">
          <table className="ticket-table">
            <thead>
              <tr>
                {['Nhóm', 'Tạo', 'Giải quyết', 'Phản hồi TB', 'Giải quyết TB', 'Giải quyết đúng SLA'].map(label => (
                  <th scope="col" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(group => {
                const completed = group.resolution_on_time + group.resolution_late;
                return (
                  <tr key={group.group_id}>
                    <td data-label="Nhóm">{group.group_name}</td>
                    <td data-label="Tạo">{group.created}</td>
                    <td data-label="Giải quyết">{group.resolved}</td>
                    <td data-label="Phản hồi TB">
                      {duration(group.response_avg)}
                      <small>{group.response_samples} mẫu</small>
                    </td>
                    <td data-label="Giải quyết TB">
                      {duration(group.resolution_avg)}
                      <small>{group.resolved} mẫu</small>
                    </td>
                    <td data-label="Giải quyết đúng SLA">
                      {percentage(group.resolution_on_time, completed)}
                      <small>
                        {group.resolution_on_time}/{completed} phiếu
                      </small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function getActionBadge(kind: string) {
  const k = kind.toLowerCase();
  if (k.includes('trạng thái')) return { label: 'Trạng thái', className: 'action-status' };
  if (k.includes('phân công') || k.includes('điều phối')) return { label: 'Điều phối', className: 'action-dispatch' };
  if (k.includes('phản hồi')) return { label: 'Phản hồi CSKH', className: 'action-public' };
  if (k.includes('nội bộ')) return { label: 'Ghi chú kỹ thuật', className: 'action-internal' };
  if (k.includes('tệp') || k.includes('đính kèm')) return { label: 'Tệp đính kèm', className: 'action-attachment' };
  if (k.includes('tạo') || k.includes('mới')) return { label: 'Tiếp nhận mới', className: 'action-create' };
  return { label: kind, className: 'action-default' };
}

function formatActivitySummary(kind: string, detail: string) {
  const k = kind.toLowerCase();
  if (k.includes('phân công') || k.includes('điều phối')) {
    return detail.startsWith('Gán') || detail.startsWith('Điều') ? detail : `Gán thợ phụ trách: ${detail}`;
  }
  if (k.includes('tệp') || k.includes('đính kèm')) {
    return detail === 'Có tệp được tải lên' ? 'Tải lên ảnh sản phẩm / biên bản nghiệm thu' : detail;
  }
  if (k.includes('phản hồi')) {
    return detail === 'Có trao đổi mới' ? 'Gửi tin nhắn trao đổi với khách hàng' : detail;
  }
  if (k.includes('trạng thái')) {
    return `Chuyển tiến độ sang: "${detail}"`;
  }
  return detail;
}

function ActivityTable({ report }: { report: Analytics }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Activity>>();
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedActor, setSelectedActor] = useState<string>('all');
  const [selectedKind, setSelectedKind] = useState<string>('all');

  useEffect(() => {
    let active = true;
    setData(undefined);
    setError('');
    const params = new URLSearchParams({ preset: 'custom', start: report.start, end: report.end, page: String(page) });
    if (report.group_id) params.set('group', report.group_id);
    if (report.type_id) params.set('type', report.type_id);
    managerApi<Page<Activity>>(`/reports/activity?${params}`)
      .then(result => {
        if (!active) return;
        if (result.page > lastPage(result)) setPage(lastPage(result));
        else setData(result);
      })
      .catch(e => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [page, report]);

  const items = data?.items ?? [];

  // Extract unique actors from current page dataset
  const uniqueActors = Array.from(new Set(items.map(e => e.actor).filter(Boolean)));

  const kindOptions = [
    { key: 'all', label: 'Tất cả', count: items.length },
    { key: 'status', label: 'Trạng thái', count: items.filter(e => e.kind.toLowerCase().includes('trạng thái')).length },
    {
      key: 'dispatch',
      label: 'Điều phối thợ',
      count: items.filter(e => e.kind.toLowerCase().includes('phân công') || e.kind.toLowerCase().includes('điều phối')).length,
    },
    { key: 'public', label: 'Phản hồi CSKH', count: items.filter(e => e.kind.toLowerCase().includes('phản hồi')).length },
    { key: 'internal', label: 'Ghi chú kỹ thuật', count: items.filter(e => e.kind.toLowerCase().includes('nội bộ')).length },
    {
      key: 'attachment',
      label: 'Tệp đính kèm',
      count: items.filter(e => e.kind.toLowerCase().includes('tệp') || e.kind.toLowerCase().includes('đính kèm')).length,
    },
  ];

  const filteredItems = items.filter(event => {
    // Filter by Actor
    if (selectedActor !== 'all' && event.actor !== selectedActor) return false;

    // Filter by Kind
    if (selectedKind !== 'all') {
      const k = event.kind.toLowerCase();
      if (selectedKind === 'status' && !k.includes('trạng thái')) return false;
      if (selectedKind === 'dispatch' && !k.includes('phân công') && !k.includes('điều phối')) return false;
      if (selectedKind === 'public' && !k.includes('phản hồi')) return false;
      if (selectedKind === 'internal' && !k.includes('nội bộ')) return false;
      if (selectedKind === 'attachment' && !k.includes('tệp') && !k.includes('đính kèm')) return false;
    }

    // Filter by Search term
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      const matchActor = event.actor.toLowerCase().includes(q);
      const matchKind = event.kind.toLowerCase().includes(q);
      const matchDetail = event.detail.toLowerCase().includes(q);
      const matchTicket = `#hd-${event.ticket_id}`.toLowerCase().includes(q) || String(event.ticket_id).includes(q);
      return matchActor || matchKind || matchDetail || matchTicket;
    }

    return true;
  });

  const isFiltered = searchTerm.trim() !== '' || selectedActor !== 'all' || selectedKind !== 'all';

  const resetFilters = () => {
    setSearchTerm('');
    setSelectedActor('all');
    setSelectedKind('all');
  };

  return (
    <section className="panel report-screen-only manager-list-panel" aria-label="Lịch sử hoạt động hỗ trợ">
      <div className="furni-activity-bar">
        <div className="furni-activity-intro">
          <h2>Lịch sử hoạt động hỗ trợ (Audit Trail)</h2>
          <p>
            Theo thời điểm sự kiện ca trực. Bấm nhân viên hoặc bộ lọc để tra cứu nhanh.
          </p>
        </div>

        <div className="furni-activity-controls">
          {/* Dropdown Lọc Nhân Viên Cố Định */}
          <div className={`furni-filter-select-wrap ${selectedActor !== 'all' ? 'has-active' : ''}`}>
            <User size={14} className="furni-filter-icon" />
            <select
              value={selectedActor}
              onChange={e => setSelectedActor(e.target.value)}
              className="furni-filter-select"
              title="Lọc theo nhân viên thực hiện"
            >
              <option value="all">Tất cả nhân viên ({uniqueActors.length})</option>
              {uniqueActors.map(actor => (
                <option key={actor} value={actor}>
                  {actor}
                </option>
              ))}
            </select>
          </div>

          {/* Ô Tìm Kiếm Cố Định */}
          <div className="furni-activity-search">
            <Search size={14} style={{ opacity: 0.6, flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Tìm mã phiếu, thao tác..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="furni-search-clear"
                title="Xóa tìm kiếm"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Nút Đặt Lại Bộ Lọc */}
          {isFiltered && (
            <button
              type="button"
              onClick={resetFilters}
              className="furni-filter-reset-btn"
              title="Đặt lại tất cả bộ lọc"
            >
              <RotateCcw size={13} />
              <span>Đặt lại</span>
            </button>
          )}
        </div>
      </div>

      {/* Dải Quick Filter Pills theo Loại Hoạt Động */}
      <div className="furni-activity-pills">
        <span className="furni-pills-label">
          <Filter size={12} />
          <span>Loại thao tác:</span>
        </span>
        <div className="furni-pills-list">
          {kindOptions.map(opt => {
            const isActive = selectedKind === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                className={`furni-quick-pill ${isActive ? 'active' : ''} pill-${opt.key}`}
                onClick={() => setSelectedKind(opt.key)}
              >
                <span>{opt.label}</span>
                <span className="furni-pill-count">{opt.count}</span>
              </button>
            );
          })}
        </div>
        <div className="furni-activity-status-counter">
          Hiển thị <strong>{filteredItems.length}</strong> / {items.length} sự kiện
        </div>
      </div>

      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Đang tải hoạt động…</p>}
      {data && (
        <>
          {filteredItems.length ? (
            <div className="table-scroll">
              <table className="ticket-table">
                <thead>
                  <tr>
                    {['Thời gian', 'Mã phiếu', 'Người thực hiện', 'Loại hoạt động', 'Tóm tắt'].map(label => (
                      <th scope="col" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map(event => {
                    const actionBadge = getActionBadge(event.kind);
                    const summary = formatActivitySummary(event.kind, event.detail);
                    return (
                      <tr key={event.id}>
                        <td data-label="Thời gian" style={{ whiteSpace: 'nowrap', fontSize: '12.5px' }}>
                          {formatDateTime(event.happened_at)}
                        </td>
                        <td data-label="Mã phiếu">
                          <Link className="text-link" to={`/manager/tickets/${event.ticket_id}`}>
                            #HD-{event.ticket_id}
                          </Link>
                        </td>
                        <td data-label="Người thực hiện">
                          <button
                            type="button"
                            className="furni-staff-chip"
                            onClick={() => setSelectedActor(event.actor)}
                            title={`Lọc tất cả hoạt động của ${event.actor}`}
                          >
                            <span className="furni-staff-avatar">{event.actor.slice(0, 1).toUpperCase()}</span>
                            <span>{event.actor}</span>
                          </button>
                        </td>
                        <td data-label="Loại hoạt động">
                          <span className={`furni-action-badge ${actionBadge.className}`}>{actionBadge.label}</span>
                        </td>
                        <td data-label="Tóm tắt">{summary}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: '36px 0', textAlign: 'center', color: 'var(--muted)' }}>
              <p style={{ margin: '0 0 12px', fontSize: '13.5px' }}>
                Không tìm thấy hoạt động nào khớp với bộ lọc hiện tại.
              </p>
              {isFiltered && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="furni-filter-reset-btn"
                  style={{ display: 'inline-flex', margin: '0 auto' }}
                >
                  <RotateCcw size={13} />
                  <span>Xóa bộ lọc để xem tất cả</span>
                </button>
              )}
            </div>
          )}
          <ManagerPagination data={data} label="hoạt động" move={setPage} />
        </>
      )}
    </section>
  );
}

export function ManagerReports() {
  const [preset, setPreset] = useState('30d');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
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
    Promise.all([allGroups(), managerApi<Catalog[]>('/catalog/types')])
      .then(([groupList, typeList]) => {
        if (active) {
          setGroups(groupList);
          setTypes(typeList);
        }
      })
      .catch(e => {
        if (active) setCatalogError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    managerApi<Analytics>(`/reports/analytics?${selection.query}`)
      .then(result => {
        if (!active) return;
        setReport(result);
        setBusy(false);
      })
      .catch(e => {
        if (active) {
          setError(e.message);
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, [selection]);

  function apply(query: string) {
    setBusy(true);
    setError('');
    setReport(undefined);
    setPrinted(undefined);
    setSelection({ query });
  }

  function handlePresetChange(newPreset: string) {
    setPreset(newPreset);
    if (newPreset !== 'custom') {
      const params = new URLSearchParams({ preset: newPreset });
      if (selectedGroup) params.set('group', selectedGroup);
      if (selectedType) params.set('type', selectedType);
      apply(params.toString());
    }
  }

  function handleGroupChange(newGroup: string) {
    setSelectedGroup(newGroup);
    if (preset !== 'custom') {
      const params = new URLSearchParams({ preset });
      if (newGroup) params.set('group', newGroup);
      if (selectedType) params.set('type', selectedType);
      apply(params.toString());
    }
  }

  function handleTypeChange(newType: string) {
    setSelectedType(newType);
    if (preset !== 'custom') {
      const params = new URLSearchParams({ preset });
      if (selectedGroup) params.set('group', selectedGroup);
      if (newType) params.set('type', newType);
      apply(params.toString());
    }
  }

  function handleReset() {
    setPreset('30d');
    setSelectedGroup('');
    setSelectedType('');
    setStartDate('');
    setEndDate('');
    apply('preset=30d');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (preset === 'custom') {
      params.set('preset', 'custom');
      if (startDate) params.set('start', startDate);
      if (endDate) params.set('end', endDate);
    } else {
      params.set('preset', preset);
    }
    if (selectedGroup) params.set('group', selectedGroup);
    if (selectedType) params.set('type', selectedType);
    apply(params.toString());
  }

  useEffect(() => {
    if (!printed) return;
    window.print();
  }, [printed]);

  const m = report?.metrics;
  const groupName = report?.group_id
    ? groups.find(group => group.id === report.group_id)?.name ?? `Nhóm #${report.group_id}`
    : 'Tất cả nhóm';
  const typeName = report?.type_id
    ? types.find(type => type.id === report.type_id)?.name ?? `Loại #${report.type_id}`
    : 'Tất cả loại';

  return (
    <div className="manager-report">
      <div className="page-heading report-screen-only">
        <div>
          <h1>Hoạt động và báo cáo</h1>
          <p>Theo dõi hiệu suất hỗ trợ, SLA và đánh giá theo kỳ vận hành nội thất.</p>
        </div>
        <div className="report-btn-group">
          <button
            type="button"
            className="furni-export-btn"
            disabled={busy || !report || !!error}
            onClick={() => report && exportToCSV(report, groupName, typeName)}
            title="Xuất file bảng tính Excel (CSV UTF-8)"
          >
            <FileSpreadsheet size={17} aria-hidden="true" />
            Xuất Excel (CSV)
          </button>
          <Button disabled={busy || !report || !!error} onClick={() => setPrinted(new Date())}>
            <Printer size={17} aria-hidden="true" /> Xuất bản in (PDF)
          </Button>
        </div>
      </div>

      <form className="panel report-filters report-screen-only" onSubmit={submit} onReset={handleReset}>
        <label className="field">
          Khoảng thời gian
          <select name="preset" value={preset} onChange={e => handlePresetChange(e.target.value)}>
            {presets.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Nhóm hỗ trợ
          <select name="group" value={selectedGroup} onChange={e => handleGroupChange(e.target.value)}>
            <option value="">Tất cả nhóm</option>
            {groups.map(group => (
              <option value={group.id} key={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Loại yêu cầu
          <select name="type" value={selectedType} onChange={e => handleTypeChange(e.target.value)}>
            <option value="">Tất cả loại</option>
            {types.map(type => (
              <option value={type.id} key={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        {preset === 'custom' && (
          <>
            <Input id="report-start" label="Từ ngày" name="start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
            <Input id="report-end" label="Đến ngày" name="end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required />
          </>
        )}
        <div className="report-filter-actions">
          <Button type="reset" className="secondary">
            Đặt lại
          </Button>
          {preset === 'custom' && <Button type="submit">Áp dụng</Button>}
        </div>
      </form>

      {catalogError && (
        <p className="error-box report-screen-only" role="alert">
          {catalogError}
        </p>
      )}
      {error && (
        <p className="error-box report-screen-only" role="alert">
          {error}
        </p>
      )}

      {busy && (
        <div className="furni-skeleton-container report-screen-only" role="status" aria-label="Đang tổng hợp báo cáo...">
          <div className="furni-skeleton-grid">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="furni-skeleton-card">
                <div className="furni-skeleton-line title" />
                <div className="furni-skeleton-line number" />
                <div className="furni-skeleton-line desc" />
              </div>
            ))}
          </div>
          <div className="furni-skeleton-card" style={{ marginTop: '14px' }}>
            <div className="furni-skeleton-line title" style={{ marginBottom: '14px' }} />
            <div className="furni-skeleton-line chart" />
          </div>
        </div>
      )}

      {report && m && (
        <>
          <header className="furni-report-scope-card report-print-block">
            <div className="report-print-only">
              <p>Hệ thống quản lý hỗ trợ khách hàng FurniDesk</p>
              <h1>Báo cáo hoạt động hỗ trợ khách hàng</h1>
            </div>
            <div className="furni-scope-left">
              <div className="furni-scope-icon">
                <CalendarRange size={20} />
              </div>
              <div className="furni-scope-content">
                <div className="furni-scope-period">
                  <span className="furni-scope-label">Kỳ báo cáo áp dụng:</span>
                  <strong className="furni-scope-dates">
                    {dateLabel(report.start)} – {dateLabel(report.end)}
                  </strong>
                  <span className="furni-scope-tz">Giờ Việt Nam (UTC+7)</span>
                </div>
                <div className="furni-scope-tags">
                  <span className="furni-scope-tag">
                    <span style={{ color: 'var(--muted)' }}>Phân luồng:</span>
                    <strong>{groupName}</strong>
                  </span>
                  <span className="furni-scope-tag">
                    <span style={{ color: 'var(--muted)' }}>Hạng mục:</span>
                    <strong>{typeName}</strong>
                  </span>
                </div>
              </div>
            </div>
            <div className="furni-scope-right">
              <div className="furni-scope-sync">
                <Clock size={13} />
                <span>Đồng bộ lúc: {formatDateTime(report.snapshot_at)}</span>
              </div>
              <span className="furni-scope-status">
                <span className="furni-scope-pulse" /> Dữ liệu trực tiếp từ ca trực
              </span>
              {printed && <p className="report-print-only">Xuất lúc {formatDateTime(printed.toISOString())}</p>}
            </div>
          </header>

          <ReportKpis metrics={m} />

          <section className="panel report-print-block">
            <div className="manager-section-heading">
              <h2>Xu hướng yêu cầu</h2>
              <label className="field report-screen-only">
                Độ chi tiết
                <select value={grain} onChange={event => setGrain(event.target.value as Grain)}>
                  <option value="day">Ngày</option>
                  <option value="week">Tuần</option>
                  <option value="month">Tháng</option>
                </select>
              </label>
            </div>
            <ReportTrend report={report} grain={grain} />
          </section>

          <div className="report-columns">
            <ServiceLevels metrics={m} />
            <Satisfaction report={report} />
          </div>
          <GroupsReport groups={report.groups} />

          <div className="furni-report-callouts report-print-block">
            <div className={`furni-callout ${m.response_open_late > 0 || m.resolution_open_late > 0 ? 'warn' : 'safe'}`}>
              <div className="furni-callout-icon">
                {m.response_open_late > 0 || m.resolution_open_late > 0 ? (
                  <AlertTriangle size={20} />
                ) : (
                  <CheckCircle2 size={20} />
                )}
              </div>
              <div className="furni-callout-body">
                <h3 className="furni-callout-title">
                  {m.response_open_late > 0 || m.resolution_open_late > 0
                    ? 'Điểm nghẽn & Cảnh báo rủi ro SLA'
                    : 'Giám sát Tiến độ & Rủi ro SLA'}
                </h3>
                <p className="furni-callout-text">
                  {m.response_open_late > 0 || m.resolution_open_late > 0
                    ? 'Phát hiện phiếu tồn đọng quá hạn cam kết, cần điều phối thợ xử lý ngay:'
                    : 'Đánh giá rủi ro SLA trong kỳ báo cáo đã chọn:'}
                </p>
                <ul className="furni-callout-list">
                  {m.response_open_late > 0 && (
                    <li className="callout-alert">
                      <strong>{m.response_open_late} phiếu</strong> tạo trong kỳ đang chờ phản hồi đã{' '}
                      <strong>quá hạn cam kết</strong>.
                    </li>
                  )}
                  {m.resolution_open_late > 0 && (
                    <li className="callout-alert">
                      <strong>{m.resolution_open_late} phiếu</strong> tạo trong kỳ đang chờ giải quyết đã{' '}
                      <strong>quá hạn cam kết</strong>.
                    </li>
                  )}
                  {m.response_open_late === 0 && m.resolution_open_late === 0 && (
                    <li className="callout-ok">
                      <strong>100% phiếu đang mở đều trong hạn:</strong> Không có phiếu nào bị quá hạn phản hồi hoặc
                      trễ hạn giải quyết trong kỳ.
                    </li>
                  )}
                  {m.intake_missing_sla > 0 && (
                    <li className="callout-sub">
                      <strong>{m.intake_missing_sla} phiếu</strong> tạo trong kỳ chưa được gắn chính sách SLA tự động.
                    </li>
                  )}
                  {m.missing_resolution_time > 0 && (
                    <li className="callout-sub">
                      <strong>{m.missing_resolution_time} phiếu</strong> đã giải quyết/đóng thiếu mốc ghi nhận hoàn thành.
                    </li>
                  )}
                </ul>
              </div>
            </div>

            <div className="furni-callout info">
              <div className="furni-callout-icon">
                <Info size={20} />
              </div>
              <div className="furni-callout-body">
                <h3 className="furni-callout-title">Phương pháp tính &amp; Quy tắc đo lường</h3>
                <p className="furni-callout-text">Quy chuẩn ghi nhận dữ liệu vận hành CSKH nội thất:</p>
                <ul className="furni-callout-list">
                  <li>
                    <strong>Thời lượng xử lý:</strong> Tính từ lúc tạo đến phản hồi công khai đầu tiên của nhân viên hoặc
                    lần giải quyết hợp lệ đầu tiên. Phiếu đóng sau khi giải quyết chỉ tính một lần.
                  </li>
                  <li>
                    <strong>Tiêu chuẩn SLA 24/7:</strong> Đo lường thời gian liên tục theo hạn cam kết. Mẫu số chỉ tính
                    phiếu hoàn thành mốc có hạn hợp lệ.
                  </li>
                  <li>
                    <strong>Phân bổ chuyên môn:</strong> Thống kê theo nhóm phụ trách tại thời điểm tổng hợp số liệu.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <ActivityTable key={report.snapshot_at} report={report} />
        </>
      )}
    </div>
  );
}
