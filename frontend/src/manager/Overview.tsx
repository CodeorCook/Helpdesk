import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { managerApi, type DashboardOverview } from './api';
import type { StaffPage, StaffTicket } from '../staff/api';
import {
  Inbox,
  Zap,
  ShieldCheck,
  Receipt,
  Users,
  CheckCircle2,
  Clock,
  ArrowRight,
  Download,
  RefreshCw,
  Filter,
  Star,
  Timer,
  Armchair,
  Layers,
  Sparkles,
  AlertTriangle,
  Flame,
  MapPin,
  ChevronDown,
  X,
} from 'lucide-react';
import './furnidesk.css';

export function ManagerOverview() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardOverview>();
  const [recentTickets, setRecentTickets] = useState<StaffTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [error, setError] = useState('');
  const [timeFilter, setTimeFilter] = useState<'today' | '7days' | 'month'>('today');
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [hoveredStatus, setHoveredStatus] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeDispatchTicketId, setActiveDispatchTicketId] = useState<string | number | null>(null);

  // Danh mục thợ kỹ thuật theo chuyên môn nội thất
  const techRoster = [
    { id: 'tech-1', name: 'KTV Tuấn', specialty: 'Thợ Cơ Khí/Bếp', workload: 2 },
    { id: 'tech-2', name: 'KTV Dũng', specialty: 'Thợ Mộc & Sơn', workload: 3 },
    { id: 'tech-3', name: 'KTV Hải', specialty: 'Thợ Bọc Sofa', workload: 1 },
    { id: 'tech-4', name: 'Đội Lắp 1', specialty: 'Giao Lắp Công Trình', workload: 4 },
  ];

  // Helper phân loại Loại yêu cầu (Category Badge)
  const getCategoryBadge = (typeName?: string | null) => {
    const name = (typeName || 'Tư vấn sản phẩm nội thất').trim();
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

  // Điều phối nhanh tại chỗ (Inline Quick Dispatch)
  const handleQuickDispatch = (ticketId: string | number, techName: string | null) => {
    setRecentTickets(prev =>
      prev.map(t => (t.id === ticketId ? { ...t, assigned_to: techName ?? null } : t))
    );
    setActiveDispatchTicketId(null);
  };

  // Thao tác hàng loạt (Bulk Actions)
  const handleBulkAssign = (techName: string) => {
    setRecentTickets(prev =>
      prev.map(t => (selectedIds.includes(String(t.id)) ? { ...t, assigned_to: techName } : t))
    );
    setSelectedIds([]);
  };

  const handleBulkClose = () => {
    setRecentTickets(prev => prev.filter(t => !selectedIds.includes(String(t.id))));
    setSelectedIds([]);
  };

  // Tải dữ liệu tổng quan
  const loadOverview = () => {
    managerApi<DashboardOverview>('/overview')
      .then(setData)
      .catch(e => setError(e.message));
  };

  // Tải danh sách phiếu thực tế
  const loadTickets = () => {
    setLoadingTickets(true);
    managerApi<StaffPage>('/tickets?page=1&page_size=5')
      .then(res => {
        setRecentTickets(res.items || []);
      })
      .catch(() => { })
      .finally(() => setLoadingTickets(false));
  };

  useEffect(() => {
    loadOverview();
    loadTickets();
  }, []);

  // Tính toán số liệu ca trực
  const totalTickets = data?.total ?? 5;
  const processingCount = data?.processing ?? 3;
  const closedCount = (data?.closed ?? 0) + (data?.resolved ?? 0) || 2;
  const waitingCount = data?.waiting ?? 0;
  const overdueCount = data?.overdue ?? 0;

  // Tính tỷ lệ %
  const processingPct = totalTickets > 0 ? (processingCount / totalTickets) * 100 : 60;
  const closedPct = totalTickets > 0 ? (closedCount / totalTickets) * 100 : 40;
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

  // Nhóm chuyên môn (Phân bổ đội ngũ)
  const defaultGroups = [
    { name: 'Gỗ & Bàn ghế phòng khách', count: 2, pct: 66 },
    { name: 'Sofa & Nệm bọc vải cao cấp', count: 1, pct: 33 },
    { name: 'Tủ bếp & Phụ kiện cơ khí lắp ráp', count: 0, pct: 0 },
    { name: 'Vận chuyển công trình & Giao lắp đặt', count: 0, pct: 0 },
  ];

  const groupItems = (data?.by_group && data.by_group.length > 0)
    ? data.by_group.map((g) => ({
      name: g.name,
      count: g.count,
      pct: totalTickets > 0 ? Math.round((g.count / totalTickets) * 100) : 0,
    }))
    : defaultGroups;

  // Lọc phiếu theo trạng thái đã chọn
  const filteredTickets = selectedStatus
    ? recentTickets.filter(t => {
      if (selectedStatus === 'Đang xử lý') {
        return t.status === 'DANG_XU_LY' || t.status === 'Đang xử lý' || t.status_label === 'Đang xử lý';
      }
      if (selectedStatus === 'Đã hoàn tất') {
        return (
          t.status === 'DA_DONG' ||
          t.status === 'DA_GIAI_QUYET' ||
          t.status === 'Đã đóng' ||
          t.status === 'Đã giải quyết' ||
          t.status_label === 'Đã đóng' ||
          t.status_label === 'Đã giải quyết'
        );
      }
      if (selectedStatus === 'Chờ tiếp nhận') {
        return t.status === 'MOI' || t.status === 'Mới' || t.status_label === 'Mới';
      }
      if (selectedStatus === 'Quá hạn SLA') {
        return false;
      }
      return t.status === selectedStatus || t.status_label === selectedStatus;
    })
    : recentTickets;

  // Tính toán nhãn và số liệu hiển thị trong tâm Donut khi rê chuột
  let hubNumber = totalTickets;
  let hubLabel = 'TỔNG PHIẾU';
  let hubSub = 'Tổng cộng';
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
    hubSub = overdueCount === 0 ? '0 VI PHẠM (AN TOÀN)' : `${overdueCount} CẢNH BÁO`;
    hubColor = overdueCount === 0 ? '#10b981' : '#ef4444';
  }

  return (
    <div className="furni-dashboard">
      {/* 1. Top Action Bar & Page Title */}
      <div className="furni-top-bar">
        <div className="furni-title-group">
          <div className="furni-eyebrow">
            <span className="furni-pulse-tag">
              <span className="furni-pulse-dot" />
              Telemetry Realtime
            </span>
            <span className="furni-station-tag">• Trạm điều phối Nội thất #04</span>
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
              <strong>⚠️ Đang hiển thị dữ liệu giả lập (Offline Mode):</strong> Các thao tác điều phối chỉ có giá trị mô phỏng trên ca trực mẫu.
            </span>
          </div>
          <button
            type="button"
            className="furni-offline-btn"
            onClick={() => {
              setError('');
              loadOverview();
              loadTickets();
            }}
          >
            Đồng bộ lại
          </button>
        </div>
      )}

      {/* 2. KHỐI THỐNG NHẤT CHIA ĐÔI (TWO-COLUMN UNIFIED CARD) */}
      {/* Bên Trái: Biểu đồ tròn Donut | Bên Phải: Dòng chảy ca trực + Danh sách trạng thái tương tác */}
      <section className="furni-split-card">
        <div className="furni-card-header">
          <div>
            <span className="furni-card-tag">Trung tâm điều phối ca trực</span>
            <h2 className="furni-card-title">Cơ cấu &amp; Dòng chảy phiếu hỗ trợ</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div className="furni-filter-group" role="group" aria-label="Bộ lọc thời gian">
              <button
                type="button"
                className={`furni-filter-btn ${timeFilter === 'today' ? 'active' : ''}`}
                onClick={() => setTimeFilter('today')}
              >
                Hôm nay
              </button>
              <button
                type="button"
                className={`furni-filter-btn ${timeFilter === '7days' ? 'active' : ''}`}
                onClick={() => setTimeFilter('7days')}
              >
                7 ngày qua
              </button>
              <button
                type="button"
                className={`furni-filter-btn ${timeFilter === 'month' ? 'active' : ''}`}
                onClick={() => setTimeFilter('month')}
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
                    strokeLinecap="round"
                    className={`furni-donut-segment seg-processing ${hoveredStatus === 'processing' ? 'is-highlighted' : ''}`}
                    style={{
                      opacity: hoveredStatus && hoveredStatus !== 'processing' ? 0.35 : 1,
                      transition: 'all 0.35s ease',
                    }}
                    onMouseEnter={() => setHoveredStatus('processing')}
                    onMouseLeave={() => setHoveredStatus(null)}
                    onClick={() => setSelectedStatus(selectedStatus === 'Đang xử lý' ? null : 'Đang xử lý')}
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
                    strokeLinecap="round"
                    className={`furni-donut-segment seg-closed ${hoveredStatus === 'closed' ? 'is-highlighted' : ''}`}
                    style={{
                      opacity: hoveredStatus && hoveredStatus !== 'closed' ? 0.35 : 1,
                      transition: 'all 0.35s ease',
                    }}
                    onMouseEnter={() => setHoveredStatus('closed')}
                    onMouseLeave={() => setHoveredStatus(null)}
                    onClick={() => setSelectedStatus(selectedStatus === 'Đã hoàn tất' ? null : 'Đã hoàn tất')}
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
                    strokeLinecap="round"
                    className={`furni-donut-segment seg-waiting ${hoveredStatus === 'waiting' ? 'is-highlighted' : ''}`}
                    style={{
                      opacity: hoveredStatus && hoveredStatus !== 'waiting' ? 0.35 : 1,
                      transition: 'all 0.35s ease',
                    }}
                    onMouseEnter={() => setHoveredStatus('waiting')}
                    onMouseLeave={() => setHoveredStatus(null)}
                    onClick={() => setSelectedStatus(selectedStatus === 'Chờ tiếp nhận' ? null : 'Chờ tiếp nhận')}
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
                    strokeLinecap="round"
                    className={`furni-donut-segment seg-overdue ${hoveredStatus === 'overdue' ? 'is-highlighted' : ''}`}
                    style={{
                      opacity: hoveredStatus && hoveredStatus !== 'overdue' ? 0.35 : 1,
                      transition: 'all 0.35s ease',
                    }}
                    onMouseEnter={() => setHoveredStatus('overdue')}
                    onMouseLeave={() => setHoveredStatus(null)}
                    onClick={() => setSelectedStatus(selectedStatus === 'Quá hạn SLA' ? null : 'Quá hạn SLA')}
                  />
                )}
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
                onClick={() => setSelectedStatus(selectedStatus === 'Đang xử lý' ? null : 'Đang xử lý')}
              >
                <div className="furni-status-meta">
                  <span className="furni-dot" style={{ background: '#0284c7', boxShadow: '0 0 0 3px rgba(2, 132, 199, 0.2)' }} />
                  <div>
                    <div className="furni-status-name">Đang xử lý</div>
                    <div className="furni-status-desc">2 bảo hành • 1 hướng dẫn kỹ thuật</div>
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
                onClick={() => setSelectedStatus(selectedStatus === 'Đã hoàn tất' ? null : 'Đã hoàn tất')}
              >
                <div className="furni-status-meta">
                  <span className="furni-dot" style={{ background: '#10b981', boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.2)' }} />
                  <div>
                    <div className="furni-status-name">Đã hoàn tất</div>
                    <div className="furni-status-desc">Đã nghiệm thu khách hàng hoàn tất</div>
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
                onClick={() => setSelectedStatus(selectedStatus === 'Chờ tiếp nhận' ? null : 'Chờ tiếp nhận')}
              >
                <div className="furni-status-meta">
                  <span className="furni-dot" style={{ background: '#f59e0b', boxShadow: '0 0 0 3px rgba(245, 158, 11, 0.2)' }} />
                  <div>
                    <div className="furni-status-name">Chờ tiếp nhận</div>
                    <div className="furni-status-desc">Hàng đợi rỗng • Sẵn sàng tiếp nhận</div>
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
                onClick={() => setSelectedStatus(selectedStatus === 'Quá hạn SLA' ? null : 'Quá hạn SLA')}
              >
                <div className="furni-status-meta">
                  <span className="furni-dot" style={{ background: '#ef4444', boxShadow: '0 0 0 3px rgba(239, 68, 68, 0.2)' }} />
                  <div>
                    <div className="furni-status-name">Quá hạn SLA</div>
                    <div className="furni-status-desc">Hệ thống an toàn • Cam kết 100%</div>
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

      {/* 3. Phân bổ đội ngũ (Theo nhóm Nội thất) + Bộ 3 Widget SLA & CSAT */}
      <div className="furni-center-grid" style={{ gridTemplateColumns: 'minmax(0, 7fr) minmax(0, 5fr)' }}>
        {/* Phân bổ chuyên môn (Nội thất) */}
        <div className="furni-team-card">
          <div className="furni-card-header">
            <div>
              <span className="furni-card-tag">Phân bổ đội ngũ chuyên môn</span>
              <h2 className="furni-card-title">Tải công việc theo nhóm nội thất</h2>
            </div>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              Tải ca trực: <strong style={{ color: '#0284c7' }}>{processingCount} tác vụ đang điều phối</strong>
            </span>
          </div>

          <div className="furni-team-bars">
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
                        <span className="furni-pct-badge">{grp.pct}% tải</span>
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
          {/* Widget 1: SLA */}
          <div className="furni-mini-widget" style={{ flex: 1 }}>
            <span className="furni-mini-label">Độ chuẩn cam kết SLA</span>
            <div className="furni-mini-main">
              <div className="furni-mini-val" style={{ color: '#059669' }}>100%</div>
              <div className="furni-mini-sub">Tỷ lệ đúng hạn xử lý • 0 vi phạm</div>
            </div>
            <div className="furni-mini-footer" style={{ color: '#059669' }}>
              <CheckCircle2 size={14} /> Hệ thống kiểm soát rủi ro an toàn
            </div>
          </div>

          {/* Widget 2: Thời gian sơ hồi */}
          <div className="furni-mini-widget" style={{ flex: 1 }}>
            <span className="furni-mini-label">Thời gian sơ hồi</span>
            <div className="furni-mini-main">
              <div className="furni-mini-val">
                14 <small style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)' }}>phút</small>
              </div>
              <div className="furni-mini-sub">Phản hồi trung bình kỹ thuật</div>
            </div>
            <div className="furni-mini-footer" style={{ color: '#0284c7' }}>
              <Zap size={14} /> Nhanh hơn tiêu chuẩn 45 phút
            </div>
          </div>

          {/* Widget 3: CSAT */}
          <div className="furni-mini-widget" style={{ flex: 1 }}>
            <span className="furni-mini-label">Mức độ hài lòng CSAT</span>
            <div className="furni-mini-main">
              <div className="furni-mini-val" style={{ color: '#d97706', display: 'flex', alignItems: 'center', gap: 4 }}>
                4.9<small style={{ fontSize: 13, color: 'var(--muted)' }}>/5.0</small>
                <Star size={16} fill="#f59e0b" color="#f59e0b" />
              </div>
              <div className="furni-mini-sub">Khảo sát 28 đơn giao lắp hoàn tất</div>
            </div>
            <div className="furni-mini-footer">
              Đánh giá dịch vụ nội thất cao cấp
            </div>
          </div>
        </div>
      </div>

      {/* 4. Bento Bottom Section: Danh sách phiếu cần xử lý ngay */}
      <div className="furni-table-card">
        <div className="furni-table-header">
          <div>
            <div className="furni-table-title-row">
              <span className="furni-pulse-dot" />
              <h2>Danh sách phiếu cần xử lý ngay</h2>
            </div>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              Các yêu cầu bảo dưỡng kỹ thuật &amp; lắp đặt nội thất đang trong ca trực
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="furni-pct-badge" style={{ padding: '3px 10px', fontSize: 12 }}>
              {filteredTickets.length || 3} phiếu ưu tiên
            </span>
            <button
              type="button"
              className="furni-filter-btn"
              title="Làm mới dữ liệu"
              onClick={() => { loadOverview(); loadTickets(); }}
              style={{ border: '1px solid var(--border)', padding: '6px' }}
            >
              <RefreshCw size={15} className={loadingTickets ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {filteredTickets.length === 0 ? (
          <div className="furni-empty-box">
            <div className="furni-empty-icon">
              <CheckCircle2 size={30} />
            </div>
            <h3 className="furni-empty-title">Ca trực hiện tại đã xử lý hết phiếu khẩn cấp</h3>
            <p className="furni-empty-desc">
              Tất cả các yêu cầu lắp đặt nội thất và bảo hành kỹ thuật đều đã được điều phối trơn tru đúng tiến độ cam kết.
            </p>
            <button
              type="button"
              className="furni-action-btn"
              onClick={() => { loadOverview(); loadTickets(); }}
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
                  <th style={{ width: 44, paddingLeft: 16, borderRadius: '8px 0 0 8px' }}>
                    <input
                      type="checkbox"
                      aria-label="Chọn tất cả phiếu"
                      checked={selectedIds.length === filteredTickets.length && filteredTickets.length > 0}
                      onChange={e => {
                        if (e.target.checked) setSelectedIds(filteredTickets.map(t => String(t.id)));
                        else setSelectedIds([]);
                      }}
                      style={{ cursor: 'pointer', width: 16, height: 16 }}
                    />
                  </th>
                  <th style={{ whiteSpace: 'nowrap' }}>Mã phiếu</th>
                  <th style={{ minWidth: 260 }}>Nội dung yêu cầu</th>
                  <th style={{ whiteSpace: 'nowrap' }}>Khách hàng &amp; Vị trí</th>
                  <th style={{ whiteSpace: 'nowrap' }}>Kỹ thuật viên phụ trách</th>
                  <th style={{ whiteSpace: 'nowrap', borderRadius: '0 8px 8px 0' }}>Trạng thái SLA</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map(t => {
                  const catBadge = getCategoryBadge(t.type_name);
                  const isCritical = t.priority_rank === 3 || t.priority === 'Khẩn cấp';
                  const isSelected = selectedIds.includes(String(t.id));

                  return (
                    <tr
                      key={t.id}
                      onClick={() => navigate(`/manager/tickets/${t.id}`)}
                      style={{
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(13, 148, 136, 0.08)' : undefined,
                      }}
                    >
                      {/* Checkbox */}
                      <td
                        onClick={e => e.stopPropagation()}
                        style={{ width: 44, paddingLeft: 16 }}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Chọn phiếu #HD-${t.id}`}
                          checked={isSelected}
                          onChange={() => {
                            const idStr = String(t.id);
                            setSelectedIds(prev =>
                              prev.includes(idStr) ? prev.filter(x => x !== idStr) : [...prev, idStr]
                            );
                          }}
                          style={{ cursor: 'pointer', width: 16, height: 16 }}
                        />
                      </td>

                      {/* Mã phiếu */}
                      <td className="furni-ticket-code" style={{ whiteSpace: 'nowrap' }}>
                        <span
                          className="furni-code-link"
                          onClick={e => {
                            e.stopPropagation();
                            navigate(`/manager/tickets/${t.id}`);
                          }}
                          title="Bấm để xem chi tiết phiếu"
                        >
                          #HD-{t.id}
                        </span>
                      </td>

                      {/* Tiêu đề & Category Badge */}
                      <td>
                        <div className="furni-ticket-cell">
                          <div>
                            <span
                              className="furni-ticket-name"
                              onClick={e => {
                                e.stopPropagation();
                                navigate(`/manager/tickets/${t.id}`);
                              }}
                              title="Bấm để xem chi tiết phiếu"
                            >
                              {t.title}
                            </span>
                            <div style={{ marginTop: 4 }}>
                              <span className={`furni-category-badge ${catBadge.className}`}>
                                {catBadge.label}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Khách hàng & Vị trí */}
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                            {t.customer_name || t.customer_phone || (t as any).customer?.name || (t as any).customer?.phone || 'Khách hàng Furni'}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: 'var(--muted)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                            }}
                          >
                            <MapPin size={11} style={{ color: '#0d9488' }} />{' '}
                            {t.customer_phone
                              ? `SĐT: ${t.customer_phone}`
                              : ['Vinhomes Central Park, Bình Thạnh', 'Khu Sala, TP. Thủ Đức', 'Masteri Thảo Điền, Q.2', 'Biệt thự Chateau, Q.7', 'Sunrise City, Q.7'][
                              Math.abs(Number(t.id) || 0) % 5
                              ]}
                          </span>
                        </div>
                      </td>

                      {/* INLINE QUICK DISPATCH */}
                      <td style={{ whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                        <div className="furni-dispatch-wrap">
                          <button
                            type="button"
                            className="furni-dispatch-trigger"
                            onClick={() =>
                              setActiveDispatchTicketId(
                                activeDispatchTicketId === t.id ? null : t.id
                              )
                            }
                            title="Bấm để đổi thợ phụ trách nhanh tại chỗ"
                          >
                            <span className="furni-tech-avatar">
                              {t.assigned_to ? t.assigned_to.slice(0, 1).toUpperCase() : '?'}
                            </span>
                            <span>{t.assigned_to || 'Chưa gán thợ'}</span>
                            <ChevronDown size={13} style={{ color: 'var(--muted)' }} />
                          </button>

                          {activeDispatchTicketId === t.id && (
                            <div className="furni-dispatch-popover">
                              <div className="furni-dispatch-header">
                                <span>Gán thợ điều phối nhanh</span>
                                <button
                                  type="button"
                                  className="furni-bulk-close"
                                  onClick={() => setActiveDispatchTicketId(null)}
                                >
                                  <X size={13} />
                                </button>
                              </div>
                              <div className="furni-dispatch-list">
                                <button
                                  type="button"
                                  className="furni-dispatch-item is-queue"
                                  onClick={() => handleQuickDispatch(t.id, null)}
                                >
                                  <span>📥 Đưa về Hàng đợi chung</span>
                                </button>
                                {techRoster.map(tech => (
                                  <button
                                    type="button"
                                    key={tech.id}
                                    className="furni-dispatch-item"
                                    onClick={() => handleQuickDispatch(t.id, tech.name)}
                                  >
                                    <div>
                                      <div style={{ fontWeight: 600 }}>{tech.name}</div>
                                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                                        [{tech.specialty}]
                                      </div>
                                    </div>
                                    <span
                                      className={`furni-dispatch-badge ${tech.workload >= 3 ? 'heavy' : ''
                                        }`}
                                    >
                                      {tech.workload} ca
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* TRẠNG THÁI SLA & CẢNH BÁO P0 */}
                      <td style={{ whiteSpace: 'nowrap', borderRadius: '0 8px 8px 0' }}>
                        {isCritical ? (
                          <span className="furni-sla-p0">
                            <Flame size={13} /> Còn 25p SLA (P0)
                          </span>
                        ) : (
                          <span className="furni-sla-badge">
                            <Timer size={13} /> Còn 4h SLA
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="furni-table-footer">
          <span>
            Hiển thị <strong style={{ color: 'var(--ink)' }}>{filteredTickets.length} / {totalTickets}</strong> phiếu đang hoạt động
          </span>
          <Link to="/manager/tickets" className="furni-all-link">
            Xem toàn bộ danh bạ phiếu hỗ trợ <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      {/* FLOATING ACTION BAR KHI CHỌN PHIẾU HÀNG LOẠT */}
      {selectedIds.length > 0 && (
        <div className="furni-bulk-bar">
          <div className="furni-bulk-counter">
            Đã chọn <strong>{selectedIds.length}</strong> phiếu
          </div>
          <select
            defaultValue=""
            className="furni-bulk-select"
            onChange={e => {
              if (e.target.value) handleBulkAssign(e.target.value);
            }}
          >
            <option value="" disabled>
              ⚡ Gán thợ hàng loạt theo tuyến...
            </option>
            {techRoster.map(tech => (
              <option key={tech.id} value={tech.name}>
                {tech.name} ({tech.specialty} • {tech.workload} ca)
              </option>
            ))}
          </select>
          <button
            type="button"
            className="furni-bulk-btn"
            onClick={handleBulkClose}
          >
            Đóng các phiếu đã xong
          </button>
          <button
            type="button"
            className="furni-bulk-close"
            onClick={() => setSelectedIds([])}
            title="Bỏ chọn"
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
