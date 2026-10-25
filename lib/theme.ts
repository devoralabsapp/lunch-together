export const THEME_COOKIE='lunch-together-theme-v1';
export const themes=[
 {id:'classic',label:'Mặc định'},
 {id:'terminal',label:'Command Line'},
 {id:'code',label:'Visual Studio Code'},
 {id:'excel',label:'Excel'},
 {id:'midnight',label:'Midnight'},
] as const;
export type Theme=typeof themes[number]['id'];
export function parseTheme(value:unknown):Theme{return themes.find(theme=>theme.id===value)?.id||'classic';}
