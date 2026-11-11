import type { NamedCount, TicketCounts } from './metrics';
import { api } from '../api';
export const managerApi=<T,>(path:string,options:RequestInit={})=>api<T>(`/manager${path}`,options);
export const roles:Record<string,string>={KHACH_HANG:'Khách hàng',NHAN_VIEN:'Nhân viên hỗ trợ',QUAN_TRI_VIEN:'Quản lý'};
export type Membership={id:string;name:string;pending:number};
export type Account={id:string;name:string;email:string;phone:string|null;role:string;role_label:string;status:string;created_at:string;updated_at:string;memberships?:Membership[]};
export type Page<T>={items:T[];total:number;page:number;page_size:number};
export type Overview = TicketCounts & {
  users: number;
  groups: number;
  by_status: NamedCount[];
  by_group: NamedCount[];
  by_type: NamedCount[];
  by_priority: NamedCount[];
};
export type DashboardOverview = Overview & {
  by_week: NamedCount[];
  by_month: NamedCount[];
};
