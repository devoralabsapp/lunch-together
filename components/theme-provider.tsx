'use client';
import {createContext,useCallback,useContext,useEffect,useMemo,useState} from 'react';
import {Palette} from 'lucide-react';
import {useI18n} from './i18n-provider';
import {parseTheme,THEME_COOKIE,themes,type Theme} from '../lib/theme';
const Context=createContext<{theme:Theme;setTheme:(theme:Theme)=>void}|null>(null);
export function ThemeProvider({initialTheme='classic',children}:{initialTheme?:Theme;children:React.ReactNode}){
 const [theme,setSelected]=useState<Theme>(initialTheme);
 const setTheme=useCallback((next:Theme)=>{const value=parseTheme(next);setSelected(value);document.documentElement.dataset.theme=value;try{document.cookie=`${THEME_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;}catch{/* Selection still works in this page when cookies are blocked. */}},[]);
 useEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);
 const value=useMemo(()=>({theme,setTheme}),[theme,setTheme]);return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function ThemeSwitcher(){
 const context=useContext(Context),{t}=useI18n();if(!context)throw new Error('ThemeProvider is required.');const {theme,setTheme}=context;
 return <label className="theme-switcher" title={t('Giao diện: {0}',{'0':t(themes.find(item=>item.id===theme)!.label)})}><Palette size={17} aria-hidden="true"/><span className="sr-only">{t('Chọn giao diện')}</span><select aria-label={t('Chọn giao diện')} value={theme} onChange={e=>setTheme(parseTheme(e.target.value))}>{themes.map(item=><option key={item.id} value={item.id}>{t(item.label)}</option>)}</select></label>;
}
