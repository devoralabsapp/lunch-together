import {serverTimestamp} from 'firebase/firestore';

export const REOPEN_WINDOW_MS=15*60*1000;
type Config={status?:string;closedAt?:unknown;cutoffAt?:unknown;dispatchId?:string};
export function timestampMillis(value:unknown):number{
 if(typeof value==='string')return Date.parse(value);
 if(value&&typeof (value as {toMillis?:unknown}).toMillis==='function')return (value as {toMillis:()=>number}).toMillis();
 return NaN;
}
export function canReopenDay(day:Config,now=Date.now()){
 const anchor=timestampMillis(day.closedAt??day.cutoffAt);
 return day.status==='closed'&&Number.isFinite(anchor)&&now<=anchor+REOPEN_WINDOW_MS;
}
// First close anchors the deadline. Each subsequent dispatch has a fresh identity.
export function dayClosureFields(previous:Config|undefined,status:string,now=Date.now()){
 const old=previous||{};
 if(old.status==='closed'&&status!=='closed'&&!canReopenDay(old,now))throw Error('Đã quá 15 phút từ lần chốt đầu tiên, không thể mở lại đơn.');
 if(status==='closed'&&(old.status!=='closed'||!old.dispatchId||!old.closedAt))return {closedAt:old.closedAt||(old.status==='closed'?old.cutoffAt:serverTimestamp()),dispatchId:crypto.randomUUID().replaceAll('-','')};
 return old.closedAt&&old.dispatchId?{closedAt:old.closedAt,dispatchId:old.dispatchId}:{};
}
