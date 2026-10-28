import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,query,where,orderBy,limit,updateDoc,serverTimestamp,Timestamp,writeBatch,type Firestore} from 'firebase/firestore';
import {nameId} from '../lib/meal-client-model';

test('merchant roles share menus and orders while preserving financial and tenant boundaries',{timeout:120000},async t=>{
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST!.split(':');
 const env=await initializeTestEnvironment({projectId:'demo-merchant-rules',firestore:{host,port:Number(port),rules:fs.readFileSync('firestore.rules','utf8')}});
 const google=(uid:string)=>env.authenticatedContext(uid,{email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore() as unknown as Firestore;
 const admin=google('merchant-admin'),manager=google('merchant-manager'),owner=google('merchant-owner'),kitchen=google('merchant-kitchen'),foreign=google('foreign-manager'),customer=env.authenticatedContext('sample-customer').firestore() as unknown as Firestore;
 const dayId='day-2099-01-01',merchantId='sample-restaurant-a',now=()=>serverTimestamp(),uid=(db:Firestore)=>db===admin?'merchant-admin':db===manager?'merchant-manager':db===owner?'merchant-owner':db===kitchen?'merchant-kitchen':'foreign-manager';
 await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore() as unknown as Firestore,'admins','merchant-admin'),{enabled:true});});
 const merchant=(name:string)=>({name,phone:'',address:'',active:true,createdAt:now(),createdBy:'merchant-admin',updatedAt:now(),updatedBy:'merchant-admin'});
 const member=(id:string,role:string)=>({merchantId:id,role,enabled:true,createdAt:now(),updatedAt:now(),updatedBy:'merchant-admin'});
 try{
 await t.test('only customer admins provision restaurants and immutable day bindings',async()=>{
  await assertFails(setDoc(doc(foreign,'merchants',merchantId),merchant('Sample')));
  await assertSucceeds(setDoc(doc(admin,'merchants',merchantId),merchant('Sample A')));
  await setDoc(doc(admin,'merchants','sample-restaurant-b'),merchant('Sample B'));
  for(const [id,role,restaurant] of [['merchant-manager','manager',merchantId],['merchant-owner','owner',merchantId],['merchant-kitchen','kitchen',merchantId],['foreign-manager','manager','sample-restaurant-b']])await setDoc(doc(admin,'merchantUsers',id),member(restaurant,role));
  const binding={merchantId,date:'2099-01-01',createdAt:now(),createdBy:'merchant-admin'};
  await assertFails(setDoc(doc(manager,'merchantDays',dayId),{...binding,createdBy:uid(manager)}));
  await assertSucceeds(setDoc(doc(admin,'merchantDays',dayId),binding));
  await assertFails(updateDoc(doc(admin,'merchantDays',dayId),{merchantId:'sample-restaurant-b'}));
 });
 const dish=await nameId('Đậu hũ mẫu');
 await t.test('a manager publishes only bound menus and cannot reopen customer ordering',async()=>{
  const day={date:'2099-01-01',label:'Ngày mẫu',status:'auto',menuCount:1,cutoffAt:Timestamp.fromDate(new Date('2099-01-01T09:30:00+07:00')),updatedAt:now()};
  await assertFails(setDoc(doc(foreign,'days',dayId),day));
  await assertFails(setDoc(doc(kitchen,'days',dayId),day));
  await assertSucceeds(setDoc(doc(manager,'days',dayId),day));
  await assertFails(updateDoc(doc(manager,'days',dayId),{status:'open',updatedAt:now()}));
  await updateDoc(doc(admin,'days',dayId),{status:'open',updatedAt:now()});
  await assertSucceeds(setDoc(doc(manager,'days',dayId,'dishes',dish),{name:'Đậu hũ mẫu',price:40000,active:true,updatedAt:now()}));
  await assertFails(updateDoc(doc(kitchen,'days',dayId,'dishes',dish),{price:50000,updatedAt:now()}));
  await assertSucceeds(getDocs(query(collection(manager,'merchantDays'),where('merchantId','==',merchantId))));
  await assertFails(getDocs(collection(manager,'merchantDays')));
 });
 const orderId=await nameId('Khách mẫu');
 await t.test('customer ordering and edits reach the same collection; merchants cannot settle or edit others',async()=>{
  await assertSucceeds(setDoc(doc(customer,'days',dayId,'orders',orderId),{name:'Khách mẫu',ownerId:'sample-customer',dishId:dish,dish:'Đậu hũ mẫu',price:40000,quantity:1,note:'Ít cơm, không hành',paid:false,cancelled:false,createdAt:now(),updatedAt:now()}));
  await assertSucceeds(updateDoc(doc(customer,'days',dayId,'orders',orderId),{quantity:2,updatedAt:now()}));
  assert.equal((await getDoc(doc(manager,'days',dayId,'orders',orderId))).data()!.quantity,2);
  await assertFails(updateDoc(doc(manager,'days',dayId,'orders',orderId),{paid:true,updatedAt:now()}));
  await assertFails(updateDoc(doc(manager,'days',dayId,'orders',orderId),{quantity:3,updatedAt:now()}));
  await assertFails(getDoc(doc(manager,'settings','paymentIntegrations')));
 });
 async function status(db:Firestore,state:string,hash='a'.repeat(64),withEvent=true){
  const ref=doc(db,'merchantFulfillments',dayId),old=await getDoc(ref),id=randomUUID().replaceAll('-',''),batch=writeBatch(db);
  batch.set(ref,{merchantId,date:'2099-01-01',state,note:'Ghi chú mẫu',orderHash:hash,lastEventId:id,createdAt:old.data()?.createdAt||now(),updatedAt:now(),updatedBy:uid(db)});
  if(withEvent)batch.set(doc(db,'merchants',merchantId,'events',id),{kind:'status.change',message:'Trạng thái mẫu',dayId,actorId:uid(db),createdAt:now()});
  return batch.commit();
 }
 await t.test('fulfillment follows role-limited steps with an immutable paired event',async()=>{
  await assertFails(status(manager,'completed'));
  await assertFails(status(kitchen,'accepted'));
  await assertFails(status(manager,'accepted','a'.repeat(64),false));
  await assertSucceeds(status(manager,'accepted'));
  await assertFails(status(foreign,'cooking'));
  await assertFails(status(manager,'ready'));
  await assertSucceeds(status(kitchen,'cooking'));
  await assertSucceeds(status(kitchen,'ready'));
  await assertFails(status(kitchen,'delivering'));
  await assertSucceeds(status(manager,'delivering'));
  await assertSucceeds(status(manager,'completed'));
  await assertFails(status(manager,'accepted'));
  await assertSucceeds(status(manager,'accepted','b'.repeat(64)));
  await assertSucceeds(getDoc(doc(customer,'merchantFulfillments',dayId)));
  const events=await assertSucceeds(getDocs(query(collection(manager,'merchants',merchantId,'events'),orderBy('createdAt','desc'),limit(30))));
  await assertFails(updateDoc(events.docs[0].ref,{message:'altered'}));
  await assertFails(getDocs(collection(customer,'merchants',merchantId,'events')));
 });
 await t.test('owners manage their team without escalating or moving identities across restaurants',async()=>{
  await assertFails(setDoc(doc(owner,'merchantUsers','new-kitchen'),{...member(merchantId,'kitchen'),updatedBy:uid(owner)}));
  await setDoc(doc(admin,'merchantUsers','new-kitchen'),member(merchantId,'kitchen'));
  await assertSucceeds(updateDoc(doc(owner,'merchantUsers','new-kitchen'),{enabled:true,updatedAt:now(),updatedBy:uid(owner)}));
  await assertFails(setDoc(doc(owner,'merchantUsers','new-owner'),{...member(merchantId,'owner'),updatedBy:uid(owner)}));
  await assertFails(updateDoc(doc(owner,'merchantUsers','merchant-owner'),{role:'manager',updatedAt:now(),updatedBy:uid(owner)}));
  await assertFails(updateDoc(doc(owner,'merchantUsers','new-kitchen'),{merchantId:'sample-restaurant-b',updatedAt:now(),updatedBy:uid(owner)}));
  await assertFails(setDoc(doc(kitchen,'merchantUsers','rogue'),{...member(merchantId,'manager'),updatedBy:uid(kitchen)}));
  await assertFails(getDoc(doc(customer,'merchantUsers','merchant-manager')));
  await assertFails(updateDoc(doc(manager,'merchants',merchantId),{active:false,updatedAt:now(),updatedBy:uid(manager)}));
  await updateDoc(doc(admin,'merchantUsers','merchant-manager'),{enabled:false,updatedAt:now(),updatedBy:uid(admin)});
  await assertFails(updateDoc(doc(manager,'days',dayId,'dishes',dish),{price:50000,updatedAt:now()}));
 });
 }finally{await env.cleanup();}
});
