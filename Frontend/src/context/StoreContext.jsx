import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';
const StoreContext=createContext(null);
export function StoreProvider({children}) {
  const [store,setStore]=useState(null),[error,setError]=useState('');
  useEffect(()=>{const c=new AbortController();api('/api/store',{signal:c.signal}).then(setStore).catch(e=>{if(e.name!=='AbortError')setError('No pudimos conectar con la tienda. Intenta recargar la página.');});return()=>c.abort();},[]);
  return <StoreContext.Provider value={{store,error}}>{children}</StoreContext.Provider>;
}
export const useStore=()=>useContext(StoreContext);
