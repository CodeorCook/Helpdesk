import { api } from '../api';
import type { Ticket } from '../customer/api';
export const staffApi=<T,>(path:string,options:RequestInit={})=>api<T>(`/staff${path}`,options);
export type StaffTicket=Ticket&{group_id:string|null;group_name:string|null;assigned_id:string|null;priority_id:string;recommended:boolean;sla_name:string|null;response_due:string|null;resolution_due:string|null;first_response_at:string|null;resolved_at:string|null;sla_state:string};
export type StaffPage={items:StaffTicket[];total:number;page:number;page_size:number};
