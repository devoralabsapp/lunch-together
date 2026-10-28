import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initializeApp,deleteApp,type FirebaseApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInAnonymously,signInWithCredential,GoogleAuthProvider} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,getDoc,getDocs,setDoc,updateDoc,deleteDoc,collection,serverTimestamp,Timestamp,terminate,type Firestore} from 'firebase/firestore';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {MealClient} from '../lib/meal-client';
import {publicWorkspace,nameId} from '../lib/meal-client-model';
import {syncUserProfile,listManagedUsers,updateManagedUser,deleteManagedUser} from '../lib/user-management';
import {savePersonalProfile,emptyDetails} from '../lib/organization';
import {deleteManagedUserApi} from '../lib/user-deletion-api';
import {assertCustomerAccount,PortalAccessError} from '../lib/portal-access';
import {PRIMARY_ADMIN_UID} from '../lib/user-model';

test('administrators edit profiles and server deletes only accounts with no order history',{timeout:180000},async t=>{
 const project='demo-datcom-tests',[host,port]=process.env.FIRESTORE_EMULATOR_HOST!.split(':'),apps:FirebaseApp[]=[],databases:Firestore[]=[];
 const environment=await initializeTestEnvironment({projectId:project,firestore:{host,port:Number(port),rules:fs.readFileSync('firestore.rules','utf8')}});
 await environment.clearFirestore();
 const date='2099-01-01',dayId='day-'+date,menu=[{name:'Sample lunch',price:40000}];
 const source=publicWorkspace({days:[],importedAt:'',demo:true});
 async function client(name:string,google=false){
  const app=initializeApp({projectId:project,apiKey:'fake-api-key'},name);apps.push(app);const auth=getAuth(app);connectAuthEmulator(auth,'http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST,{disableWarnings:true});
  if(google){const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');const token=encode({alg:'none',typ:'JWT'})+'.'+encode({iss:'https://accounts.google.com',aud:'test-client',sub:name,email:name+'@example.test',email_verified:true,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})+'.';await signInWithCredential(auth,GoogleAuthProvider.credential(token));}else await signInAnonymously(auth);
  const db=getFirestore(app);connectFirestoreEmulator(db,host,Number(port));databases.push(db);return new MealClient(auth,db,source);
 }
 const uid=(c:MealClient)=>c.auth.currentUser!.uid;
 const rawFetch=globalThis.fetch;
 try{
 const admin=await client('sample-admin',true),regular=await client('sample-google',true),unused=await client('sample-unused'),ordered=await client('sample-ordered'),cancelled=await client('sample-cancelled'),transferred=await client('sample-transfer'),service=await client('sample-service'),otherAdmin=await client('sample-other-admin',true);
 await environment.withSecurityRulesDisabled(async c=>{const db=c.firestore() as unknown as Firestore;for(const id of [uid(admin),uid(otherAdmin)])await setDoc(doc(db,'admins',id),{enabled:true});await setDoc(doc(db,'paymentIntegrations',uid(service)),{enabled:true});});
 for(const c of [admin,regular,unused,ordered,cancelled,transferred,otherAdmin])await syncUserProfile(c,'Sample '+uid(c).slice(0,5));
 await savePersonalProfile(unused,{...emptyDetails,preferredName:'Sample unused'});
 await admin.write({action:'day',create:true,date,menu,status:'open'});
 const env={NODE_ENV:'test',NEXT_PUBLIC_FIREBASE_PROJECT_ID:project,NEXT_PUBLIC_FIREBASE_API_KEY:'fake-api-key',PAYMENT_FIREBASE_REFRESH_TOKEN:service.auth.currentUser!.refreshToken,FIREBASE_AUTH_EMULATOR_HOST:process.env.FIREBASE_AUTH_EMULATOR_HOST,FIRESTORE_EMULATOR_HOST:process.env.FIRESTORE_EMULATOR_HOST};
 async function api(target:string,caller=admin){return deleteManagedUserApi(new Request('http://localhost/api/admin/users/delete',{method:'POST',headers:{Authorization:'Bearer '+await caller.auth.currentUser!.getIdToken(),'Content-Type':'application/json'},body:JSON.stringify({uid:target})}),env);}
 const deleteRequest:typeof fetch=async(input,init)=>deleteManagedUserApi(new Request('http://localhost'+String(input),init),env);
 await t.test('admins edit names and contact fields without rewriting identity or prior login time',async()=>{
  const before=(await getDoc(doc(admin.db,'userProfiles',uid(regular)))).data()!;
  await updateManagedUser(admin,uid(regular),{...emptyDetails,preferredName:'New sample name',phone:'+84 000 000',jobTitle:'Sample analyst'});
  const after=(await getDoc(doc(admin.db,'userProfiles',uid(regular)))).data()!;
  assert.equal(after.preferredName,'New sample name');for(const field of ['email','provider'])assert.equal(after[field],before[field]);for(const field of ['createdAt','lastSeenAt'])assert.equal(after[field].toMillis(),before[field].toMillis());
  const detail=(await getDoc(doc(admin.db,'personalDetails',uid(regular)))).data()!;assert.equal(detail.phone,'+84 000 000');assert.equal(detail.jobTitle,'Sample analyst');
 });
 await t.test('ordinary accounts cannot edit others; admin edits cannot alter email, provider, schema or invalid contact data',async()=>{
  await assert.rejects(updateManagedUser(regular,uid(unused),{...emptyDetails,preferredName:'Forbidden'}));
  const ref=doc(admin.db,'userProfiles',uid(regular));for(const fields of [{email:'forged@example.test'},{provider:'anonymous'},{admin:true},{preferredName:'x'.repeat(101)},{lastSeenAt:serverTimestamp()}])await assertFails(updateDoc(ref,fields));
  await assertFails(updateDoc(doc(admin.db,'personalDetails',uid(regular)),{phone:'invalid@email.test',updatedAt:serverTimestamp()}));
  await assert.rejects(updateManagedUser(admin,uid(otherAdmin),{...emptyDetails,preferredName:'Forbidden admin edit'}));
 });
 await t.test('anonymous/non-admin calls, missing authentication, self, primary admin and active admins are rejected',async()=>{
  assert.equal((await deleteManagedUserApi(new Request('http://localhost/delete',{method:'POST'}),env)).status,401);
  assert.equal((await api(uid(unused),regular)).status,403);assert.equal((await api(uid(unused),unused)).status,403);
  for(const id of [uid(admin),PRIMARY_ADMIN_UID,uid(otherAdmin)])assert.equal((await api(id)).status,409);
  assert.equal((await api('../bad/path')).status,400);
 });
 await t.test('browser administrators cannot directly delete profiles or forge a deleted state',async()=>{
  await assertFails(deleteDoc(doc(admin.db,'userProfiles',uid(unused))));await assertFails(deleteDoc(doc(admin.db,'personalDetails',uid(unused))));
  await assertFails(setDoc(doc(admin.db,'userAccess',uid(unused)),{blocked:true,deleted:true,deletedBy:uid(admin),deletedAt:serverTimestamp(),deletionToken:'a'.repeat(32),updatedBy:uid(admin),updatedAt:serverTimestamp()}));
 });
 await t.test('any existing order blocks deletion and preserves the previous blocked state',async()=>{
  await ordered.write({action:'order',dayId,name:'Sample ordered',dish:menu[0].name});
  await setDoc(doc(admin.db,'userAccess',uid(ordered)),{blocked:true,updatedBy:uid(admin),updatedAt:serverTimestamp()});
  const result=await api(uid(ordered));assert.equal(result.status,409);assert.match((await result.json()).error,/đã từng đặt cơm/);
  const access=(await getDoc(doc(admin.db,'userAccess',uid(ordered)))).data()!;assert.equal(access.blocked,true);assert.equal(access.deletionToken,undefined);assert.equal((await getDoc(doc(admin.db,'userProfiles',uid(ordered)))).exists(),true);
 });
 await t.test('cancelled orders also block deletion although the active count is zero',async()=>{
  const view=await cancelled.write({action:'order',dayId,name:'Sample cancelled',dish:menu[0].name});await cancelled.write({action:'cancel',dayId,id:view.orders.find(o=>o.actor===uid(cancelled))!.id});
  const person=(await listManagedUsers(admin)).users.find(p=>p.uid===uid(cancelled))!;assert.equal(person.orderCount,0);assert.equal(person.hasOrderHistory,true);assert.equal((await api(uid(cancelled))).status,409);
 });
 await t.test('immutable ordering activity prevents deleting an account after its orders were transferred',async()=>{
  const view=await transferred.write({action:'order',dayId,name:'Sample transferred',dish:menu[0].name}),order=view.orders.find(o=>o.actor===uid(transferred))!;
  await environment.withSecurityRulesDisabled(async c=>{await updateDoc(doc(c.firestore() as unknown as Firestore,'days',dayId,'orders',order.id),{ownerId:uid(regular)});});
  assert.equal((await api(uid(transferred))).status,409);assert.equal((await getDoc(doc(admin.db,'userProfiles',uid(transferred)))).exists(),true);
 });
 await t.test('an existing order cannot be transferred out while deletion history is being checked',async()=>{
  await setDoc(doc(ordered.db,'accountLinks',uid(ordered)),{targetUid:uid(regular),createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+5*60000)});let checked=false;
  globalThis.fetch=async(input,init)=>{if(!checked&&String(input).includes('/days?pageSize=')){checked=true;await assertFails(updateDoc(doc(regular.db,'days',dayId,'orders',await nameId('Sample ordered')),{ownerId:uid(regular),updatedAt:serverTimestamp()}));}return rawFetch(input,init);};
  const result=await api(uid(ordered));globalThis.fetch=rawFetch;assert.equal(checked,true);assert.equal(result.status,409);assert.equal((await getDoc(doc(admin.db,'days',dayId,'orders',await nameId('Sample ordered')))).data()!.ownerId,uid(ordered));
 });
 await t.test('an unused account is deleted atomically, remains disabled and disappears from the directory',async()=>{
  await deleteManagedUser(admin,uid(unused),deleteRequest);
  for(const path of ['userProfiles','personalDetails'])assert.equal((await getDoc(doc(admin.db,path,uid(unused)))).exists(),false);
  const state=(await getDoc(doc(admin.db,'userAccess',uid(unused)))).data()!;assert.equal(state.deleted,true);assert.equal(state.deletedBy,uid(admin));assert.equal(state.blocked,true);
  assert.equal((await listManagedUsers(admin)).users.some(p=>p.uid===uid(unused)),false);await assert.rejects(assertCustomerAccount(unused.auth.currentUser!,unused.db),PortalAccessError);
  await assertFails(setDoc(doc(unused.db,'userProfiles',uid(unused)),{displayName:'Back',preferredName:'Back',email:'',provider:'anonymous',createdAt:serverTimestamp(),lastSeenAt:serverTimestamp()}));
  assert.equal((await api(uid(unused))).status,200);
 });
 await t.test('the deletion lock prevents a simultaneous on-behalf order and profile recreation',async()=>{
  const racing=await client('sample-race');await syncUserProfile(racing,'Sample race');let checked=false;
  globalThis.fetch=async(input,init)=>{
   if(!checked&&String(input).includes('/days?pageSize=')){checked=true;
    await assertFails(setDoc(doc(admin.db,'days',dayId,'orders',await nameId('Sample race')),{name:'Sample race',ownerId:uid(racing),dishId:await nameId(menu[0].name),dish:menu[0].name,price:40000,quantity:1,note:'',paid:false,cancelled:false,createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(doc(racing.db,'userProfiles',uid(racing)),{preferredName:'Changed',lastSeenAt:serverTimestamp()}));
   }
   return rawFetch(input,init);
  };
  const response=await api(uid(racing));globalThis.fetch=rawFetch;assert.equal(checked,true);assert.equal(response.status,200,JSON.stringify(await response.json()));
 });
 await t.test('deleting unused merchant profiles retains portal classification; service identities are protected',async()=>{
  const merchant=await client('sample-merchant',true);await syncUserProfile(merchant,'Sample merchant');
  await setDoc(doc(admin.db,'merchantUsers',uid(merchant)),{merchantId:'sample-restaurant',role:'manager',enabled:true,createdAt:serverTimestamp(),updatedBy:uid(admin),updatedAt:serverTimestamp()});
  assert.equal((await api(uid(merchant))).status,200);assert.equal((await getDoc(doc(admin.db,'merchantUsers',uid(merchant)))).exists(),true);assert.equal((await getDoc(doc(admin.db,'userAccess',uid(merchant)))).data()!.blocked,true);assert.equal((await api(uid(service))).status,409);
 });
 assert.ok((await getDocs(collection(admin.db,'activityLogs'))).docs.some(d=>d.data().kind==='user.update'));assert.ok((await getDocs(collection(admin.db,'activityLogs'))).docs.some(d=>d.data().kind==='user.delete'));
 }finally{globalThis.fetch=rawFetch;await Promise.all(databases.map(db=>terminate(db)));await Promise.all(apps.map(app=>deleteApp(app)));await environment.cleanup();}
});
