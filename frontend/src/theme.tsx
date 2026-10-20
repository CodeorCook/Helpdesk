import { createContext,useContext,useLayoutEffect,useState,type ReactNode } from 'react';
type Mode='light'|'dark'|'system';
const key='helpdesk-theme';
function stored():Mode{try{const v=localStorage.getItem(key);return v==='light'||v==='dark'?v:'system'}catch{return 'system'}}
const ThemeContext=createContext<{mode:Mode;choose:(mode:Mode)=>void}>({mode:'system',choose:()=>{}});
export function ThemeProvider({children}:{children:ReactNode}){
 const [mode,setMode]=useState<Mode>(stored);
 useLayoutEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)');const apply=()=>{document.documentElement.dataset.theme=mode==='system'?(media.matches?'dark':'light'):mode};apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply)},[mode]);
 useLayoutEffect(()=>{const sync=(e:StorageEvent)=>{if(e.key===key||e.key===null)setMode(stored())};window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync)},[]);
 function choose(value:Mode){setMode(value);try{localStorage.setItem(key,value)}catch{/* Preference still works for this tab when storage is unavailable. */}}
 return <ThemeContext.Provider value={{mode,choose}}>{children}</ThemeContext.Provider>;
}
export function ThemeSwitcher(){const {mode,choose}=useContext(ThemeContext);return <label className="theme-switcher"><span>Giao diện</span><select aria-label="Giao diện" value={mode} onChange={e=>choose(e.target.value as Mode)}><option value="light">Sáng</option><option value="dark">Tối</option><option value="system">Theo hệ thống</option></select></label>}
