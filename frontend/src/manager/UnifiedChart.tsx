import { useState } from 'react';
import type { DashboardOverview } from './api';
import type { NamedCount } from './metrics';

export type ChartCriterion = 'status' | 'group' | 'type' | 'priority';

interface CriterionConfig {
  id: ChartCriterion;
  label: string;
  shortLabel: string;
  dataKey: 'by_status' | 'by_group' | 'by_type' | 'by_priority';
  emptyText: string;
}

const CRITERIA: CriterionConfig[] = [
  { id: 'status', label: 'Theo trạng thái', shortLabel: 'Trạng thái', dataKey: 'by_status', emptyText: 'Chưa có phiếu phân loại theo trạng thái.' },
  { id: 'group', label: 'Theo nhóm', shortLabel: 'Nhóm hỗ trợ', dataKey: 'by_group', emptyText: 'Chưa có phiếu phân loại theo nhóm hỗ trợ.' },
  { id: 'type', label: 'Theo loại yêu cầu', shortLabel: 'Loại yêu cầu', dataKey: 'by_type', emptyText: 'Chưa có phiếu phân loại theo loại yêu cầu.' },
  { id: 'priority', label: 'Theo mức độ ưu tiên', shortLabel: 'Mức ưu tiên', dataKey: 'by_priority', emptyText: 'Chưa có phiếu phân loại theo mức độ ưu tiên.' },
];

export function UnifiedChart({ data }: { data: DashboardOverview }) {
  const [activeCriterion, setActiveCriterion] = useState<ChartCriterion>('status');
  const currentConfig = CRITERIA.find(c => c.id === activeCriterion) || CRITERIA[0];
  const items: NamedCount[] = (data[currentConfig.dataKey] as NamedCount[]) || [];

  const total = items.reduce((sum, item) => sum + item.count, 0);
  const colors = items.map((_, index) => `var(--manager-chart-${(index % 8) + 1})`);

  let start = 0;
  const segments = items.map((item, index) => {
    const pct = total > 0 ? (item.count / total) * 100 : 0;
    const end = start + pct;
    const segment = `${colors[index]} ${start}% ${end}%`;
    start = end;
    return segment;
  });

  return (
    <section className="panel manager-chart manager-unified-chart">
      {/* Thanh điều hướng / Tabs ngang */}
      <div className="manager-unified-header">
        <div className="manager-unified-title">
          <div className="manager-title-row">
            <h2>Phân bố phiếu hỗ trợ</h2>
            <span className="manager-total-pill">
              <strong>{total}</strong> phiếu tổng cộng
            </span>
          </div>
          <p>Chuyển đổi các góc nhìn thống kê phân loại yêu cầu trên một biểu đồ duy nhất</p>
        </div>

        <nav className="manager-tab-bar" role="tablist" aria-label="Chọn tiêu chí thống kê">
          {CRITERIA.map(criterion => {
            const isActive = activeCriterion === criterion.id;
            const criterionItems = (data[criterion.dataKey] as NamedCount[]) || [];
            const itemCount = criterionItems.length;

            return (
              <button
                key={criterion.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`manager-tab-item ${isActive ? 'is-active' : ''}`}
                onClick={() => setActiveCriterion(criterion.id)}
              >
                <span className="manager-tab-label">{criterion.label}</span>
                {itemCount > 0 && <span className="manager-tab-count">{itemCount}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Khu vực hiển thị biểu đồ chính */}
      {total > 0 && items.length > 0 ? (
        <div className="manager-unified-body">
          {/* Cột trái: Donut visual */}
          <div className="manager-donut-showcase">
            <div
              className="manager-donut"
              aria-label={`Biểu đồ tròn phân bố ${currentConfig.label}`}
              style={{ background: `conic-gradient(${segments.join(',')})` }}
            >
              <span>
                <strong>{total}</strong>
                <small>phiếu</small>
                <em className="manager-donut-criterion">{currentConfig.shortLabel}</em>
              </span>
            </div>
          </div>

          {/* Cột phải: Thanh ngang phân bố chi tiết */}
          <div className="manager-bars-showcase">
            <div className="manager-bars-list">
              {items.map((item, index) => {
                const percentage = total > 0 ? (item.count / total) * 100 : 0;
                return (
                  <div key={item.name} className="manager-bar-row">
                    <div className="manager-bar-info">
                      <span className="manager-bar-name">
                        <i
                          className="manager-bar-dot"
                          aria-hidden="true"
                          style={{ background: colors[index] }}
                        />
                        <span className="manager-name-text" title={item.name}>
                          {item.name}
                        </span>
                      </span>
                      <span className="manager-bar-metric">
                        <strong>{item.count}</strong>
                        <small>phiếu</small>
                        <span className="manager-bar-badge">{percentage.toFixed(0)}%</span>
                      </span>
                    </div>

                    <div className="manager-bar-track" aria-hidden="true">
                      <i
                        style={{
                          width: `${percentage}%`,
                          background: colors[index],
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="manager-unified-empty">
          <p>{currentConfig.emptyText}</p>
        </div>
      )}
    </section>
  );
}

