import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type {User} from 'firebase/auth';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,updateDoc,serverTimestamp,Timestamp,type Firestore} from 'firebase/firestore';
import {assertCustomerAccount,PortalAccessError} from '../lib/portal-access';
import {nameId} from '../lib/meal-client-model';

test('portal-exclusive accounts: admission, revocation, shared kitchen data and financial separation',{timeout:120000},async t=>{
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST!.split(':');
 const env=await initializeTestEnvironment({projectId:'demo-portal-partition',firestore:{host,port:Number(port),rules:fs.readFileSync('firestore.rules','utf8')}});
 const identity=(uid:string,anonymous=false)=>({uid,isAnonymous:anonymous,getIdTokenResult:async()=>({signInProvider:anonymous?'anonymous':'google.com',claims:{email_verified:!anonymous}})}) as unknown as User;
 const google=(uid:string)=>env.authenticatedContext(uid,{email:uid+'@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore() as unknown as Firestore;
 const admin=google('sample-admin'),merchant=google('sample-chef'),customer=google('sample-diner'),guest=env.authenticatedContext('sample-guest',{firebase:{sign_in_provider:'anonymous'}}).firestore() as unknown as Firestore;
 const day='day-2099-01-01',dish=await nameId('Sample lunch'),order=await nameId('Sample chef');
 const profile=(uid:string)=>({displayName:uid,preferredName:'',email:uid+'@example.test',provider:'google.com',createdAt:serverTimestamp(),lastSeenAt:serverTimestamp()});
 const meal=(uid:string,name:string)=>({name,ownerId:uid,dishId:dish,dish:'Sample lunch',price:40000,quantity:1,note:'',paid:false,cancelled:false,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
 try{
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore() as unknown as Firestore;
  await setDoc(doc(db,'admins','sample-admin'),{enabled:true});
  for(const uid of ['sample-chef','sample-admin'])await setDoc(doc(db,'merchantUsers',uid),{merchantId:'sample-kitchen',role:'manager',enabled:true,createdAt:new Date(),updatedAt:new Date(),updatedBy:'sample-admin'});
  await setDoc(doc(db,'merchants','sample-kitchen'),{name:'Sample kitchen',active:true});
  await setDoc(doc(db,'merchantDays',day),{merchantId:'sample-kitchen',date:'2099-01-01'});
  await setDoc(doc(db,'days',day),{date:'2099-01-01',label:'Sample lunch',status:'open',menuCount:1,cutoffAt:Timestamp.fromDate(new Date('2099-01-01T09:30:00+07:00')),updatedAt:new Date()});
  await setDoc(doc(db,'days',day,'dishes',dish),{name:'Sample lunch',price:40000,active:true,updatedAt:new Date()});
 });
 await t.test('customer and guest admitted; merchant denied before customer load; assigned admin admitted',async()=>{
  await assertCustomerAccount(identity('sample-diner'),customer);
  await assertCustomerAccount(identity('sample-guest',true),guest);
  await assertCustomerAccount(identity('sample-admin'),admin);
  await assert.rejects(assertCustomerAccount(identity('sample-chef'),merchant),PortalAccessError);
 });
 await t.test('merchant cannot create own customer order/profile or use customer settings',async()=>{
  await assertFails(setDoc(doc(merchant,'days',day,'orders',order),meal('sample-chef','Sample chef')));
  await assertFails(setDoc(doc(merchant,'userProfiles','sample-chef'),profile('sample-chef')));
  await assertFails(getDoc(doc(merchant,'settings','payment')));
  await assertFails(getDocs(collection(merchant,'days')));
 });
 await t.test('customer cannot enter merchant workspace or self-enroll',async()=>{
  await assertFails(getDocs(collection(customer,'merchants','sample-kitchen','catalog')));
  await assertFails(setDoc(doc(customer,'merchantUsers','sample-diner'),{merchantId:'sample-kitchen',role:'owner',enabled:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:'sample-diner'}));
 });
 await t.test('customer and anonymous orders work; assigned admin may order and access merchant',async()=>{
  await assertSucceeds(setDoc(doc(customer,'days',day,'orders',await nameId('Sample diner')),meal('sample-diner','Sample diner')));
  await assertSucceeds(setDoc(doc(guest,'days',day,'orders',await nameId('Sample guest')),meal('sample-guest','Sample guest')));
  await assertSucceeds(setDoc(doc(admin,'days',day,'orders',await nameId('Sample admin')),meal('sample-admin','Sample admin')));
  await assertSucceeds(getDocs(collection(admin,'merchants','sample-kitchen','catalog')));
 });
 await t.test('merchant reads bound operational meals but cannot read unrelated days',async()=>{
  await assertSucceeds(getDoc(doc(merchant,'days',day)));
  await assertSucceeds(getDocs(collection(merchant,'days',day,'orders')));
  await assertFails(getDoc(doc(merchant,'days','day-2099-01-02')));
 });
 await t.test('existing customer session loses customer privileges when assigned to Merchant',async()=>{
  await setDoc(doc(customer,'userProfiles','sample-diner'),profile('sample-diner'));
  await updateDoc(doc(admin,'merchantUsers','sample-chef'),{role:'owner',updatedBy:'sample-admin',updatedAt:serverTimestamp()});
  await assertFails(setDoc(doc(merchant,'merchantUsers','sample-diner'),{merchantId:'sample-kitchen',role:'kitchen',enabled:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:'sample-chef'}));
  await setDoc(doc(admin,'merchantUsers','sample-diner'),{merchantId:'sample-kitchen',role:'kitchen',enabled:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:'sample-admin'});
  await assert.rejects(assertCustomerAccount(identity('sample-diner'),customer),PortalAccessError);
  await assertFails(updateDoc(doc(customer,'days',day,'orders',await nameId('Sample diner')),{quantity:2,updatedAt:serverTimestamp()}));
 });
 await t.test('disabled merchant stays excluded from customer and loses kitchen data; no self-unassignment',async()=>{
  await updateDoc(doc(admin,'merchantUsers','sample-chef'),{enabled:false,updatedBy:'sample-admin',updatedAt:serverTimestamp()});
  await assert.rejects(assertCustomerAccount(identity('sample-chef'),merchant),PortalAccessError);
  await assertFails(getDocs(collection(merchant,'days',day,'orders')));
  await assertFails(updateDoc(doc(merchant,'merchantUsers','sample-chef'),{enabled:true,updatedBy:'sample-chef',updatedAt:serverTimestamp()}));
 });
 }finally{await env.cleanup();}
});
