import { useCallback,useEffect,useRef,useState } from 'react';
import { api,ApiError,type Role } from '../api';
export type ChatMessage={id:string;sender_id:string;sender:string;content:string;internal:boolean;from_customer?:boolean;created_at:string};
export type ChatEvent={id:string;content:string;created_at:string};
export type ChatAttachment={id:string;name:string;mime_type:string;size:number;sender_id:string|null;sender:string;created_at:string};
export type Feed={ticket_id:string;status:string;status_label:string;assigned_id:string|null;assigned_to:string|null;group_id:string|null;can_send:boolean;can_view_internal:boolean;can_send_internal?:boolean;can_mark_read?:boolean;messages:ChatMessage[];events:ChatEvent[];attachments:ChatAttachment[];has_older:boolean;has_more:boolean};
const active=(f:Feed|null)=>!f||['MOI','DANG_XU_LY','TAM_DUNG'].includes(f.status);
export function useConversation(role:Role,id:string,onChange?:()=>Promise<void>){
 const [data,setData]=useState<Feed|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true);
 const feed=useRef<Feed|null>(null);const inFlight=useRef<Promise<void>|null>(null);const controller=useRef<AbortController|null>(null);const alive=useRef(false);const epoch=useRef(0);const denied=useRef(false);const notify=useRef(onChange);notify.current=onChange;
 const refresh=useCallback(async(force=false,before?:string)=>{
  while(inFlight.current){await inFlight.current;if(!force)return}
  if(!alive.current||denied.current)return;
  const version=epoch.current;
  const task=(async()=>{try{
   let more=true;
   while(more&&alive.current&&epoch.current===version){
    const previous=feed.current;const after=!before&&previous?.messages.length?previous.messages.reduce((m,v)=>BigInt(v.id)>BigInt(m)?v.id:m,'0'):undefined;
    controller.current=new AbortController();const signal=controller.current.signal;
    const result=await api<Feed>(`/${role}/tickets/${id}/conversation${before?'?before='+before:after?'?after='+after:''}`,{signal});
    if(!alive.current||epoch.current!==version||signal.aborted)return;
    const messages=new Map((previous?.messages||[]).map(m=>[m.id,m]));for(const message of result.messages)messages.set(message.id,message);
    const merged={...result,messages:[...messages.values()].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1),has_older:before||!previous?result.has_older:previous.has_older};
    feed.current=merged;setData(merged);setError('');
    if(previous&&['status','assigned_id','assigned_to','group_id','can_send'].some(k=>previous[k as keyof Feed]!==result[k as keyof Feed]))void notify.current?.();
    more=!before&&result.has_more;
   }
  }catch(e){if(!alive.current||epoch.current!==version||controller.current?.signal.aborted)return;setError((e as Error).message);if(e instanceof ApiError&&[401,403,404].includes(e.status)){denied.current=true;feed.current=null;setData(null);void notify.current?.()}}
  finally{if(alive.current&&epoch.current===version)setLoading(false)}})();
  inFlight.current=task;try{await task}finally{if(inFlight.current===task)inFlight.current=null}
 },[role,id]);
 useEffect(()=>{
  alive.current=true;epoch.current++;denied.current=false;feed.current=null;setData(null);setLoading(true);setError('');let timer:ReturnType<typeof setTimeout>|undefined;let running=true;
  const schedule=()=>{clearTimeout(timer);if(running&&!denied.current&&document.visibilityState==='visible'&&navigator.onLine&&active(feed.current))timer=setTimeout(()=>void tick(),5000)};
  async function tick(force=false){if(!running||document.visibilityState!=='visible'||!navigator.onLine)return;await refresh(force);schedule()}
  function visibility(){clearTimeout(timer);if(document.visibilityState==='visible'&&navigator.onLine)void tick(true);else controller.current?.abort()}
  void tick(true);document.addEventListener('visibilitychange',visibility);window.addEventListener('online',visibility);window.addEventListener('offline',visibility);
  return()=>{running=false;alive.current=false;epoch.current++;clearTimeout(timer);controller.current?.abort();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('online',visibility);window.removeEventListener('offline',visibility)};
 },[refresh]);
 return {data,error,loading,refresh};
}
