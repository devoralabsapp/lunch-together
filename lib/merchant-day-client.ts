import {collection,doc,getDoc,getDocs,query,where,runTransaction,serverTimestamp,Timestamp} from 'firebase/firestore';
import type {MealClient} from './meal-client';
import {ensureUser} from './firebase-client';
import {nameId,validDate,validateMenu} from './meal-client-model';
import {appendActivity} from './activity';
export type MealRestaurant={id:string;name:string};
export async function mealRestaurants(client:MealClient):Promise<MealRestaurant[]>{
 if(!await client.isAdmin())throw Error('Chỉ quản trị được liên kết nhà hàng.');
 const s=await getDocs(collection(client.db,'merchants'));return s.docs.filter(d=>d.data().active===true&&d.data().archived!==true).map(d=>({id:d.id,name:String(d.data().name)})).sort((a,b)=>a.name.localeCompare(b.name,'vi'));
}
export async function restaurantDayMenu(client:MealClient,merchantId:string,date:string){
 if(!validDate(date)||!/^[-\w]{1,128}$/.test(merchantId))throw Error('Ngày hoặc nhà hàng chưa hợp lệ.');
 let ref=doc(client.db,'merchants',merchantId,'offers',date),header=await getDoc(ref);
 if(!header.exists()){ref=doc(client.db,'merchants',merchantId,'menus',date);header=await getDoc(ref);}
 if(!header.exists())throw Error('Nhà hàng chưa có thực đơn cơ sở cho ngày này.');
 const dishes=await getDocs(query(collection(ref,'dishes'),where('active','==',true)));
 if(!dishes.size)throw Error('Nhà hàng chưa có thực đơn cơ sở cho ngày này.');
 const menu=validateMenu(dishes.docs.map(d=>d.data()));
 return {menu,revision:header.data().updatedAt,source:dishes.docs,menuPath:ref.path};
}
export async function createRestaurantDay(client:MealClient,input:{date:string;merchantId:string;status:string}){
 if(!await client.isAdmin())throw Error('Chỉ quản trị được liên kết nhà hàng.');
 const {date,merchantId,status}=input;if(!validDate(date)||!['auto','open','closed'].includes(status))throw Error('Ngày hoặc trạng thái không hợp lệ.');
 const user=await ensureUser(client.auth),value=await restaurantDayMenu(client,merchantId,date),ids=await Promise.all(value.menu.map(m=>nameId(m.name))),db=client.db,dayId='day-'+date;
 await runTransaction(db,async tx=>{
  const [day,binding,merchant,header,...dishes]=await Promise.all([tx.get(doc(db,'days',dayId)),tx.get(doc(db,'merchantDays',dayId)),tx.get(doc(db,'merchants',merchantId)),tx.get(doc(db,value.menuPath)),...value.source.map(d=>tx.get(d.ref))]);
  if(day.exists()||binding.exists())throw Error('Ngày này đã có thực đơn hoặc đã liên kết nhà hàng.');
  if(merchant.data()?.active!==true||merchant.data()?.archived===true)throw Error('Nhà hàng đang ngừng hoạt động. Vui lòng chọn nhà hàng khác.');
  if(!header.exists()||!header.data().updatedAt?.isEqual(value.revision)||dishes.some((d,i)=>!d.exists()||d.data().active!==true||d.data().name!==value.menu[i].name||d.data().price!==value.menu[i].price))throw Error('Thực đơn nhà hàng vừa thay đổi. Vui lòng tải lại.');
  tx.set(doc(db,'days',dayId),{date,label:Number(date.slice(8))+'/'+Number(date.slice(5,7)),status,menuCount:value.menu.length,cutoffAt:Timestamp.fromDate(new Date(date+'T09:30:00+07:00')),updatedAt:serverTimestamp()});
  value.menu.forEach((m,i)=>tx.set(doc(db,'days',dayId,'dishes',ids[i]),{...m,active:true,updatedAt:serverTimestamp()}));
  tx.set(doc(db,'merchantDays',dayId),{merchantId,date,createdAt:serverTimestamp(),createdBy:user.uid});
  tx.set(doc(db,'merchants',merchantId,'events',crypto.randomUUID().replaceAll('-','')),{kind:'day.bind',message:'Liên kết ngày '+date,dayId,actorId:user.uid,createdAt:serverTimestamp()});
  appendActivity(tx,db,user.uid,{kind:'menu.save',summary:'Tạo ngày từ thực đơn nhà hàng',dayId,details:{date,status,merchantId,menu:value.menu}});
 });
}
