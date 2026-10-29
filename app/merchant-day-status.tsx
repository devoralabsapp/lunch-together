'use client';
import {useEffect,useState} from 'react';
import {doc,onSnapshot} from 'firebase/firestore';
import {ChefHat} from 'lucide-react';
import type {MealClient} from '../lib/meal-client';
import type {Day,Order} from '../lib/types';
import {merchantOrderHash} from '../lib/merchant-status';
import {useI18n} from '../components/i18n-provider';
import MerchantProgress,{merchantStages as stages} from './merchant-progress';
export default function MerchantDayStatus({client,day,dayId,userId,orders}:{client:MealClient;day:Day;dayId:string;userId:string;orders:Order[]}){
 const {t}=useI18n(),[value,setValue]=useState<{name:string;state:string;note:string;hash:string;dispatchId:string}|null>(null),[phase,setPhase]=useState({status:day.changing?'changing':day.status,dispatchId:day.dispatchId}),[currentHash,setCurrentHash]=useState('');
 useEffect(()=>{let active=true;void merchantOrderHash(orders).then(hash=>{if(active)setCurrentHash(hash);});return()=>{active=false;};},[orders]);
 useEffect(()=>{setValue(null);setPhase({status:day.changing?'changing':day.status,dispatchId:day.dispatchId});if(!userId)return;let merchantStop=()=>{},statusStop=()=>{};let name='',state='',note='',hash='',dispatchId='';
  const update=()=>setValue(name?{name,state,note,hash,dispatchId}:null);
  const parentStop=onSnapshot(doc(client.db,'days',dayId),s=>setPhase({status:s.data()?.changing===true?'changing':s.data()?.status||'',dispatchId:s.data()?.dispatchId}),()=>setPhase({status:'',dispatchId:''}));
  const stop=onSnapshot(doc(client.db,'merchantDays',dayId),s=>{
   merchantStop();statusStop();name='';state='';note='';hash='';dispatchId='';update();const id=s.data()?.merchantId;
   if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))return;
   merchantStop=onSnapshot(doc(client.db,'merchants',id),m=>{name=m.data()?.name||'';update();},()=>setValue(null));
   statusStop=onSnapshot(doc(client.db,'merchantFulfillments',dayId),f=>{state=f.data()?.state||'';note=f.data()?.note||'';hash=f.data()?.orderHash||'';dispatchId=f.data()?.dispatchId||'';update();},()=>setValue(null));
  },()=>setValue(null));
  return()=>{stop();parentStop();merchantStop();statusStop();};
 },[client,dayId,userId]);
 if(!value)return null;
 const dispatched=phase.status==='closed'&&!!phase.dispatchId,current=dispatched&&phase.dispatchId===value.dispatchId,changed=current&&value.hash&&currentHash&&value.hash!==currentHash;
 const index=current?stages.findIndex(([state])=>state===value.state):-1;
 const label=phase.status==='changing'?'Ngày đang đổi nhà hàng, tạm dừng đặt cơm.':!dispatched?'Chờ quản trị chốt đơn gửi nhà hàng':changed?'Đơn đã cập nhật, chờ nhà hàng xác nhận lại':stages[index]?.[1]||'Chờ nhà hàng nhận đơn';
 return <section className="merchant-day-status" role="status"><ChefHat size={21}/><div><strong className="merchant-restaurant-name">{value.name}</strong><span className="merchant-status-title">{t(label)}</span>{dispatched?<MerchantProgress index={changed?-1:index}/>:null}{current&&value.note?<small>{value.note}</small>:null}</div></section>;
}
