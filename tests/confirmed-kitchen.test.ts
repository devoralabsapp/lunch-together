import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,updateDoc,serverTimestamp,Timestamp,writeBatch,deleteField,type Firestore} from 'firebase/firestore';
import {dayClosureFields} from '../lib/day-closure';

test('closed-order dispatch and first-close reopening deadline are enforced by Firestore',{timeout:120000},async t=>{
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST!.split(':'),env=await initializeTestEnvironment({projectId:'demo-confirmed-kitchen',firestore:{host,port:Number(port),rules:fs.readFileSync('firestore.rules','utf8')}});
 const google=(uid:string)=>env.authenticatedContext(uid,{email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore() as unknown as Firestore;
 const admin=google('sample-admin'),manager=google('sample-manager'),kitchen=google('sample-kitchen'),foreign=google('sample-foreign'),customer=env.authenticatedContext('sample-customer').firestore() as unknown as Firestore;
 const date='2099-04-01',dayId='day-'+date,id='sample-store',now=()=>serverTimestamp(),day=(db:Firestore)=>doc(db,'days',dayId);
 const patch=(data:object)=>updateDoc(day(admin),{...data,updatedAt:now()});
 const seed=async(data:object)=>env.withSecurityRulesDisabled(async c=>updateDoc(doc(c.firestore() as unknown as Firestore,'days',dayId),data));
 async function close(){const d=await getDoc(day(admin));await patch({status:'closed',...dayClosureFields(d.data(),'closed')});return (await getDoc(day(admin))).data()!.dispatchId as string;}
 async function status(db:Firestore,state:string,dispatchId:string,extra:object={}){const uid=db===manager?'sample-manager':db===kitchen?'sample-kitchen':'sample-foreign',ref=doc(db,'merchantFulfillments',dayId),old=await getDoc(ref),event=crypto.randomUUID().replaceAll('-',''),b=writeBatch(db);b.set(ref,{merchantId:id,date,state,note:'Sample note',orderHash:'a'.repeat(64),dispatchId,lastEventId:event,createdAt:old.data()?.createdAt||now(),updatedAt:now(),updatedBy:uid,...extra});b.set(doc(db,'merchants',id,'events',event),{kind:'status.change',message:'Sample status',dayId,actorId:uid,createdAt:now()});return b.commit();}
 try{
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore() as unknown as Firestore;await setDoc(doc(db,'admins','sample-admin'),{enabled:true});for(const [uid,role,store] of [['sample-manager','manager',id],['sample-kitchen','kitchen',id],['sample-foreign','manager','other-store']])await setDoc(doc(db,'merchantUsers',uid),{merchantId:store,role,enabled:true});for(const store of [id,'other-store'])await setDoc(doc(db,'merchants',store),{active:true,name:'Sample store'});await setDoc(doc(db,'merchantDays',dayId),{merchantId:id,date});await setDoc(day(db),{date,label:'Sample lunch',status:'open',menuCount:1,cutoffAt:Timestamp.fromDate(new Date(date+'T09:30:00+07:00')),updatedAt:now()});await setDoc(doc(db,'days',dayId,'orders','sample-order'),{dish:'Sample dish',note:'Less rice',quantity:1,price:40000,cancelled:false});});
 await t.test('merchant cannot get/list orders or accept before explicit close, including auto cutoff',async()=>{
  for(const db of [manager,kitchen,foreign]){await assertFails(getDocs(collection(db,'days',dayId,'orders')));await assertFails(getDoc(doc(db,'days',dayId,'orders','sample-order')));}
  await assertSucceeds(getDocs(collection(customer,'days',dayId,'orders')));await assertFails(status(manager,'accepted','a'.repeat(32)));await seed({status:'auto',cutoffAt:Timestamp.fromMillis(0)});await assertFails(getDocs(collection(manager,'days',dayId,'orders')));await seed({status:'open',cutoffAt:Timestamp.fromDate(new Date(date+'T09:30:00+07:00'))});
 });
 let dispatch='';
 await t.test('only administrator closes with server timestamp and a bounded dispatch identity',async()=>{
  await assertFails(updateDoc(day(manager),{status:'closed',closedAt:now(),dispatchId:'a'.repeat(32),updatedAt:now()}));await assertFails(patch({status:'closed'}));await assertFails(patch({status:'closed',closedAt:Timestamp.fromMillis(0),dispatchId:'a'.repeat(32)}));await assertFails(patch({status:'closed',closedAt:now(),dispatchId:'invalid'}));dispatch=await close();assert.match(dispatch,/^[a-f0-9]{32}$/);for(const db of [manager,kitchen])await assertSucceeds(getDocs(collection(db,'days',dayId,'orders')));await assertFails(getDocs(collection(foreign,'days',dayId,'orders')));
 });
 await t.test('fulfillment requires the current dispatch and cannot skip stages or forge schema',async()=>{
  await assertFails(status(manager,'accepted','b'.repeat(32)));await assertFails(status(kitchen,'accepted',dispatch));await assertFails(status(manager,'completed',dispatch));await assertFails(status(manager,'accepted',dispatch,{arbitrary:'x'}));await assertSucceeds(status(manager,'accepted',dispatch));await assertSucceeds(status(kitchen,'cooking',dispatch));await assertFails(status(kitchen,'delivering',dispatch));
 });
 await t.test('reopening within the window immediately hides orders and blocks stale progress',async()=>{
  await patch({status:'open'});await assertFails(getDocs(collection(manager,'days',dayId,'orders')));await assertFails(status(manager,'ready',dispatch));await assertFails(updateDoc(day(kitchen),{status:'closed',updatedAt:now()}));
 });
 await t.test('redispatch keeps first close time and restarts at accepted even when the order hash is unchanged',async()=>{
  const anchor=(await getDoc(day(admin))).data()!.closedAt;await assertFails(patch({status:'closed'}));const next=await close();assert.notEqual(next,dispatch);assert.ok((await getDoc(day(admin))).data()!.closedAt.isEqual(anchor));await assertFails(status(kitchen,'ready',next));await assertFails(status(manager,'accepted',dispatch));await assertSucceeds(status(manager,'accepted',next));dispatch=next;
 });
 await t.test('expired first close cannot be reopened, deleted, refreshed, or switched to auto',async()=>{
  await seed({closedAt:Timestamp.fromMillis(Date.now()-16*60000)});for(const status of ['open','auto'])await assertFails(patch({status}));await assertFails(patch({status:'open',closedAt:now()}));await assertFails(patch({closedAt:now()}));await assertFails(patch({closedAt:deleteField(),dispatchId:deleteField()}));await assertFails(patch({closedAt:'not-a-timestamp'}));await assertFails(patch({closedAt:Timestamp.fromMillis(Date.now()+60000)}));await assertFails(patch({dispatchId:'x'.repeat(10000)}));
 });
 await t.test('legacy closed days use cutoff as deadline and cannot reset it during send initialization',async()=>{
  await seed({status:'closed',closedAt:deleteField(),dispatchId:deleteField(),cutoffAt:Timestamp.fromMillis(0)});await assertFails(getDocs(collection(manager,'days',dayId,'orders')));await assertFails(patch({status:'open',closedAt:now(),dispatchId:'c'.repeat(32)}));await assertFails(patch({closedAt:now(),dispatchId:'c'.repeat(32)}));await seed({cutoffAt:Timestamp.fromDate(new Date('2020-04-01T09:30:00+07:00')),date:'2020-04-01'});await assertFails(patch({status:'open'}));await assertSucceeds(patch({closedAt:Timestamp.fromDate(new Date('2020-04-01T09:30:00+07:00')),dispatchId:'c'.repeat(32)}));
 });
 }finally{await env.cleanup();}
});
