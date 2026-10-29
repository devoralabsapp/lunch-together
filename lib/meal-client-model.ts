import type {Day,MenuItem,Workspace} from './types';

export function localNow(now=new Date()){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 return {date:`${p.year}-${p.month}-${p.day}`,minutes:Number(p.hour)*60+Number(p.minute)};
}
export function isLocked(day:Day){if(day.changing||day.status==='closed')return true;if(day.status==='open')return false;const now=localNow();return day.date<now.date||(day.date===now.date&&now.minutes>=570);}
export function cleanName(value:unknown){return String(value||'').normalize('NFC').trim();}
export async function nameId(name:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(name.toLowerCase()));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export const validOrderId=(id:string)=>/^[a-f0-9]{64}(?:_(?:[1-9]|[12][0-9]|30))?$/.test(id);
export function validateMenu(value:unknown):MenuItem[]{
 if(!Array.isArray(value)||!value.length||value.length>60)throw new Error('Cần từ 1 đến 60 món.');
 const menu=value.map(m=>({name:cleanName(m?.name),price:Number(m?.price)}));
 if(menu.some(m=>!m.name||m.name.length>160||!Number.isInteger(m.price)||m.price<1000||m.price>1000000)||new Set(menu.map(m=>m.name.toLowerCase())).size!==menu.length)throw new Error('Tên món phải khác nhau; giá từ 1.000 đến 1.000.000đ.');
 return menu;
}
export function validDate(date:string){return /^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;}
export function mealDays(days:Day[],now=new Date()){
 const date=localNow(now).date;
 const list=[...days];
 if(!list.some(d=>d.date===date&&!d.label.startsWith('pre-order')))list.push({id:'day-'+date,date,label:`${Number(date.slice(8))}/${Number(date.slice(5,7))}`,menu:[],menuCount:0,source:false,status:'auto'});
 return list.sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
}
export function selectMealDay(days:Day[],dayId?:string,now=new Date()){
 const today=days.filter(d=>d.date===localNow(now).date&&!d.label.startsWith('pre-order'));
 return days.find(d=>d.id===dayId)||today.find(d=>!d.source)||today[0]!;
}
export function publicWorkspace(source:{days:Day[];importedAt:string;demo?:boolean},now=new Date()):Workspace{
 // Project fields explicitly: source files may also contain private orders/members.
 const days=mealDays(source.days.map(d=>({id:d.id,date:d.date,label:d.label,menu:d.menu.map(m=>({name:m.name,price:m.price})),source:d.source,status:d.status,menuCount:d.menu.length})),now);
 const day=selectMealDay(days,undefined,now);
 return {days,day,orders:[],members:[],admin:false,userId:'',locked:isLocked(day),importedAt:source.importedAt,sourceCount:source.days.length,sourceUrl:'',paymentAvailable:false,demo:source.demo===true,signedIn:false,displayName:'Khách',storageReady:false};
}
