import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,getDoc,getDocs,collection,setDoc,updateDoc,deleteDoc,writeBatch,serverTimestamp,type Firestore} from 'firebase/firestore';
import {createRestaurantDay,mealRestaurants} from '../lib/merchant-day-client';
import {nameId} from '../lib/meal-client-model';import type {MealClient} from '../lib/meal-client';
test('store archives and customer restaurant-linked meal day creation',{timeout:120000},async t=>{
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST!.split(':'),env=await initializeTestEnvironment({projectId:'demo-merchant-navigation',firestore:{host,port:Number(port),rules:fs.readFileSync('firestore.rules','utf8')}});
 const google=(uid:string)=>env.authenticatedContext(uid,{email:uid+'@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore() as unknown as Firestore;
 const admin=google('sample-admin'),owner=google('sample-owner'),manager=google('sample-manager');
 const client=(db:Firestore,uid:string,allowed=true)=>({db,isAdmin:async()=>allowed,auth:{authStateReady:async()=>{},currentUser:{uid}}}) as unknown as MealClient;
 const adminClient=client(admin,'sample-admin');
 const store=(id:string)=>doc(admin,'merchants',id),date='2099-03-01',dish=await nameId('Sample rice');
 const fixtures=async(day:string)=>{await setDoc(doc(admin,'merchants','store-a','menus',day),{date:day,menuCount:1,updatedAt:serverTimestamp(),updatedBy:'sample-admin'});await setDoc(doc(admin,'merchants','store-a','menus',day,'dishes',dish),{name:'Sample rice',price:40000,active:true,updatedAt:serverTimestamp()});};
 const archive=(db:Firestore,value:boolean)=>{const b=writeBatch(db),uid=db===owner?'sample-owner':'sample-manager';b.update(doc(db,'merchants','store-a'),{archived:value,active:!value,updatedAt:serverTimestamp(),updatedBy:uid});b.set(doc(db,'merchants','store-a','events',crypto.randomUUID().replaceAll('-','')),{kind:'merchant.update',message:'Sample archive change',dayId:'',actorId:uid,createdAt:serverTimestamp()});return b.commit();};
 try{
 await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore() as unknown as Firestore,'admins','sample-admin'),{enabled:true});});
 await setDoc(store('store-a'),{name:'Sample branch A',phone:'',address:'',active:true,ownerId:'sample-owner',createdAt:serverTimestamp(),createdBy:'sample-admin',updatedAt:serverTimestamp(),updatedBy:'sample-admin'});
 for(const [uid,role] of [['sample-owner','owner'],['sample-manager','manager']])await setDoc(doc(admin,'merchantUsers',uid),{merchantId:'store-a',role,enabled:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:'sample-admin'});
 await fixtures(date);
 await t.test('administrator creates a complete day, immutable store binding and exact menu snapshot atomically',async()=>{
  await createRestaurantDay(adminClient,{date,merchantId:'store-a',status:'auto'});
  assert.equal((await getDoc(doc(admin,'merchantDays','day-'+date))).data()!.merchantId,'store-a');assert.equal((await getDoc(doc(admin,'days','day-'+date,'dishes',dish))).data()!.price,40000);
  assert.equal((await getDocs(collection(admin,'activityLogs'))).size,1);
 });
 await t.test('existing meal days cannot be overwritten or rebound by this creation flow',async()=>{
  await assert.rejects(createRestaurantDay(adminClient,{date,merchantId:'store-a',status:'open'}),/đã có/);assert.equal((await getDoc(doc(admin,'days','day-'+date))).data()!.status,'auto');
 });
 await t.test('racing submissions create only one complete day',async()=>{
  const d='2099-03-02';await fixtures(d);const result=await Promise.allSettled([1,2].map(()=>createRestaurantDay(adminClient,{date:d,merchantId:'store-a',status:'open'})));assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
 });
 await t.test('regular merchant staff cannot create customer meal days even with a forged UI admin flag',async()=>{
  const d='2099-03-03';await fixtures(d);await assert.rejects(createRestaurantDay(client(manager,'sample-manager',false),{date:d,merchantId:'store-a',status:'auto'}));await assert.rejects(createRestaurantDay(client(manager,'sample-manager'),{date:d,merchantId:'store-a',status:'auto'}));assert.equal((await getDoc(doc(admin,'days','day-'+d))).exists(),false);
 });
 await t.test('only owners/admins archive stores; archive cannot change ownership or delete documents',async()=>{
  await assertFails(archive(manager,true));await assertFails(updateDoc(doc(owner,'merchants','store-a'),{archived:true,active:true,updatedAt:serverTimestamp(),updatedBy:'sample-owner'}));await assertFails(deleteDoc(doc(owner,'merchants','store-a')));await assertSucceeds(archive(owner,true));
  assert.equal((await getDoc(store('store-a'))).data()!.active,false);assert.equal((await getDoc(doc(admin,'merchantDays','day-'+date))).exists(),true);assert.equal((await getDoc(doc(admin,'days','day-'+date,'dishes',dish))).data()!.price,40000);
 });
 await t.test('archived stores disappear from active choices and cannot supply a new day',async()=>{
  assert.deepEqual(await mealRestaurants(adminClient),[]);await assert.rejects(createRestaurantDay(adminClient,{date:'2099-03-03',merchantId:'store-a',status:'auto'}),/ngừng/);assert.equal((await getDoc(doc(admin,'merchantDays','day-2099-03-03'))).exists(),false);
 });
 await t.test('owners can restore their store with a log, but suspended owners cannot bypass account locks',async()=>{
  await assertSucceeds(archive(owner,false));await assertSucceeds(archive(owner,true));await updateDoc(doc(admin,'merchantUsers','sample-owner'),{enabled:false,updatedAt:serverTimestamp(),updatedBy:'sample-admin'});await assertFails(archive(owner,false));await updateDoc(doc(admin,'merchantUsers','sample-owner'),{enabled:true,updatedAt:serverTimestamp(),updatedBy:'sample-admin'});await assertSucceeds(archive(owner,false));assert.equal((await mealRestaurants(adminClient)).length,1);
 });
 await t.test('empty branch menus are allowed but cannot create an empty published customer day',async()=>{
  const d='2099-03-04';await assertSucceeds(setDoc(doc(owner,'merchants','store-a','menus',d),{date:d,menuCount:0,updatedAt:serverTimestamp(),updatedBy:'sample-owner'}));await assert.rejects(createRestaurantDay(adminClient,{date:d,merchantId:'store-a',status:'auto'}),/chưa có/);assert.equal((await getDoc(doc(admin,'days','day-'+d))).exists(),false);
 });
 }finally{await env.cleanup();}
});
