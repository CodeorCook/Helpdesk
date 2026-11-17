import { useId, useState } from 'react';
import { Calendar, Check, ChevronDown, Filter, TrendingUp } from 'lucide-react';
import type { Analytics, Grain, TrendPoint } from './reportTypes';

const dayLabel = (date: string) => date.slice(8, 10) + '/' + date.slice(5, 7);
const dateKey = (date: Date) => date.toISOString().slice(0, 10);

const formatPointDate = (dateStr: string, grain: Grain) => {
  if (grain === 'month') {
    return `Tháng ${dateStr.slice(5, 7)}/${dateStr.slice(0, 4)}`;
  }
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
};

function buckets(report: Analytics, grain: Grain) {
  const points = new Map(report.trend.filter(point => point.grain === grain).map(point => [point.date, point]));
  const date = new Date(report.start + 'T00:00:00Z');
  if (grain === 'month') date.setUTCDate(1);
  if (grain === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  const result: TrendPoint[] = [];
  while (dateKey(date) <= report.end) {
    const key = dateKey(date);
    result.push(points.get(key) ?? { grain, date: key, created: 0, resolved: 0 });
    if (grain === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
    else date.setUTCDate(date.getUTCDate() + (grain === 'day' ? 1 : 7));
  }
  return result;
}

export function ReportTrend({ report, grain }: { report: Analytics; grain: Grain }) {
  const caption = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [onlyActive, setOnlyActive] = useState(false);
  const points = buckets(report, grain);
  const max = Math.max(1, ...points.flatMap(point => [point.created, point.resolved]));
  const step = Math.max(1, Math.ceil(max / 4));
  const scale = step * 4;
  const chart = { left: 44, top: 12, width: 696, height: 164 };
  const spacing = chart.width / points.length;
  const barWidth = Math.min(19, spacing * 0.42);
  const tickEvery = Math.ceil(points.length / 8);

  const activePoints = points.filter(p => p.created > 0 || p.resolved > 0);
  const displayedPoints = onlyActive ? activePoints : points;

  if (!report.metrics.created && !report.metrics.resolved) {
    return (
      <p style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)' }}>
        Chưa có phiếu tạo hoặc giải quyết trong kỳ.
      </p>
    );
  }

  return (
    <figure className="report-trend" aria-labelledby={caption}>
      <figcaption id={caption}>
        Số phiếu theo {grain === 'day' ? 'ngày' : grain === 'week' ? 'tuần' : 'tháng'} · <span>■ Phiếu tạo</span> ·{' '}
        <span>■ Phiếu giải quyết</span>
      </figcaption>
      <svg viewBox="0 0 760 214" role="img" aria-labelledby={caption}>
        {[0, 1, 2, 3, 4].map(tick => {
          const y = chart.top + chart.height * (1 - tick / 4);
          return (
            <g key={tick}>
              <line x1={chart.left} x2={chart.left + chart.width} y1={y} y2={y} />
              <text x={chart.left - 8} y={y + 4} textAnchor="end">
                {tick * step}
              </text>
            </g>
          );
        })}
        {points.map((point, index) => {
          const x = chart.left + spacing * (index + 0.5);
          const created = (chart.height * point.created) / scale;
          const resolved = (chart.height * point.resolved) / scale;
          const label =
            grain === 'month' ? point.date.slice(5, 7) + '/' + point.date.slice(0, 4) : dayLabel(point.date);
          const tooltip = `${grain === 'week' ? 'Tuần từ ' : ''}${formatPointDate(point.date, grain)}: ${
            point.created
          } tạo, ${point.resolved} giải quyết`;
          return (
            <g key={point.date}>
              <title>{tooltip}</title>
              <rect className="report-chart-hit" x={x - spacing / 2} y={chart.top} width={spacing} height={chart.height} />
              <rect
                className="report-chart-created"
                x={x - barWidth}
                y={chart.top + chart.height - created}
                width={barWidth}
                height={created}
              />
              <rect
                className="report-chart-resolved"
                x={x}
                y={chart.top + chart.height - resolved}
                width={barWidth}
                height={resolved}
              />
              {index % tickEvery === 0 && (
                <text x={x} y={201} textAnchor="middle">
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Modern controlled drawer replacing native details/summary */}
      <div className="furni-trend-drawer report-screen-only">
        <button
          type="button"
          className="furni-trend-toggle"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
        >
          <div className="furni-trend-toggle-left">
            <span className="furni-trend-icon-box">
              <Calendar size={15} />
            </span>
            <span className="furni-trend-heading">
              Bảng kê chi tiết theo {grain === 'day' ? 'ngày' : grain === 'week' ? 'tuần' : 'tháng'}
            </span>
            <span className="furni-trend-count-badge">
              {activePoints.length} mốc có phát sinh / {points.length} mốc
            </span>
          </div>
          <div className="furni-trend-toggle-right">
            <span className="furni-trend-toggle-hint">{isOpen ? 'Thu gọn' : 'Xem chi tiết'}</span>
            <ChevronDown size={16} className={`furni-trend-chevron ${isOpen ? 'rotated' : ''}`} />
          </div>
        </button>

        {isOpen && (
          <div className="furni-trend-content">
            <div className="furni-trend-toolbar">
              <label className="furni-trend-filter-label">
                <input
                  type="checkbox"
                  checked={onlyActive}
                  onChange={e => setOnlyActive(e.target.checked)}
                />
                <Filter size={13} style={{ color: '#2dd4bf' }} />
                <span>Chỉ hiển thị các ngày có phát sinh phiếu ({activePoints.length} mốc)</span>
              </label>
              <span className="furni-trend-counter">
                Hiển thị {displayedPoints.length} / {points.length} mốc
              </span>
            </div>

            <div className="furni-trend-table-container">
              <table className="furni-trend-table">
                <thead>
                  <tr>
                    <th>Mốc thời gian</th>
                    <th>Phiếu tiếp nhận</th>
                    <th>Phiếu giải quyết</th>
                    <th>Đánh giá ca trực</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedPoints.length > 0 ? (
                    displayedPoints.map(point => {
                      const hasActivity = point.created > 0 || point.resolved > 0;
                      let statusText = '— Không phát sinh';
                      let statusColor = 'var(--muted)';
                      if (point.created > point.resolved) {
                        statusText = `Tăng tải (+${point.created - point.resolved})`;
                        statusColor = '#38bdf8';
                      } else if (point.resolved >= point.created && point.resolved > 0) {
                        statusText = 'Đã cân bằng / Xong';
                        statusColor = '#34d399';
                      }

                      return (
                        <tr key={point.date} className={hasActivity ? 'active-row' : ''}>
                          <td style={{ fontWeight: hasActivity ? 600 : 400, whiteSpace: 'nowrap' }}>
                            {formatPointDate(point.date, grain)}
                          </td>
                          <td>
                            {point.created > 0 ? (
                              <span className="trend-badge-created">
                                <TrendingUp size={12} /> +{point.created}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--muted)' }}>0</span>
                            )}
                          </td>
                          <td>
                            {point.resolved > 0 ? (
                              <span className="trend-badge-resolved">
                                <Check size={12} /> {point.resolved}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--muted)' }}>0</span>
                            )}
                          </td>
                          <td style={{ fontSize: 11.5, color: statusColor, fontWeight: hasActivity ? 600 : 400 }}>
                            {statusText}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: '20px 0', color: 'var(--muted)' }}>
                        Không có mốc nào phát sinh phiếu trong kỳ này.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}
