import {collection,doc,getDoc,getDocFromServer,getDocsFromServer,query,where,runTransaction,serverTimestamp,deleteField,type DocumentData} from 'firebase/firestore';
import type {MealClient} from './meal-client';import {ensureUser} from './firebase-client';
import {nameId,validateMenu} from './meal-client-model';import {restaurantDayMenu} from './merchant-day-client';
import {orderFinance,moneyFields} from './order-finance';import {chooseSurplus} from './credit-client';import {invalidateLinkedGroup} from './payment-group-client';
import {appendActivity,orderAudit} from './activity';import type {MenuItem} from './types';
export const dayRevision=(value:unknown)=>(value as {toDate?:()=>Date}|null)?.toDate?.().toISOString()||'';
async function adminActor(client:MealClient){const u=await ensureUser(client.auth);if(!await client.isAdmin())throw Error('Chỉ quản trị được đổi nhà hàng cho ngày đặt cơm.');return u;}
export async function readMealDayEditor(client:MealClient,dayId:string){
 await adminActor(client);const [workspace,day,binding]=await Promise.all([client.read(dayId),getDoc(doc(client.db,'days',dayId)),getDoc(doc(client.db,'merchantDays',dayId))]);
 const merchantId=String(binding.data()?.merchantId||''),merchant=merchantId?await getDoc(doc(client.db,'merchants',merchantId)):null;
 return {workspace,merchantId,merchantName:String(merchant?.data()?.name||''),revision:dayRevision(day.data()?.updatedAt),jobId:day.data()?.changing===true?String(day.data()?.changeId):''};
}
export async function beginMealDayChange(client:MealClient,input:{dayId:string;merchantId:string;menu?:MenuItem[];expectedRevision:string}){
 const user=await adminActor(client),{db}=client,{dayId,merchantId}=input;
 if(!/^[\w-]{1,100}$/.test(dayId)||merchantId&&!/^[-\w]{1,128}$/.test(merchantId))throw Error('Ngày hoặc nhà hàng chưa hợp lệ.');
 const initial=await getDocFromServer(doc(db,'days',dayId));if(!initial.exists())throw Error('Cần lưu ngày trên web trước khi đổi nhà hàng.');
 if(initial.data().changing===true)return String(initial.data().changeId);
 const source=merchantId?await restaurantDayMenu(client,merchantId,initial.data().date):null,menu=source?.menu||validateMenu(input.menu),id=crypto.randomUUID().replaceAll('-','');
 await runTransaction(db,async tx=>{
  const ref=doc(db,'days',dayId),jobRef=doc(db,'mealDayChanges',id),[day,binding,empty,target,header,...dishes]=await Promise.all([tx.get(ref),tx.get(doc(db,'merchantDays',dayId)),tx.get(jobRef),...(merchantId?[tx.get(doc(db,'merchants',merchantId))]:[Promise.resolve(null)]),...(source?[tx.get(doc(db,source.menuPath)),...source.source.map(d=>tx.get(d.ref))]:[Promise.resolve(null)])]);
  if(!day.exists()||day.data().changing===true||dayRevision(day.data().updatedAt)!==input.expectedRevision||empty.exists())throw Error('Ngày vừa thay đổi. Vui lòng tải lại trước khi đổi nhà hàng.');
  const previous=String(binding.data()?.merchantId||'');if(previous===merchantId)throw Error('Nhà hàng không thay đổi. Hãy lưu thực đơn bình thường.');
  if(merchantId&&(target?.data()?.active!==true||target.data()?.archived===true))throw Error('Nhà hàng đang ngừng hoạt động. Vui lòng chọn nhà hàng khác.');
  if(source&&(!header?.data()?.updatedAt?.isEqual(source.revision)||dishes.some((d,i)=>!d?.exists()||d.data().active!==true||d.data().name!==menu[i].name||d.data().price!==menu[i].price)))throw Error('Thực đơn nhà hàng vừa thay đổi. Vui lòng tải lại.');
  tx.set(jobRef,{dayId,date:day.data().date,fromMerchantId:previous,toMerchantId:merchantId,menuJson:JSON.stringify(menu),menuCount:menu.length,phase:'cancelling',createdAt:serverTimestamp(),createdBy:user.uid,updatedAt:serverTimestamp(),completedAt:null});
  tx.update(ref,{changing:true,changeId:id,updatedAt:serverTimestamp()});
  appendActivity(tx,db,user.uid,{kind:'menu.save',summary:'Bắt đầu đổi nhà hàng',dayId,details:{changeId:id,fromMerchantId:previous,toMerchantId:merchantId}});
 });return id;
}
export async function resumeMealDayChange(client:MealClient,id:string,onProgress?:(done:number,total:number)=>void){
 const user=await adminActor(client),{db}=client;if(!/^[a-f0-9]{32}$/.test(id))throw Error('Lần đổi nhà hàng chưa hợp lệ.');
 const jobRef=doc(db,'mealDayChanges',id),job=await getDocFromServer(jobRef);if(!job.exists())throw Error('Không tìm thấy lần đổi nhà hàng.');const data=job.data(),dayId=String(data.dayId),dayRef=doc(db,'days',dayId);
 if(data.phase==='completed')return client.read(dayId);
 const [list,pending]=await Promise.all([getDocsFromServer(collection(dayRef,'orders')),getDocsFromServer(collection(jobRef,'pendingOrders'))]);
 const pendingIds=new Set(pending.docs.map(d=>d.id)),active=list.docs.filter(d=>!d.data().cancelled||pendingIds.has(d.id));let done=0;onProgress?.(done,active.length);
 for(const row of active){
  const pendingRef=doc(jobRef,'pendingOrders',row.id),receiptRef=doc(jobRef,'cancelledOrders',row.id);
  await runTransaction(db,async tx=>{
   const [day,current,order,receipt,started]=await Promise.all([tx.get(dayRef),tx.get(jobRef),tx.get(row.ref),tx.get(receiptRef),tx.get(pendingRef)]);
   if(current.data()?.phase==='completed'||receipt.exists())return;
   if(current.data()?.phase!=='cancelling'||day.data()?.changing!==true||day.data()?.changeId!==id)throw Error('Ngày không còn thuộc lần đổi nhà hàng này.');
   if(order.exists()&&!order.data().cancelled&&!started.exists())tx.set(pendingRef,{ownerId:order.data().ownerId,createdAt:serverTimestamp(),createdBy:user.uid});
  });
  const started=await getDoc(pendingRef),finished=await getDoc(receiptRef);if(!started.exists()||finished.exists()){onProgress?.(++done,active.length);continue;}
  await runTransaction(db,async tx=>{
   const [day,current,order]=await Promise.all([tx.get(dayRef),tx.get(jobRef),tx.get(row.ref)]);if(current.data()?.phase==='completed')return;
   if(current.data()?.phase!=='cancelling'||day.data()?.changing!==true||day.data()?.changeId!==id)throw Error('Ngày không còn thuộc lần đổi nhà hàng này.');
   const old=order.data();if(!old||old.cancelled)return;const invalidate=await invalidateLinkedGroup(client,tx,dayId,row.id),money=moneyFields(old as never);
   invalidate();tx.update(row.ref,{...money,cancelled:true,paid:false,updatedAt:serverTimestamp()});
   appendActivity(tx,db,user.uid,{kind:'order.cancel',summary:'Hủy món do đổi nhà hàng',dayId,orderId:row.id,details:{changeId:id,before:orderAudit(old),after:orderAudit({...old,...money,cancelled:true,paid:false})}});
  });
  const canceled=await getDocFromServer(row.ref);if(canceled.exists()&&orderFinance(canceled.data() as never).surplus>0)await chooseSurplus(client,{dayId,orderId:row.id},'carry');
  await runTransaction(db,async tx=>{
   const [current,order,receipt,day]=await Promise.all([tx.get(jobRef),tx.get(row.ref),tx.get(receiptRef),tx.get(dayRef)]);if(receipt.exists()||current.data()?.phase==='completed')return;
   const o=order.data(),finance=o?orderFinance(o as never):null;if(day.data()?.changing!==true||day.data()?.changeId!==id||!o?.cancelled||!finance||finance.held>0&&finance.surplusChoice!=='carry')throw Error('Còn món chưa hủy. Bấm tiếp tục đổi nhà hàng để hoàn tất.');
   tx.set(receiptRef,{ownerId:o.ownerId,name:o.name,dish:o.dish,quantity:o.quantity,price:o.price,note:o.note,...moneyFields(o as never),creditAmount:finance.held,createdAt:serverTimestamp(),createdBy:user.uid});
  });onProgress?.(++done,active.length);
 }
 const checked=await getDocsFromServer(collection(dayRef,'orders'));if(checked.docs.some(d=>!d.data().cancelled))throw Error('Còn món chưa hủy. Bấm tiếp tục đổi nhà hàng để hoàn tất.');
 const menu=validateMenu(JSON.parse(String(data.menuJson))),ids=await Promise.all(menu.map(m=>nameId(m.name))),oldMenu=await getDocsFromServer(query(collection(dayRef,'dishes'),where('active','==',true))),bindingRef=doc(db,'merchantDays',dayId);
 await runTransaction(db,async tx=>{
  const fulfillmentRef=doc(db,'merchantFulfillments',dayId);
  const [day,current,binding,target,fulfillment,...orders]=await Promise.all([tx.get(dayRef),tx.get(jobRef),tx.get(bindingRef),data.toMerchantId?tx.get(doc(db,'merchants',data.toMerchantId)):Promise.resolve(null),tx.get(fulfillmentRef),...checked.docs.map(o=>tx.get(o.ref))]);
  if(current.data()?.phase==='completed')return;
  if(day.data()?.changing!==true||day.data()?.changeId!==id||current.data()?.phase!=='cancelling'||String(binding.data()?.merchantId||'')!==data.fromMerchantId||orders.some(o=>o.exists()&&!o.data().cancelled))throw Error('Ngày vừa thay đổi. Bấm tiếp tục đổi nhà hàng để kiểm tra lại.');
  if(data.toMerchantId&&(target?.data()?.active!==true||target.data()?.archived===true))throw Error('Nhà hàng đang ngừng hoạt động. Khôi phục nhà hàng trước khi tiếp tục.');
  if(fulfillment.exists()){tx.set(doc(jobRef,'fulfillmentArchive','previous'),fulfillment.data());tx.delete(fulfillmentRef);}
  tx.update(dayRef,{status:'open',menuCount:menu.length,changing:false,closedAt:deleteField(),dispatchId:deleteField(),updatedAt:serverTimestamp()});
  for(const d of oldMenu.docs)if(!ids.includes(d.id))tx.update(d.ref,{active:false,updatedAt:serverTimestamp()});
  menu.forEach((m,i)=>tx.set(doc(dayRef,'dishes',ids[i]),{...m,active:true,updatedAt:serverTimestamp()}));
  if(data.toMerchantId){if(binding.exists())tx.update(bindingRef,{merchantId:data.toMerchantId});else tx.set(bindingRef,{merchantId:data.toMerchantId,date:data.date,createdAt:serverTimestamp(),createdBy:user.uid});}else if(binding.exists())tx.delete(bindingRef);
  tx.update(jobRef,{phase:'completed',updatedAt:serverTimestamp(),completedAt:serverTimestamp()});
  appendActivity(tx,db,user.uid,{kind:'menu.save',summary:'Hoàn tất đổi nhà hàng và mở lại ngày đặt cơm',dayId,details:{changeId:id,fromMerchantId:data.fromMerchantId,toMerchantId:data.toMerchantId,menu}});
 });return client.read(dayId);
}
