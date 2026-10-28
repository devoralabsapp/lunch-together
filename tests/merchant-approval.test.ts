import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {randomUUID} from 'node:crypto';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {collection,doc,setDoc,updateDoc,getDoc,getDocs,query,where,writeBatch,serverTimestamp,type Firestore} from 'firebase/firestore';
import {nameId} from '../lib/meal-client-model';

test('merchant applications, independent branches and scoped store staff',{timeout:120000},async t=>{
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST!.split(':'),env=await initializeTestEnvironment({projectId:'demo-merchant-approval',firestore:{host,port:Number(port),rules:fs.readFileSync('firestore.rules','utf8')}});
 const google=(uid:string)=>env.authenticatedContext(uid,{email:uid+'@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore() as unknown as Firestore;
 const admin=google('sample-admin'),owner=google('sample-owner'),staff=google('sample-staff'),foreign=google('sample-foreign');
 const application=(uid:string)=>({email:uid+'@example.test',displayName:'Sample '+uid,businessName:'Sample brand',phone:'',note:'',status:'pending',createdAt:serverTimestamp(),updatedAt:serverTimestamp(),reviewedBy:'',reviewedAt:null,reviewNote:'',reviewEventId:''});
 const member=(uid:string)=>({merchantId:uid,role:'owner',enabled:true,accountOnly:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:'sample-admin'});
 async function review(uid:string,status:string,db=admin){const event=randomUUID().replaceAll('-',''),batch=writeBatch(db),actor=db===admin?'sample-admin':'sample-owner';batch.update(doc(db,'merchantApplications',uid),{status,reviewedBy:actor,reviewedAt:serverTimestamp(),reviewNote:'Sample review',reviewEventId:event,updatedAt:serverTimestamp()});batch.set(doc(db,'merchantApprovalEvents',event),{uid,status,actorId:actor,note:'Sample review',createdAt:serverTimestamp()});if(status==='approved')batch.set(doc(db,'merchantUsers',uid),member(uid));else if(status==='disabled')batch.update(doc(db,'merchantUsers',uid),{enabled:false,updatedBy:actor,updatedAt:serverTimestamp()});return batch.commit();}
 async function create(id:string,db=owner,ownerId='sample-owner'){const actor=db===owner?'sample-owner':'sample-foreign',batch=writeBatch(db);batch.set(doc(db,'merchants',id),{name:'Sample '+id,phone:'',address:'',active:true,ownerId,createdAt:serverTimestamp(),createdBy:actor,updatedAt:serverTimestamp(),updatedBy:actor});batch.set(doc(db,'merchants',id,'events',randomUUID().replaceAll('-','')),{kind:'merchant.create',message:'Sample store created',dayId:'',actorId:actor,createdAt:serverTimestamp()});return batch.commit();}
 try{
 await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore() as unknown as Firestore,'admins','sample-admin'),{enabled:true});});
 await t.test('verified applicants can register only pending requests belonging to their real identity',async()=>{
  await assertSucceeds(setDoc(doc(owner,'merchantApplications','sample-owner'),application('sample-owner')));
  await assertFails(setDoc(doc(foreign,'merchantApplications','sample-other'),application('sample-other')));
  await assertFails(setDoc(doc(foreign,'merchantApplications','sample-foreign'),{...application('sample-foreign'),status:'approved'}));
  await assertFails(setDoc(doc(foreign,'merchantApplications','sample-foreign'),{...application('sample-foreign'),email:'forged@example.test'}));
  await assertFails(setDoc(doc(foreign,'merchantApplications','sample-foreign'),{...application('sample-foreign'),phone:'1'.repeat(31)}));
  await assertFails(getDocs(collection(owner,'merchantApplications')));await assertFails(getDoc(doc(foreign,'merchantApplications','sample-owner')));
 });
 await t.test('pending users cannot read private menus, create stores, self-approve or self-enroll',async()=>{
  await assertFails(create('premature'));await assertFails(review('sample-owner','approved',owner));
  await assertFails(setDoc(doc(owner,'merchantUsers','sample-owner'),member('sample-owner')));
  await assertFails(getDocs(collection(owner,'merchants','store-a','catalog')));
 });
 await t.test('approval requires an administrator, identity marker and immutable paired review event',async()=>{
  await assertFails(updateDoc(doc(admin,'merchantApplications','sample-owner'),{status:'approved',reviewedBy:'sample-admin',reviewedAt:serverTimestamp(),reviewEventId:'a'.repeat(32),updatedAt:serverTimestamp()}));
  await assertSucceeds(review('sample-owner','approved'));assert.equal((await getDoc(doc(admin,'merchantUsers','sample-owner'))).data()!.accountOnly,true);
  await assertFails(updateDoc(doc(owner,'merchantApplications','sample-owner'),{status:'pending',updatedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(owner,'userProfiles','sample-owner'),{displayName:'Sample',preferredName:'Sample',email:'sample-owner@example.test',provider:'google.com',createdAt:serverTimestamp(),lastSeenAt:serverTimestamp()}));
 });
 await t.test('approved owners create and list multiple own stores, including atomic creation logs',async()=>{
  await assertSucceeds(create('store-a'));await assertSucceeds(create('store-b'));
  const stores=await assertSucceeds(getDocs(query(collection(owner,'merchants'),where('ownerId','==','sample-owner'))));assert.equal(stores.size,2);
  await assertFails(getDocs(collection(owner,'merchants')));await assertFails(create('stolen',owner,'sample-foreign'));
  await assertFails(updateDoc(doc(owner,'merchants','store-a'),{ownerId:'sample-foreign',updatedBy:'sample-owner',updatedAt:serverTimestamp()}));
 });
 await t.test('branches keep different private menus for the same date, with immutable tenant boundaries',async()=>{
  const date='2099-01-01',dish=await nameId('Sample dish');for(const [id,price] of [['store-a',40000],['store-b',50000]] as const){const batch=writeBatch(owner);batch.set(doc(owner,'merchants',id,'menus',date),{date,menuCount:1,updatedBy:'sample-owner',updatedAt:serverTimestamp()});batch.set(doc(owner,'merchants',id,'menus',date,'dishes',dish),{name:'Sample dish',price,active:true,updatedAt:serverTimestamp()});await assertSucceeds(batch.commit());}
  assert.equal((await getDoc(doc(owner,'merchants','store-b','menus',date,'dishes',dish))).data()!.price,50000);
  await assertFails(getDocs(collection(foreign,'merchants','store-a','menus',date,'dishes')));
  await assertFails(updateDoc(doc(owner,'merchants','store-a','menus',date),{menuCount:61,updatedAt:serverTimestamp()}));
 });
 await t.test('staff must be approved and can receive different roles at multiple stores',async()=>{
  const grant=(store:string,role:string)=>({merchantId:store,uid:'sample-staff',role,enabled:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:'sample-owner'});
  await assertFails(setDoc(doc(owner,'merchantStoreUsers','store-a~sample-staff'),grant('store-a','manager')));
  await setDoc(doc(staff,'merchantApplications','sample-staff'),application('sample-staff'));await review('sample-staff','approved');
  await assertSucceeds(getDoc(doc(owner,'merchantStoreUsers','store-a~sample-staff')));
  await assertSucceeds(setDoc(doc(owner,'merchantStoreUsers','store-a~sample-staff'),grant('store-a','manager')));
  await assertSucceeds(setDoc(doc(owner,'merchantStoreUsers','store-b~sample-staff'),grant('store-b','kitchen')));
  const grants=await getDocs(query(collection(staff,'merchantStoreUsers'),where('uid','==','sample-staff')));assert.equal(grants.size,2);
  const dish=await nameId('Staff dish');await assertSucceeds(setDoc(doc(staff,'merchants','store-a','catalog',dish),{name:'Staff dish',price:40000,active:true,updatedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(staff,'merchants','store-b','catalog',dish),{name:'Staff dish',price:40000,active:true,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(staff,'merchantStoreUsers','store-b~sample-staff'),{role:'owner',updatedBy:'sample-staff',updatedAt:serverTimestamp()}));
 });
 await t.test('only admins review requests, owners cannot forge approval or grant owner escalation',async()=>{
  await assertFails(setDoc(doc(owner,'merchantStoreUsers','store-a~sample-foreign'),{merchantId:'store-a',uid:'sample-foreign',role:'owner',enabled:true,createdAt:serverTimestamp(),updatedBy:'sample-owner',updatedAt:serverTimestamp()}));
  const entries=await getDocs(collection(admin,'merchantApprovalEvents'));await assertFails(updateDoc(entries.docs[0].ref,{note:'Changed'}));
 });
 await t.test('revocation removes all tenant operations without returning an approved user to customer access',async()=>{
  await assertSucceeds(review('sample-owner','disabled'));await assertFails(create('store-c'));
  await assertFails(getDocs(collection(owner,'merchants','store-a','catalog')));
  await assertFails(getDoc(doc(owner,'settings','payment')));
  assert.equal((await getDoc(doc(admin,'merchantUsers','sample-owner'))).exists(),true);
 });
 await t.test('a declined applicant can resubmit bounded business details but cannot change the verdict directly',async()=>{
  await setDoc(doc(foreign,'merchantApplications','sample-foreign'),application('sample-foreign'));await review('sample-foreign','rejected');
  await assertSucceeds(updateDoc(doc(foreign,'merchantApplications','sample-foreign'),{businessName:'New sample brand',status:'pending',reviewedBy:'',reviewedAt:null,reviewNote:'',reviewEventId:'',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(foreign,'merchantApplications','sample-foreign'),{note:'x'.repeat(501),updatedAt:serverTimestamp()}));
 });
 }finally{await env.cleanup();}
});
