import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, signIn, signOut, type Session, type User } from './api';
type Auth = { user: User | null; loading: boolean; error: string; refresh: (silent?:boolean) => Promise<void>; login: (email:string,password:string) => Promise<User>; logout: () => Promise<void> };
const Context = createContext<Auth | null>(null);
export function AuthProvider({children}: {children: ReactNode}) {
  const [user,setUser] = useState<User | null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  async function refresh(silent=false) {
    if(!silent) setLoading(true); setError('');
    try { setUser((await api<Session>('/auth/me')).user); }
    catch(e) { setUser(null); if (!(e instanceof ApiError && e.status === 401)) setError((e as Error).message); }
    finally { if(!silent) setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  async function login(email:string,password:string) { const next=await signIn(email,password); setUser(next); setError(''); return next; }
  async function logout() {
    try { await signOut(); } catch(e) { if (!(e instanceof ApiError && e.status === 401)) throw e; }
    setUser(null);
  }
  return <Context.Provider value={{user,loading,error,refresh,login,logout}}>{children}</Context.Provider>;
}
export function useAuth() { const context=useContext(Context); if(!context) throw new Error('AuthProvider required'); return context; }
