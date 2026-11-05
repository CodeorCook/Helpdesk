export type NamedCount = { name: string; count: number };
export const ticketMetrics = [
  ['total', 'Tổng phiếu', 'teal'],
  ['waiting', 'Mới / chờ tiếp nhận', 'amber'],
  ['processing', 'Đang xử lý', 'blue'],
  ['paused', 'Tạm dừng', 'violet'],
  ['resolved', 'Đã giải quyết', 'green'],
  ['closed', 'Đã đóng', 'slate'],
  ['overdue', 'Quá hạn SLA', 'red'],
] as const;
export type TicketCounts = Record<typeof ticketMetrics[number][0], number>;
