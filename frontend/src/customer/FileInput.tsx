import { useEffect, useRef, useState } from 'react';
import { Button } from '../components';
export function FileInput({label,id,name='file',accept,required=false}:{label:string;id:string;name?:string;accept?:string;required?:boolean}){
 const input=useRef<HTMLInputElement>(null);const [filename,setFilename]=useState('');
 useEffect(()=>{const form=input.current?.form;const reset=()=>setFilename('');form?.addEventListener('reset',reset);return()=>form?.removeEventListener('reset',reset);},[]);
 return <div className="field"><label htmlFor={id}>{label}</label><div className="file-picker"><input className="visually-hidden-file" aria-label={label} ref={input} id={id} name={name} type="file" required={required} accept={accept} onChange={e=>setFilename(e.target.files?.[0]?.name||'')}/><Button type="button" className="secondary" onClick={()=>input.current?.click()}>Chọn tệp</Button><span>{filename||'Chưa chọn tệp'}</span></div></div>;
}
