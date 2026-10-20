import { api } from '../api';
export const managerApi=<T,>(path:string,options:RequestInit={})=>api<T>(`/manager${path}`,options);
export const roles:Record<string,string>={KHACH_HANG:'Khách hàng',NHAN_VIEN:'Nhân viên hỗ trợ',QUAN_TRI_VIEN:'Quản lý'};
export type Account={id:string;name:string;email:string;phone:string|null;role:string;role_label:string;status:string;created_at:string;updated_at:string};
export type Page<T>={items:T[];total:number;page:number;page_size:number};
export type Overview={total:number;waiting:number;processing:number;paused:number;resolved:number;closed:number;overdue:number;users:number;groups:number;by_status:{name:string;count:number}[];by_group:{name:string;count:number}[];by_type:{name:string;count:number}[];by_priority:{name:string;count:number}[]};
