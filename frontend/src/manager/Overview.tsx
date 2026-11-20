import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { managerApi, type DashboardOverview } from './api';
import type { StaffPage } from '../staff/api';
import {
  CheckCircle2,
  ArrowRight,
  Download,
  RefreshCw,
  Filter,
  Star,
  Timer,
  Armchair,
  AlertTriangle,
} from 'lucide-react';
import './furnidesk.css';
import type { Analytics } from './reportTypes';
import { AssignmentDialog,type ManagerDetail } from './TicketDetail';
import { ManagerPagination } from './Pagination';
const segmentCodes: Record<string, string> = {
  'Đang xử lý': 'processing',
  'Đã hoàn tất': 'closed',
  'Chờ tiếp nhận': 'waiting',
  'Quá hạn SLA': 'overdue',
  'Khác': 'other',
};
const number = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

export function ManagerOverview() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState<DashboardOverview>();
  const [tickets, setTickets] = useState<StaffPage>();
  const [analytics, setAnalytics] = useState<Analytics>();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [error, setError] = useState('');
  const [notice,setNotice]=useState('');
  const [timeFilter, setTimeFilter] = useState<'today' | '7d' | 'month'>('today');
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [urgentOnly,setUrgentOnly]=useState(false);
  const [assignment,setAssignment]=useState<ManagerDetail>();
  const [openingAssignment,setOpeningAssignment]=useState(false);
  const assignmentGate=useRef(false);
  async function openAssignment(id:string) {
    if(assignmentGate.current)return;assignmentGate.current=true;setOpeningAssignment(true);
    try{setAssignment(await managerApi<ManagerDetail>(`/tickets/${id}`));}catch(e){setError((e as Error).message);}finally{assignmentGate.current=false;setOpeningAssignment(false);}
  }
  const [hoveredStatus, setHoveredStatus] = useState<string | null>(null);
  // Helper phân loại Loại yêu cầu (Category Badge)
  const getCategoryBadge = (typeName?: string | null) => {
    const name = (typeName || 'Chưa phân loại').trim();
    const lower = name.toLowerCase();
    if (lower.includes('bảo hành') || lower.includes('sửa chữa')) {
      return {
        label: name,
        className: 'badge-warranty',
      };
    }
    if (lower.includes('lắp đặt') || lower.includes('giao lắp')) {
      return {
        label: name,
        className: 'badge-installation',
      };
    }
    if (lower.includes('khiếu nại') || lower.includes('đổi trả')) {
      return {
        label: name,
        className: 'badge-complaint',
      };
    }
    return {
      label: name,
      className: 'badge-consulting',
    };
  };

  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    setData(undefined);
    setAnalytics(undefined);
    setTickets(undefined);
    Promise.all([
      managerApi<DashboardOverview>(`/overview?preset=${timeFilter}`),
      managerApi<Analytics>(`/reports/analytics?preset=${timeFilter}`),
    ]).then(([overview, report]) => {
      if (active) { setData(overview); setAnalytics(report); }
    }).catch(e => {
      if (active) setError(e.message);
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => { active = false; };
  }, [timeFilter, revision]);

  useEffect(() => {
    if (!data?.period_start || !data.period_end) return;
    let active = true;
    setLoadingTickets(true);
    setTickets(undefined);
    const query = new URLSearchParams({
      ...(urgentOnly?{urgent_only:'true'}:{from:data.period_start,to:data.period_end}),
      dashboard_segment: selectedStatus ? segmentCodes[selectedStatus] : 'attention',
      sort: 'intervention', page: String(page), page_size: '5',
    });
    managerApi<StaffPage>(`/tickets?${query}`).then(result => {
      if (!active) return;
      const last = Math.max(1, Math.ceil(result.total / result.page_size));
      if (result.page > last) setPage(last);
      else setTickets(result);
    }).catch(e => {
      if (active) setError(e.message);
    }).finally(() => {
      if (active) setLoadingTickets(false);
    });
    return () => { active = false; };
  }, [data, page, selectedStatus,urgentOnly]);

  function selectStatus(label: string | null) { setPage(1);setUrgentOnly(false); setSelectedStatus(label); }
  function selectTime(value: typeof timeFilter) { setPage(1); setTimeFilter(value); }
  function loadOverview() { setRevision(value => value + 1); }
  const counts = Object.fromEntries((data?.segments ?? []).map(item=>[item.code,item.count]));
  const totalTickets = data?.total ?? 0;
  const processingCount = counts.processing ?? 0;
  const closedCount = counts.closed ?? 0;
  const waitingCount = counts.waiting ?? 0;
  const overdueCount = counts.overdue ?? 0;
  const otherCount = counts.other ?? 0;
  const metrics=analytics?.metrics;
  const slaSamples=metrics?metrics.resolution_on_time+metrics.resolution_late:0;
  // Tính tỷ lệ %
  const processingPct = totalTickets > 0 ? (processingCount / totalTickets) * 100 : 0;
  const closedPct = totalTickets > 0 ? (closedCount / totalTickets) * 100 : 0;
  const waitingPct = totalTickets > 0 ? (waitingCount / totalTickets) * 100 : 0;
  const overduePct = totalTickets > 0 ? (overdueCount / totalTickets) * 100 : 0;

  // Tính chu vi SVG circle (r = 38 => C = 2 * pi * 38 ≈ 238.76)
  const CIRCLE_C = 238.76;
  const strokeDashP = (processingPct / 100) * CIRCLE_C;
  const strokeDashC = (closedPct / 100) * CIRCLE_C;
  const strokeDashW = (waitingPct / 100) * CIRCLE_C;
  const strokeDashO = (overduePct / 100) * CIRCLE_C;

  const offsetP = 0;
  const offsetC = -strokeDashP;
  const offsetW = -(strokeDashP + strokeDashC);
  const offsetO = -(strokeDashP + strokeDashC + strokeDashW);

  const workloadTotal=(data?.workload??[]).reduce((sum,item)=>sum+item.count,0);
  const groupItems=(data?.workload??[]).map(group=>({...group,pct:workloadTotal?Math.round(group.count*100/workloadTotal):0}));
  const filteredTickets=tickets?.items??[];
  // Tính toán nhãn và số liệu hiển thị trong tâm Donut khi rê chuột
  let hubNumber = totalTickets;
  let hubLabel = 'TỔNG PHIẾU';
  let hubSub = 'Theo ngày tạo trong kỳ';
  let hubColor = 'var(--ink)';

  if (hoveredStatus === 'processing') {
    hubNumber = processingCount;
    hubLabel = 'ĐANG XỬ LÝ';
    hubSub = `${Math.round(processingPct)}% TỔNG CA`;
    hubColor = '#0284c7';
  } else if (hoveredStatus === 'closed') {
    hubNumber = closedCount;
    hubLabel = 'ĐÃ HOÀN TẤT';
    hubSub = `${Math.round(closedPct)}% TỔNG CA`;
    hubColor = '#10b981';
  } else if (hoveredStatus === 'waiting') {
    hubNumber = waitingCount;
    hubLabel = 'CHỜ TIẾP NHẬN';
    hubSub = `${Math.round(waitingPct)}% TỔNG CA`;
    hubColor = '#f59e0b';
  } else if (hoveredStatus === 'overdue') {
    hubNumber = overdueCount;
    hubLabel = 'QUÁ HẠN SLA';
    hubSub = overdueCount === 0 ? 'Không có phiếu đang quá hạn' : `${overdueCount} CẢNH BÁO`;
    hubColor = overdueCount === 0 ? '#10b981' : '#ef4444';
  }

  return (
    <div className="furni-dashboard">
      {notice&&<p className="success-box" role="status">{notice}</p>}
      {/* 1. Top Action Bar & Page Title */}
      <div className="furni-top-bar">
        <div className="furni-title-group">
          <div className="furni-eyebrow">
            <span className="furni-pulse-tag">
              <span className="furni-pulse-dot" />
              Số liệu theo kỳ
            </span>
            <span className="furni-station-tag">• Helpdesk nội thất</span>
          </div>
          <h1>Tổng quan Helpdesk</h1>
          <p>
            Xin chào <strong style={{ color: '#0284c7' }}>{user?.name || 'Quản lý'}</strong>. Bức tranh điều phối ca trực &amp; chăm sóc khách hàng nội thất cao cấp.
          </p>
        </div>

        <div className="furni-actions">
          <Link to="/manager/reports" className="furni-btn furni-btn-secondary">
            <Download size={15} style={{ color: '#0284c7' }} />
            <span>Xuất báo cáo</span>
          </Link>
        </div>
      </div>

      {error && (
        <div className="furni-offline-banner">
          <div className="furni-offline-banner-left">
            <AlertTriangle size={18} style={{ color: '#fbbf24', flexShrink: 0 }} />
            <span>
              <strong>Chưa tải được dữ liệu:</strong> {error}
            </span>
          </div>
          <button
            type="button"
            className="furni-offline-btn"
            onClick={() => {
              setError('');
              loadOverview();
            }}
          >
            Đồng bộ lại
          </button>
        </div>
      )}

      {busy && <p role="status">Đang tải tổng quan…</p>}
      {!busy && data && analytics && <>
      {/* 2. KHỐI THỐNG NHẤT CHIA ĐÔI (TWO-COLUMN UNIFIED CARD) */}
      {/* Bên Trái: Biểu đồ tròn Donut | Bên Phải: Dòng chảy ca trực + Danh sách trạng thái tương tác */}
      <section className="furni-split-card">
        <div className="furni-card-header">
          <div>
            <span className="furni-card-tag">Trung tâm điều phối ca trực</span>
            <h2 className="furni-card-title">Cơ cấu phiếu trong kỳ</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div className="furni-filter-group" role="group" aria-label="Bộ lọc thời gian">
              <button
                type="button"
                className={`furni-filter-btn ${timeFilter === 'today' ? 'active' : ''}`}
                onClick={() => selectTime('today')}
              >
                Hôm nay
              </button>
              <button
                type="button"
                className={`furni-filter-btn ${timeFilter === '7d' ? 'active' : ''}`}
                onClick={() => selectTime('7d')}
              >
                7 ngày qua
              </button>
              <button
                type="button"
                className={`furni-filter-btn ${timeFilter === 'month' ? 'active' : ''}`}
                onClick={() => selectTime('month')}
              >
                Tháng này
              </button>
            </div>
            <span className="kpi-green-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CheckCircle2 size={13} /> {Math.round(closedPct)}% hoàn tất
            </span>
          </div>
        </div>

        <div className="furni-split-grid">
          {/* CỘT TRÁI: Biểu đồ tròn Donut Hub */}
          <div className="furni-split-left">
            <div className="furni-split-donut-box">
              <svg className="furni-donut-svg" viewBox="0 0 100 100">
                {/* Vòng nền xám mờ */}
                <circle cx="50" cy="50" r="38" fill="none" stroke="var(--border)" strokeWidth="12" opacity="0.3" />

                {/* Cung 1: Đang xử lý (#0284c7 - Xanh dương) */}
                {strokeDashP > 0 && (
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    fill="none"
                    stroke="#0284c7"
                    strokeWidth={hoveredStatus === 'processing' ? 16 : 12}
                    strokeDasharray={`${strokeDashP} ${CIRCLE_C}`}
                    strokeDashoffset={offsetP}
                    strokeLinecap="butt"
                    className={`furni-donut-segment seg-processing ${hoveredStatus === 'processing' ? 'is-highlighted' : ''}`}
                    style={{
                      opacity: hoveredStatus && hoveredStatus !== 'processing' ? 0.35 : 1,
                      transition: 'all 0.35s ease',
                    }}
                    role="button" tabIndex={0} aria-label="Lọc Đang xử lý"
                    onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectStatus(selectedStatus==='Đang xử lý'?null:'Đang xử lý');}}}
                    onMouseEnter={() => setHoveredStatus('processing')}
                    onMouseLeave={() => setHoveredStatus(null)}
                    onClick={() => selectStatus(selectedStatus === 'Đang xử lý' ? null : 'Đang xử lý')}
                  />
                )}

                {/* Cung 2: Đã hoàn tất (#10b981 - Xanh lá) */}
                {strokeDashC > 0 && (
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    fill="none"
                    stroke="#10b981"
                    strokeWidth={hoveredStatus === 'closed' ? 16 : 12}
                    strokeDasharray={`${strokeDashC} ${CIRCLE_C}`}
                    strokeDashoffset={offsetC}
                    strokeLinecap="butt"
                    className={`furni-donut-segment seg-closed ${hoveredStatus === 'closed' ? 'is-highlighted' : ''}`}
                    style={{
                      opacity: hoveredStatus && hoveredStatus !== 'closed' ? 0.35 : 1,
                      transition: 'all 0.35s ease',
                    }}
                    role="button" tabIndex={0} aria-label="Lọc Đã hoàn tất"
                    onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectStatus(selectedStatus==='Đã hoàn tất'?null:'Đã hoàn tất');}}}
                    onMouseEnter={() => setHoveredStatus('closed')}
                    onMouseLeave={() => setHoveredStatus(null)}
                    onClick={() => selectStatus(selectedStatus === 'Đã hoàn tất' ? null : 'Đã hoàn tất')}
                  />
                )}

                {/* Cung 3: Chờ tiếp nhận (#f59e0b - Vàng cam) */}
                {strokeDashW > 0 && (
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth={hoveredStatus === 'waiting' ? 16 : 12}
                    strokeDasharray={`${strokeDashW} ${CIRCLE_C}`}
                    strokeDashoffset={offsetW}
                    strokeLinecap="butt"
                    className={`furni-donut-segment seg-waiting ${hoveredStatus === 'waiting' ? 'is-highlighted' : ''}`}
                    style={{
                      opacity: hoveredStatus && hoveredStatus !== 'waiting' ? 0.35 : 1,
                      transition: 'all 0.35s ease',
                    }}
                    role="button" tabIndex={0} aria-label="Lọc Chờ tiếp nhận"
                    onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectStatus(selectedStatus==='Chờ tiếp nhận'?null:'Chờ tiếp nhận');}}}
                    onMouseEnter={() => setHoveredStatus('waiting')}
                    onMouseLeave={() => setHoveredStatus(null)}
                    onClick={() => selectStatus(selectedStatus === 'Chờ tiếp nhận' ? null : 'Chờ tiếp nhận')}
                  />
                )}

                {/* Cung 4: Quá hạn SLA (#ef4444 - Đỏ) */}
                {strokeDashO > 0 && (
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth={hoveredStatus === 'overdue' ? 16 : 12}
                    strokeDasharray={`${strokeDashO} ${CIRCLE_C}`}
                    strokeDashoffset={offsetO}
                    strokeLinecap="butt"
                    className={`furni-donut-segment seg-overdue ${hoveredStatus === 'overdue' ? 'is-highlighted' : ''}`}
                    style={{
                      opacity: hoveredStatus && hoveredStatus !== 'overdue' ? 0.35 : 1,
                      transition: 'all 0.35s ease',
                    }}
                    role="button" tabIndex={0} aria-label="Lọc Quá hạn SLA"
                    onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectStatus(selectedStatus==='Quá hạn SLA'?null:'Quá hạn SLA');}}}
                    onMouseEnter={() => setHoveredStatus('overdue')}
                    onMouseLeave={() => setHoveredStatus(null)}
                    onClick={() => selectStatus(selectedStatus === 'Quá hạn SLA' ? null : 'Quá hạn SLA')}
                  />
                )}
                {otherCount>0&&<circle cx="50" cy="50" r="38" fill="none" stroke="var(--muted)" strokeWidth="12"
                  strokeDasharray={`${otherCount/totalTickets*CIRCLE_C} ${CIRCLE_C}`}
                  strokeDashoffset={-(strokeDashP+strokeDashC+strokeDashW+strokeDashO)} onClick={()=>selectStatus('Khác')}/>}
              </svg>

              {/* Tâm Donut hiển thị động theo trạng thái rê chuột */}
              <div className="furni-donut-hub-interactive">
                <span className="furni-hub-number" style={{ color: hubColor }}>
                  {hubNumber}
                </span>
                <span className="furni-hub-label">{hubLabel}</span>
                <span
                  className="furni-hub-sync"
                  style={{
                    color: hubColor === 'var(--ink)' ? 'var(--muted)' : hubColor,
                    borderColor: hubColor === 'var(--ink)' ? 'var(--border)' : `color-mix(in srgb, ${hubColor} 30%, transparent)`,
                    background: hubColor === 'var(--ink)' ? 'var(--canvas)' : `color-mix(in srgb, ${hubColor} 12%, transparent)`,
                  }}
                >
                  {hubSub}
                </span>
              </div>
            </div>
          </div>

          {/* CỘT PHẢI: Danh sách 4 trạng thái kiêm bộ lọc */}
          <div className="furni-split-right">
            <div className="furni-status-group" style={{ margin: 0 }}>
              <div className="furni-status-header">
                <span style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.05em', color: 'var(--muted)' }}>
                  Bộ lọc trạng thái
                </span>
                <span style={{ color: 'var(--muted)', fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Filter size={12} style={{ color: '#0284c7' }} />
                  Chọn trạng thái để lọc danh sách
                </span>
              </div>

              {/* Mục 1: Đang xử lý */}
              <button
                type="button"
                className={`furni-status-item ${selectedStatus === 'Đang xử lý' ? 'is-active' : ''} ${hoveredStatus === 'processing' ? 'is-hovered' : ''}`}
                onMouseEnter={() => setHoveredStatus('processing')}
                onMouseLeave={() => setHoveredStatus(null)}
                onClick={() => selectStatus(selectedStatus === 'Đang xử lý' ? null : 'Đang xử lý')}
              >
                <div className="furni-status-meta">
                  <span className="furni-dot" style={{ background: '#0284c7', boxShadow: '0 0 0 3px rgba(2, 132, 199, 0.2)' }} />
                  <div>
                    <div className="furni-status-name">Đang xử lý</div>
                    <div className="furni-status-desc">Đang xử lý hoặc tạm dừng, chưa quá hạn</div>
                  </div>
                </div>
                <div className="furni-status-figures">
                  <span className="furni-count-pill" style={{ color: '#0284c7' }}>
                    {processingCount} phiếu <span className="furni-stat-pct">({Math.round(processingPct)}%)</span>
                  </span>
                  {selectedStatus === 'Đang xử lý' && <Filter size={13} style={{ color: '#0284c7' }} />}
                </div>
              </button>

              {/* Mục 2: Đã hoàn tất */}
              <button
                type="button"
                className={`furni-status-item ${selectedStatus === 'Đã hoàn tất' ? 'is-active' : ''} ${hoveredStatus === 'closed' ? 'is-hovered' : ''}`}
                onMouseEnter={() => setHoveredStatus('closed')}
                onMouseLeave={() => setHoveredStatus(null)}
                onClick={() => selectStatus(selectedStatus === 'Đã hoàn tất' ? null : 'Đã hoàn tất')}
              >
                <div className="furni-status-meta">
                  <span className="furni-dot" style={{ background: '#10b981', boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.2)' }} />
                  <div>
                    <div className="furni-status-name">Đã hoàn tất</div>
                    <div className="furni-status-desc">Đã giải quyết hoặc đã được khách xác nhận đóng</div>
                  </div>
                </div>
                <div className="furni-status-figures">
                  <span className="furni-count-pill" style={{ color: '#10b981' }}>
                    {closedCount} phiếu <span className="furni-stat-pct">({Math.round(closedPct)}%)</span>
                  </span>
                  {selectedStatus === 'Đã hoàn tất' && <Filter size={13} style={{ color: '#10b981' }} />}
                </div>
              </button>

              {/* Mục 3: Chờ tiếp nhận */}
              <button
                type="button"
                className={`furni-status-item ${selectedStatus === 'Chờ tiếp nhận' ? 'is-active' : ''} ${hoveredStatus === 'waiting' ? 'is-hovered' : ''} ${waitingCount === 0 ? 'is-empty' : ''}`}
                onMouseEnter={() => setHoveredStatus('waiting')}
                onMouseLeave={() => setHoveredStatus(null)}
                onClick={() => selectStatus(selectedStatus === 'Chờ tiếp nhận' ? null : 'Chờ tiếp nhận')}
              >
                <div className="furni-status-meta">
                  <span className="furni-dot" style={{ background: '#f59e0b', boxShadow: '0 0 0 3px rgba(245, 158, 11, 0.2)' }} />
                  <div>
                    <div className="furni-status-name">Chờ tiếp nhận</div>
                    <div className="furni-status-desc">Phiếu mới, chưa quá hạn SLA</div>
                  </div>
                </div>
                <div className="furni-status-figures">
                  <span className="furni-count-pill" style={{ color: 'var(--muted)' }}>
                    {waitingCount} phiếu <span className="furni-stat-pct">({Math.round(waitingPct)}%)</span>
                  </span>
                  {selectedStatus === 'Chờ tiếp nhận' && <Filter size={13} style={{ color: '#f59e0b' }} />}
                </div>
              </button>

              {/* Mục 4: Quá hạn SLA */}
              <button
                type="button"
                className={`furni-status-item ${selectedStatus === 'Quá hạn SLA' ? 'is-active' : ''} ${hoveredStatus === 'overdue' ? 'is-hovered' : ''} ${overdueCount === 0 ? 'is-empty' : ''}`}
                onMouseEnter={() => setHoveredStatus('overdue')}
                onMouseLeave={() => setHoveredStatus(null)}
                onClick={() => selectStatus(selectedStatus === 'Quá hạn SLA' ? null : 'Quá hạn SLA')}
              >
                <div className="furni-status-meta">
                  <span className="furni-dot" style={{ background: '#ef4444', boxShadow: '0 0 0 3px rgba(239, 68, 68, 0.2)' }} />
                  <div>
                    <div className="furni-status-name">Quá hạn SLA</div>
                    <div className="furni-status-desc">Phiếu mới, đang xử lý hoặc tạm dừng đã quá hạn</div>
                  </div>
                </div>
                <div className="furni-status-figures">
                  <span className="furni-count-pill" style={{ color: overdueCount === 0 ? 'var(--muted)' : '#ef4444' }}>
                    {overdueCount} phiếu <span className="furni-stat-pct">({Math.round(overduePct)}%)</span>
                  </span>
                  {selectedStatus === 'Quá hạn SLA' && <Filter size={13} style={{ color: '#ef4444' }} />}
                </div>
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="furni-segment-explanation">
        <p>Phiếu quá hạn được tách khỏi Đang xử lý và Chờ tiếp nhận. Đang xử lý gồm cả Tạm dừng. Đã hoàn tất gồm Đã giải quyết và Đã đóng. Khác gồm các trạng thái còn lại.</p>
        {otherCount>0&&<button className="furni-filter-btn" onClick={()=>selectStatus(selectedStatus==='Khác'?null:'Khác')}>Khác: {otherCount}</button>}
      </div>
      {/* 3. Phân bổ đội ngũ (Theo nhóm Nội thất) + Bộ 3 Widget SLA & CSAT */}
      <div className="furni-center-grid">
        {/* Phân bổ chuyên môn (Nội thất) */}
        <div className="furni-team-card">
          <div className="furni-card-header">
            <div>
              <span className="furni-card-tag">Phân bổ đội ngũ chuyên môn</span>
              <h2 className="furni-card-title">Phân bổ công việc theo nhóm</h2>
            </div>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              Trong kỳ: <strong style={{ color: '#0284c7' }}>{workloadTotal} phiếu đang xử lý/tạm dừng</strong>
            </span>
          </div>

          <p className="furni-period-note">Tỷ trọng phiếu đang xử lý hoặc tạm dừng, thuộc các phiếu tạo trong kỳ.</p>
          <div className="furni-team-bars">
            {!groupItems.length&&<p>Chưa có dữ liệu công việc trong kỳ.</p>}
            {groupItems.map((grp, idx) => {
              const barColor = idx === 0 ? '#0284c7' : idx === 1 ? '#38bdf8' : '#94a3b8';
              return (
                <div key={grp.name} className="furni-team-row">
                  <div className="furni-team-info">
                    <div className="furni-team-label">
                      <Armchair size={16} style={{ color: barColor }} />
                      <span>{grp.name}</span>
                    </div>
                    <div className="furni-team-numbers">
                      <strong>{grp.count} phiếu</strong>
                      {grp.pct > 0 ? (
                        <span className="furni-pct-badge">{grp.pct}% tỷ trọng</span>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>0%</span>
                      )}
                    </div>
                  </div>
                  <div className="furni-team-track">
                    <div
                      className="furni-team-fill"
                      style={{
                        width: `${grp.pct}%`,
                        background: barColor,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bộ 3 Widget SLA, Phản hồi, CSAT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div className="furni-mini-widget" style={{flex:1}}>
            <span className="furni-mini-label">Giải quyết đúng SLA</span>
            <div className="furni-mini-main"><div className="furni-mini-val">{slaSamples&&metrics?number.format(metrics.resolution_on_time*100/slaSamples)+'%':'Chưa có dữ liệu'}</div></div>
            <div className="furni-mini-sub">{metrics?.resolution_on_time??0}/{slaSamples} phiếu giải quyết trong kỳ có hạn hợp lệ</div>
          </div>
          <div className="furni-mini-widget" style={{flex:1}}>
            <span className="furni-mini-label">Thời gian phản hồi</span>
            <div className="furni-mini-main"><div className="furni-mini-val">{metrics?.response_avg!=null?number.format(metrics.response_avg)+' phút':'Chưa có dữ liệu'}</div></div>
            <div className="furni-mini-sub">{metrics?.response_samples??0} phiếu có phản hồi công khai đầu tiên trong kỳ</div>
          </div>
          <div className="furni-mini-widget" style={{flex:1}}>
            <span className="furni-mini-label">Mức độ hài lòng khách hàng</span>
            <div className="furni-mini-main"><div className="furni-mini-val">{metrics?.rating_avg!=null?number.format(metrics.rating_avg)+'/5':'Chưa có dữ liệu'}</div><Star size={16}/></div>
            <div className="furni-mini-sub">{metrics?.ratings??0} lượt đánh giá gửi trong kỳ</div>
          </div>
        </div>
      </div>

      {/* 4. Bento Bottom Section: Danh sách phiếu cần xử lý ngay */}
      <div className="furni-table-card">
        <div className="furni-table-header">
          <div>
            <div className="furni-table-title-row">
              <span className="furni-pulse-dot" />
              <h2>{urgentOnly?'Phiếu chuyển khẩn lên Quản lý':selectedStatus ? `Danh sách phiếu · ${selectedStatus}` : 'Danh sách phiếu cần xử lý ngay'}</h2>
            </div>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              {urgentOnly?'Yêu cầu điều phối chưa hoàn tất trên toàn hệ thống, không giới hạn ngày tạo phiếu.':selectedStatus ? 'Lọc trên toàn bộ phiếu tạo trong kỳ theo phân đoạn đã chọn.'
                : 'Phiếu tạo trong kỳ và yêu cầu khẩn từ mọi thời điểm. Ưu tiên cần điều phối, quá hạn SLA, chưa phân công rồi sắp đến hạn.'}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="furni-pct-badge" style={{ padding: '3px 10px', fontSize: 12 }}>
              {tickets?.total ?? 0} phiếu phù hợp
            </span>
            <button
              type="button"
              className="furni-filter-btn"
              title="Làm mới dữ liệu"
              disabled={busy || loadingTickets}
              onClick={() => { loadOverview(); }}
              style={{ border: '1px solid var(--border)', padding: '6px' }}
            >
              <RefreshCw size={15} className={loadingTickets ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <div className="furni-escalation-toolbar">
          <label className="field">Danh sách cần xử lý<select aria-label="Phạm vi điều phối" value={urgentOnly?'urgent':'all'} disabled={loadingTickets} onChange={e=>{setUrgentOnly(e.target.value==='urgent');setSelectedStatus(null);setPage(1);}}>
            <option value="all">Tất cả cần xử lý</option><option value="urgent" disabled={!data.escalation_available}>Chuyển khẩn lên Quản lý</option>
          </select></label>
          <span className="furni-escalation-count">Chờ điều phối khẩn: {data.pending_escalations??'Chưa cấu hình'} <small>Toàn hệ thống</small></span>
        </div>
        {!data.escalation_available&&<p className="muted">Chức năng điều phối khẩn cần migration 007_ticket_escalation.sql; không áp dụng tự động.</p>}


        {loadingTickets ? <p role="status">Đang tải danh sách…</p> : filteredTickets.length === 0 ? (
          <div className="furni-empty-box">
            <div className="furni-empty-icon">
              <CheckCircle2 size={30} />
            </div>
            <h3 className="furni-empty-title">Không có phiếu phù hợp</h3>
            <p className="furni-empty-desc">
              {urgentOnly?'Không có yêu cầu điều phối đang chờ trên toàn hệ thống.':'Danh sách được lọc theo kỳ, phân đoạn và các yêu cầu điều phối chưa hoàn tất.'}
            </p>
            <button
              type="button"
              className="furni-action-btn"
              onClick={() => { loadOverview(); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <RefreshCw size={14} className={loadingTickets ? 'animate-spin' : ''} />
              <span>Kiểm tra lại dữ liệu</span>
            </button>
          </div>
        ) : (
          <div className="furni-table-container">
            <table className="furni-table">
              <thead>
                <tr>
                  <th style={{ whiteSpace: 'nowrap' }}>Mã phiếu</th>
                  <th style={{ minWidth: 260 }}>Nội dung yêu cầu</th>
                  <th style={{ whiteSpace: 'nowrap' }}>Nhóm hỗ trợ</th>
                  <th style={{ whiteSpace: 'nowrap' }}>Nhân viên phụ trách</th>
                  <th>Trạng thái phiếu</th><th>Mức ưu tiên</th>
                  <th style={{ whiteSpace: 'nowrap', borderRadius: '0 8px 8px 0' }}>Trạng thái SLA</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map(t => {
                  const catBadge = getCategoryBadge(t.type_name);

                  return <tr key={t.id} tabIndex={0} aria-label={`Mở phiếu #HT-${t.id}`} onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();navigate(`/manager/tickets/${t.id}`);}}} onClick={event=>{
                    if(event.target instanceof Element&&!event.target.closest('a,button,select')) navigate(`/manager/tickets/${t.id}`);
                  }}>
                    <td data-label="Mã phiếu" className="furni-ticket-code"><Link className="furni-code-link" to={`/manager/tickets/${t.id}`}>#HT-{t.id}</Link></td>
                    <td data-label="Nội dung yêu cầu"><div className="furni-ticket-cell"><div><Link className="furni-ticket-name" to={`/manager/tickets/${t.id}`}>{t.title}</Link>
                      <div><span className={`furni-category-badge ${catBadge.className}`}>{catBadge.label}</span></div>
                      {t.pending_escalation&&<button className="furni-escalation-badge" title={t.pending_escalation.reason} aria-label={`Xem điều phối phiếu ${t.id}`} onClick={e=>{e.stopPropagation();void openAssignment(t.id);}}>Cần điều phối</button>}</div></div></td>
                    <td data-label="Nhóm hỗ trợ">{t.group_name||'Chưa xác định nhóm'}</td>
                    <td data-label="Nhân viên phụ trách"><span className="furni-tech-avatar">{t.assigned_to?.slice(0,1)||'?'}</span> {t.assigned_to||'Chưa phân công'}
                      <div>{(['MOI','DANG_XU_LY','TAM_DUNG'].includes(t.status)||t.pending_escalation)&&<button type="button" className="text-link furni-reassign-button" disabled={openingAssignment} onClick={event=>{event.stopPropagation();void openAssignment(t.id);}}>Phân công lại</button>}</div></td>
                    <td data-label="Trạng thái phiếu"><span className={`furni-ticket-status furni-state-${t.status.toLowerCase()}`}>{t.status_label}</span></td>
                    <td data-label="Mức ưu tiên"><span className={`furni-ticket-priority furni-priority-${t.priority_rank===3?'high':t.priority_rank===2?'medium':'low'}`}>{t.priority}</span></td>
                    <td data-label="Trạng thái SLA"><span className={t.sla_state==='Quá hạn'?'furni-sla-p0':'furni-sla-badge'}><Timer size={13}/>{t.sla_state}</span></td>
                  </tr>;

                })}
              </tbody>
            </table>
          </div>
        )}

        {tickets && <ManagerPagination data={tickets} label="phiếu" busy={loadingTickets} move={setPage}/>}
        <div className="furni-table-footer">
          <span>
            Hiển thị <strong style={{ color: 'var(--ink)' }}>{filteredTickets.length} / {tickets?.total??0}</strong> phiếu phù hợp
          </span>
          <Link to="/manager/tickets" className="furni-all-link">
            Xem toàn bộ danh bạ phiếu hỗ trợ <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      </>}
      {assignment&&<AssignmentDialog ticket={assignment} close={()=>setAssignment(undefined)} saved={async()=>{setAssignment(undefined);setNotice('Đã xử lý điều phối. Danh sách đang được cập nhật từ Backend.');loadOverview();}}/>}
    </div>
  );
}
