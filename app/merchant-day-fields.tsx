'use client';
import {useEffect,useState} from 'react';
import {useI18n} from '../components/i18n-provider';
import type {MealClient} from '../lib/meal-client';
import {mealRestaurants,restaurantDayMenu,type MealRestaurant} from '../lib/merchant-day-client';
import type {MenuItem} from '../lib/types';
import {friendlyFirebaseError} from '../lib/firebase-client';
export default function MerchantDayFields({client,date,value,onChange}:{client:MealClient;date:string;value:string;onChange:(id:string)=>void}){
 const {t,money}=useI18n(),[stores,setStores]=useState<MealRestaurant[]>([]),[menu,setMenu]=useState<MenuItem[]>([]),[storesLoading,setStoresLoading]=useState(true),[menuLoading,setMenuLoading]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;void mealRestaurants(client).then(list=>{if(active)setStores(list);}).catch(e=>{if(active)setError(friendlyFirebaseError(e));}).finally(()=>{if(active)setStoresLoading(false);});return()=>{active=false;};},[client]);
 useEffect(()=>{let active=true;setMenu([]);setError('');if(!value||!date){setMenuLoading(false);return;}setMenuLoading(true);void restaurantDayMenu(client,value,date).then(result=>{if(active)setMenu(result.menu);}).catch(e=>{if(active)setError(friendlyFirebaseError(e));}).finally(()=>{if(active)setMenuLoading(false);});return()=>{active=false;};},[client,date,value]);
 return <div className="merchant-day-fields"><label htmlFor="new-merchant">{t('Nhà hàng liên kết')}</label><select id="new-merchant" required value={value} onChange={e=>onChange(e.target.value)}><option value="">{t('Chọn nhà hàng')}</option>{stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><p className="input-hint">{t('Dùng thực đơn đã đăng gần nhất có hiệu lực vào ngày đã chọn. Đổi nhà hàng cần xác nhận trong màn sửa ngày.')}</p>{storesLoading||menuLoading?<p role="status">{t('Đang tải thực đơn nhà hàng…')}</p>:null}{error?<p className="error-banner" role="alert">{t(error)}</p>:null}{!storesLoading&&!stores.length?<p>{t('Chưa có nhà hàng đang hoạt động.')}</p>:null}{menu.length?<div className="merchant-menu-preview"><strong>{t('Thực đơn từ nhà hàng')}</strong><ul>{menu.map(m=><li key={m.name}><span>{m.name}</span><strong>{money(m.price)}</strong></li>)}</ul></div>:null}</div>;
}
