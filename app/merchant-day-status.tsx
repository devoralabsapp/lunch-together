'use client';
import {useEffect,useState} from 'react';
import {doc,onSnapshot} from 'firebase/firestore';
import {ChefHat} from 'lucide-react';
import type {MealClient} from '../lib/meal-client';
import type {Order} from '../lib/types';
import {merchantOrderHash} from '../lib/merchant-status';
import {useI18n} from '../components/i18n-provider';
const labels:Record<string,string>={accepted:'Nhà hàng đã nhận đơn',cooking:'Nhà hàng đang chuẩn bị',ready:'Cơm đã sẵn sàng',delivering:'Nhà hàng đang giao cơm',completed:'Nhà hàng đã giao xong'};
export default function MerchantDayStatus({client,dayId,userId,orders}:{client:MealClient;dayId:string;userId:string;orders:Order[]}){
 const {t}=useI18n(),[value,setValue]=useState<{name:string;state:string;note:string;hash:string}|null>(null),[currentHash,setCurrentHash]=useState('');
 useEffect(()=>{let active=true;void merchantOrderHash(orders).then(hash=>{if(active)setCurrentHash(hash);});return()=>{active=false;};},[orders]);
 useEffect(()=>{setValue(null);if(!userId)return;let merchantStop=()=>{},statusStop=()=>{};let name='',state='',note='',hash='';
  const update=()=>setValue(name?{name,state,note,hash}:null);
  const stop=onSnapshot(doc(client.db,'merchantDays',dayId),s=>{
   merchantStop();statusStop();name='';state='';note='';hash='';update();const id=s.data()?.merchantId;
   if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))return;
   merchantStop=onSnapshot(doc(client.db,'merchants',id),m=>{name=m.data()?.name||'';update();},()=>setValue(null));
   statusStop=onSnapshot(doc(client.db,'merchantFulfillments',dayId),f=>{state=f.data()?.state||'';note=f.data()?.note||'';hash=f.data()?.orderHash||'';update();},()=>setValue(null));
  },()=>setValue(null));
  return()=>{stop();merchantStop();statusStop();};
 },[client,dayId,userId]);
 if(!value)return null;
 const changed=value.hash&&currentHash&&value.hash!==currentHash;
 return <div className="merchant-day-status" role="status"><ChefHat size={21}/><div><strong>{value.name}</strong><span>{t(changed?'Đơn đã cập nhật, chờ nhà hàng xác nhận lại':labels[value.state]||'Nhà hàng chưa xác nhận danh sách')}</span>{value.note?<small>{value.note}</small>:null}</div></div>;
}
