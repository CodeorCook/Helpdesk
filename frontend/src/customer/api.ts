import { api } from '../api';
export type Catalog = {id:string;name:string;code:string|null};
export type Ticket = {id:string;title:string;description:string;type_id:string|null;type_name:string|null;status:string;status_label:string;priority:string;created_at:string;updated_at:string;closed_at:string|null;assigned_to:string|null;can_modify:boolean;end_reason:string|null;termination_kind?:string|null;closed_by_customer:boolean};
export const customerApi=<T,>(path:string,options:RequestInit={})=>api<T>(`/customer${path}`,options);
export const formatDate=(value:string)=>new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});
export type UploadPolicy={max_bytes:number;max_files:number;extensions:string[]};
