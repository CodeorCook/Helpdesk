import { useId } from 'react';
import type { Analytics, Grain, TrendPoint } from './reportTypes';

const dayLabel = (date: string) => date.slice(8, 10) + '/' + date.slice(5, 7);
const dateKey = (date: Date) => date.toISOString().slice(0, 10);

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
  const points = buckets(report, grain);
  const max = Math.max(1, ...points.flatMap(point => [point.created, point.resolved]));
  const step = Math.max(1, Math.ceil(max / 4));
  const scale = step * 4;
  const chart = { left: 44, top: 12, width: 696, height: 164 };
  const spacing = chart.width / points.length;
  const barWidth = Math.min(19, spacing * 0.42);
  const tickEvery = Math.ceil(points.length / 8);
  if (!report.metrics.created && !report.metrics.resolved) return <p>Chưa có phiếu tạo hoặc giải quyết trong kỳ.</p>;

  return <figure className="report-trend" aria-labelledby={caption}>
    <figcaption id={caption}>Số phiếu theo {grain === 'day' ? 'ngày' : grain === 'week' ? 'tuần' : 'tháng'} · <span>■ Phiếu tạo</span> · <span>■ Phiếu giải quyết</span></figcaption>
    <svg viewBox="0 0 760 214" role="img" aria-labelledby={caption}>
      {[0, 1, 2, 3, 4].map(tick => {
        const y = chart.top + chart.height * (1 - tick / 4);
        return <g key={tick}><line x1={chart.left} x2={chart.left + chart.width} y1={y} y2={y}/>
          <text x={chart.left - 8} y={y + 4} textAnchor="end">{tick * step}</text></g>;
      })}
      {points.map((point, index) => {
        const x = chart.left + spacing * (index + 0.5);
        const created = chart.height * point.created / scale;
        const resolved = chart.height * point.resolved / scale;
        const label = grain === 'month' ? point.date.slice(5, 7) + '/' + point.date.slice(0, 4) : dayLabel(point.date);
        const tooltip = `${grain === 'week' ? 'Tuần từ ' : ''}${point.date}: ${point.created} tạo, ${point.resolved} giải quyết`;
        return <g key={point.date}>
          <title>{tooltip}</title>
          <rect className="report-chart-hit" x={x - spacing / 2} y={chart.top} width={spacing} height={chart.height}/>
          <rect className="report-chart-created" x={x - barWidth} y={chart.top + chart.height - created} width={barWidth} height={created}/>
          <rect className="report-chart-resolved" x={x} y={chart.top + chart.height - resolved} width={barWidth} height={resolved}/>
          {index % tickEvery === 0 && <text x={x} y={201} textAnchor="middle">{label}</text>}
        </g>;
      })}
    </svg>
    <details className="report-screen-only">
      <summary>Xem số liệu từng mốc</summary>
      <div className="report-chart-data">
        {points.map(point => <div key={point.date}>{point.date} · {point.created} tạo · {point.resolved} giải quyết</div>)}
      </div>
    </details>
  </figure>;
}
