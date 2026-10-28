import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,getDoc,getDocs,collection,setDoc,updateDoc,writeBatch,deleteDoc,serverTimestamp,type Firestore} from 'firebase/firestore';
import {createRestaurantDay,restaurantDayMenu} from '../lib/merchant-day-client';import {nameId} from '../lib/meal-client-model';import type {MealClient} from '../lib/meal-client';
test('business-wide catalog and direct restaurant menu publication',{timeout:120000},async t=>{
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST!.split(':'),env=await initializeTestEnvironment({projectId:'demo-business-catalog',firestore:{host,port:Number(port),rules:fs.readFileSync('firestore.rules','utf8')}}),google=(uid:string)=>env.authenticatedContext(uid,{email:uid+'@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore() as unknown as Firestore;
 const admin=google('sample-admin'),owner=google('sample-owner'),manager=google('sample-manager'),kitchen=google('sample-kitchen'),foreign=google('sample-foreign'),guest=env.unauthenticatedContext().firestore() as unknown as Firestore,business='sample-owner',date='2099-04-01',dishId=await nameId('Published rice');
 const actor=(db:Firestore)=>db===admin?'sample-admin':db===owner?'sample-owner':db===manager?'sample-manager':db===kitchen?'sample-kitchen':'sample-foreign';
 const witness=(db:Firestore,storeId='store-a',businessId=business)=>({businessId,uid:actor(db),storeId,updatedAt:serverTimestamp()});
 const claim=(db:Firestore,storeId='store-a',businessId=business)=>setDoc(doc(db,'merchantCatalogAccess',businessId+'~'+actor(db)),witness(db,storeId,businessId));
 const price=(value=35000)=>({name:'Published rice',price:value,active:true,updatedAt:serverTimestamp()});
 const publish=(db:Firestore,value=35000)=>{const b=writeBatch(db);b.set(doc(db,'merchants','store-a','offers',date),{date,menuCount:1,createdAt:serverTimestamp(),createdBy:actor(db),updatedAt:serverTimestamp(),updatedBy:actor(db)});b.set(doc(db,'merchants','store-a','offers',date,'dishes',dishId),price(value));return b.commit();};
 const client={db:admin,isAdmin:async()=>true,auth:{authStateReady:async()=>{},currentUser:{uid:'sample-admin'}}} as unknown as MealClient;
 try{
 await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore() as unknown as Firestore,'admins','sample-admin'),{enabled:true});});
 for(const [id,ownerId] of [['store-a',business],['store-b',business],['store-foreign','sample-foreign']])await setDoc(doc(admin,'merchants',id),{name:'Sample '+id,ownerId,active:true,phone:'',address:'',createdAt:serverTimestamp(),createdBy:'sample-admin',updatedAt:serverTimestamp(),updatedBy:'sample-admin'});
 for(const [uid,role,store] of [['sample-owner','owner','sample-owner'],['sample-manager','manager','store-a'],['sample-kitchen','kitchen','store-a'],['sample-foreign','owner','sample-foreign']])await setDoc(doc(admin,'merchantUsers',uid),{merchantId:store,role,enabled:true,accountOnly:role==='owner',createdAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:'sample-admin'});
 await t.test('access witnesses cannot forge another user, business or role',async()=>{
  await assertSucceeds(claim(manager));await assertSucceeds(claim(kitchen));await assertFails(claim(manager,'store-foreign'));await assertFails(claim(foreign,'store-foreign'));await assertFails(setDoc(doc(manager,'merchantCatalogAccess',business+'~sample-owner'),{...witness(manager),uid:'sample-owner'}));await assertFails(setDoc(doc(manager,'merchantCatalogAccess',business+'~sample-manager'),{...witness(manager),role:'owner'}));
 });
 await t.test('only owners/admins initialize migration; managers cannot edit before readiness',async()=>{
  const header={version:1,initialized:false,createdAt:serverTimestamp(),createdBy:'sample-owner',updatedAt:serverTimestamp(),updatedBy:'sample-owner'};await assertFails(setDoc(doc(manager,'merchantCatalogs',business),{...header,createdBy:'sample-manager',updatedBy:'sample-manager'}));await assertSucceeds(setDoc(doc(owner,'merchantCatalogs',business),header));await assertFails(setDoc(doc(manager,'merchantCatalogs',business,'dishes',dishId),price()));await assertSucceeds(setDoc(doc(owner,'merchantCatalogs',business,'dishes',dishId),price()));await updateDoc(doc(owner,'merchantCatalogs',business),{initialized:true,updatedAt:serverTimestamp(),updatedBy:'sample-owner'});await assertFails(updateDoc(doc(owner,'merchantCatalogs',business),{initialized:false,updatedAt:serverTimestamp(),updatedBy:'sample-owner'}));
 });
 await t.test('manager edits shared dishes, kitchen reads only, foreign owners and guests are isolated',async()=>{
  await assertSucceeds(updateDoc(doc(manager,'merchantCatalogs',business,'dishes',dishId),{price:36000,updatedAt:serverTimestamp()}));assert.equal((await getDoc(doc(kitchen,'merchantCatalogs',business,'dishes',dishId))).data()!.price,36000);await assertFails(updateDoc(doc(kitchen,'merchantCatalogs',business,'dishes',dishId),{price:1,updatedAt:serverTimestamp()}));await assertFails(getDocs(collection(foreign,'merchantCatalogs',business,'dishes')));await assertFails(getDocs(collection(guest,'merchantCatalogs',business,'dishes')));await assertFails(deleteDoc(doc(owner,'merchantCatalogs',business,'dishes',dishId)));
 });
 await t.test('legacy imports belong to the same business and remain immutable',async()=>{
  await assertSucceeds(setDoc(doc(owner,'merchantCatalogs',business,'imports','store-b'),{storeId:'store-b',importedAt:serverTimestamp(),importedBy:'sample-owner'}));await assertFails(setDoc(doc(owner,'merchantCatalogs',business,'imports','store-foreign'),{storeId:'store-foreign',importedAt:serverTimestamp(),importedBy:'sample-owner'}));await assertFails(updateDoc(doc(owner,'merchantCatalogs',business,'imports','store-b'),{importedBy:'sample-manager'}));
 });
 await t.test('revoking a witness store membership immediately revokes shared-catalog access',async()=>{
  await updateDoc(doc(admin,'merchantUsers','sample-manager'),{enabled:false,updatedAt:serverTimestamp(),updatedBy:'sample-admin'});await assertFails(getDoc(doc(manager,'merchantCatalogs',business,'dishes',dishId)));await assertFails(updateDoc(doc(manager,'merchantCatalogs',business,'dishes',dishId),{price:37000,updatedAt:serverTimestamp()}));await updateDoc(doc(admin,'merchantUsers','sample-manager'),{enabled:true,updatedAt:serverTimestamp(),updatedBy:'sample-admin'});
 });
 await t.test('a manager publishes before assignment without taking the global customer day',async()=>{
  await assertSucceeds(publish(manager));assert.equal((await getDoc(doc(admin,'merchantDays','day-'+date))).exists(),false);assert.equal((await getDoc(doc(admin,'days','day-'+date))).exists(),false);await assertFails(publish(kitchen));await assertFails(setDoc(doc(manager,'merchantDays','day-'+date),{merchantId:'store-a',date,createdAt:serverTimestamp(),createdBy:'sample-manager'}));
 });
 await t.test('customer admin preview and creation prefer the published selection over the private branch menu',async()=>{
  await setDoc(doc(admin,'merchants','store-a','menus',date),{date,menuCount:1,updatedAt:serverTimestamp(),updatedBy:'sample-admin'});const privateId=await nameId('Private rice');await setDoc(doc(admin,'merchants','store-a','menus',date,'dishes',privateId),{name:'Private rice',price:50000,active:true,updatedAt:serverTimestamp()});assert.equal((await restaurantDayMenu(client,'store-a',date)).menu[0].name,'Published rice');await createRestaurantDay(client,{merchantId:'store-a',date,status:'auto'});assert.equal((await getDoc(doc(admin,'days','day-'+date,'dishes',dishId))).data()!.price,35000);assert.equal((await getDoc(doc(admin,'days','day-'+date,'dishes',privateId))).exists(),false);
 });
 await t.test('offer dishes require a matching publication revision and cannot be edited independently',async()=>{
  await assertFails(updateDoc(doc(manager,'merchants','store-a','offers',date,'dishes',dishId),{price:39000,updatedAt:serverTimestamp()}));const b=writeBatch(manager);b.update(doc(manager,'merchants','store-a','offers',date),{updatedAt:serverTimestamp(),updatedBy:'sample-manager'});b.update(doc(manager,'merchants','store-a','offers',date,'dishes',dishId),{price:39000,updatedAt:serverTimestamp()});await assertSucceeds(b.commit());assert.equal((await getDoc(doc(admin,'days','day-'+date,'dishes',dishId))).data()!.price,35000);
 });
 }finally{await env.cleanup();}
});
