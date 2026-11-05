export type Grain = 'day' | 'week' | 'month';
export type Metrics = {
  created: number; resolved: number; response_samples: number; response_avg: number | null; resolution_avg: number | null;
  response_on_time: number; response_late: number; resolution_on_time: number; resolution_late: number;
  resolution_quarter: number; resolution_half: number; resolution_full: number;
  response_missing: number; resolution_missing: number; response_open_late: number; response_open_on_time: number;
  resolution_open_late: number; resolution_open_on_time: number; intake_missing_sla: number; missing_resolution_time: number;
  closed_in_period: number; closed_with_rating: number; ratings: number; rating_avg: number | null; positive: number;
};
export type TrendPoint = { grain: Grain; date: string; created: number; resolved: number };
export type Analytics = {
  start: string; end: string; snapshot_at: string; group_id: string | null; type_id: string | null;
  metrics: Metrics; groups: (Metrics & { group_id: string; group_name: string })[];
  trend: TrendPoint[]; rating_distribution: { stars: number; count: number }[];
};
export type Activity = { id: string; ticket_id: string; happened_at: string; kind: string; actor: string; detail: string };
