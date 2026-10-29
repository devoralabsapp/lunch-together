import {mealDayChangeCases} from './meal-day-change.cases';
import {exportBackupApi,verifyBackupApi} from '../lib/personal-backup-api';
import {applyCredit,chooseSurplus,creditBalances,CreditCoveredError} from '../lib/credit-client';
import {activityValue,recordActivity} from '../lib/activity';
import {readActivityPage,readActivityNames} from '../lib/activity-reader';
import {initializeOrganization,readOrganization,saveOrganizationItem,setOrganizationDefault,savePersonalProfile,readPersonalProfile,deleteOrganizationItem,resolveAffiliation} from '../lib/organization';
import {exportPersonalBackup as apiExport,importPersonalBackup as apiImport,parsePersonalBackup,readImportedBackup as apiReadImport,listPersonalImports,acknowledgeImport as apiAcknowledge} from '../lib/personal-backup';
import {summarizeStatistics} from '../lib/statistics';
import {orderFinance} from '../lib/order-finance';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initializeApp,deleteApp,type FirebaseApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInAnonymously,signInWithCredential,linkWithCredential,GoogleAuthProvider} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,getDoc,getDocs,collection,query,where,orderBy,limit,setDoc,updateDoc,deleteDoc,deleteField,writeBatch,serverTimestamp,Timestamp,terminate,setLogLevel,disableNetwork,enableNetwork,onSnapshot,type Firestore} from 'firebase/firestore';
import {initializeTestEnvironment,assertFails,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {MealClient} from '../lib/meal-client';
import type {Auth} from 'firebase/auth';
import {syncUserProfile,listManagedUsers,setUserAdmin,setUserBlocked} from '../lib/user-management';
import {PRIMARY_ADMIN_UID} from '../lib/user-model';
import {publicWorkspace,nameId} from '../lib/meal-client-model';
import {moveGuestOrders} from '../lib/client-auth';
import {readPickup,drawPickup} from '../lib/pickup-client';
import {pickupWeek,pickupDateOffset} from '../lib/pickup';
import {localNow} from '../lib/meal-client-model';
import {saveBankAccount,requestPayment,createPaymentIntegration,revokePaymentIntegration} from '../lib/payment-client';
import {bankWebhook,resumeGroupPayment} from '../lib/payment-webhook';
import {restaurantSummary} from '../lib/restaurant-summary';
import {createRestaurantShare,revokeRestaurantShare} from '../lib/restaurant-share-client';
import {createHash} from 'node:crypto';
import {requestPaymentGroup} from '../lib/payment-group-client';

setLogLevel('silent');
const project='demo-datcom-tests';
const source=publicWorkspace({days:[{id:'day-2099-01-01',date:'2099-01-01',label:'Ngày kiểm thử',status:'auto',source:false,menu:[{name:'Cơm mẫu',price:40000},{name:'Salad mẫu',price:50000}]}],importedAt:'2026-10-22',demo:true},new Date('2099-01-01T00:00:00+07:00'));
function googleToken(id:string,email=id+'@example.test'){
 const encode=(o:unknown)=>Buffer.from(JSON.stringify(o)).toString('base64url');
 return encode({alg:'none',typ:'JWT'})+'.'+encode({iss:'https://accounts.google.com',aud:'test-google-client',sub:id,email,email_verified:true,name:'Google Sample',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})+'.';
}

test('Web SDK and Security Rules enforce the complete meal flow',{timeout:240000},async t=>{
 assert.ok(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIREBASE_AUTH_EMULATOR_HOST,'Run npm test for local Firebase emulators.');
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST!.split(':');
 const environment=await initializeTestEnvironment({projectId:project,firestore:{host,port:Number(port),rules:fs.readFileSync('firestore.rules','utf8')}});
 await environment.clearFirestore();
 const apps:FirebaseApp[]=[],databases:Firestore[]=[];
 async function client(id:string,google?:string){
  const app=initializeApp({projectId:project,apiKey:'fake-api-key',authDomain:project+'.firebaseapp.com'},id);apps.push(app);
  const auth=getAuth(app);connectAuthEmulator(auth,'http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST,{disableWarnings:true});
  const db=getFirestore(app);connectFirestoreEmulator(db,host,Number(port));databases.push(db);
  if(google)await signInWithCredential(auth,GoogleAuthProvider.credential(googleToken(google)));else await signInAnonymously(auth);
  return new MealClient(auth,db,source);
 }
 let backupService:MealClient|undefined;
 async function backupEnv(){if(!backupService){backupService=await client('backup-service');await environment.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore() as unknown as Firestore,'paymentIntegrations',backupService!.auth.currentUser!.uid),{enabled:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});});}return {NODE_ENV:'test',NEXT_PUBLIC_FIREBASE_PROJECT_ID:project,NEXT_PUBLIC_FIREBASE_API_KEY:'fake-api-key',PAYMENT_FIREBASE_REFRESH_TOKEN:backupService.auth.currentUser!.refreshToken,FIRESTORE_EMULATOR_HOST:process.env.FIRESTORE_EMULATOR_HOST,FIREBASE_AUTH_EMULATOR_HOST:process.env.FIREBASE_AUTH_EMULATOR_HOST};}
 const backupRequest:typeof fetch=async(input,init)=>{const url=String(input),request=new Request(url.startsWith('/')?'http://localhost'+url:url,init),env=await backupEnv();return url.endsWith('/export')?exportBackupApi(request,env):verifyBackupApi(request,env);};
 const exportPersonalBackup=(c:MealClient)=>apiExport(c,backupRequest),importPersonalBackup=(c:MealClient,raw:string)=>apiImport(c,raw,backupRequest),readImportedBackup=(c:MealClient,id:string)=>apiReadImport(c,id,backupRequest),acknowledgeImport=(c:MealClient,id:string,note:string)=>apiAcknowledge(c,id,note,backupRequest);
 async function bootstrap(uid:string){await environment.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore() as unknown as Firestore,'admins',uid),{enabled:true});});}
 const dayId=source.day.id,menu=source.day.menu;
 const post=(c:MealClient,b:Record<string,unknown>)=>c.write({dayId,...b});
 try{
  const admin=await client('admin','admin-test'),a=await client('guest-a'),b=await client('guest-b');await bootstrap(admin.auth.currentUser!.uid);
  await t.test('default day stays today without publishing or falling back to another date',async()=>{
   const view=await a.read();assert.equal(view.day.date,localNow().date);assert.equal(view.storageReady,false);assert.deepEqual(view.day.menu,[]);assert.deepEqual(view.orders,[]);
   assert.equal((await getDoc(doc(a.db,'days',view.day.id))).exists(),false);
   assert.equal((await a.read(dayId)).day.id,dayId);
  });
  await t.test('all visitors can read meal orders without Google; roles stay private',async()=>{
   assert.equal((await a.read(dayId)).signedIn,false);assert.equal((await a.read(dayId)).admin,false);assert.deepEqual((await a.read(dayId)).orders,[]);
   await assertFails(setDoc(doc(a.db,'admins',a.auth.currentUser!.uid),{enabled:true}));
   await assertFails(setDoc(doc(admin.db,'admins',b.auth.currentUser!.uid),{enabled:true}));
   await assert.rejects(post(a,{action:'day',menu,status:'open'}));
   const opened=await post(admin,{action:'day',menu,status:'open',date:source.day.date});assert.equal(opened.storageReady,true);assert.equal(opened.admin,true);
   const w=await post(a,{action:'order',name:'Khách mẫu A',dish:menu[0].name,quantity:2,paid:true,price:1,ownerId:admin.auth.currentUser!.uid});
   assert.equal(w.orders[0].price,40000);assert.equal(w.orders[0].paid,false);assert.equal(w.orders[0].actor,a.auth.currentUser!.uid);assert.deepEqual(w.members,[]);assert.equal(w.sourceUrl,'');
   const shared=await b.read(dayId);assert.equal(shared.orders.length,1);assert.equal(shared.orders[0].canEdit,false);assert.equal(w.orders[0].canEdit,true);
   assert.equal((await getDocs(collection(b.db,'days',dayId,'orders'))).size,1);
   assert.equal((await getDoc(doc(b.db,'days',dayId,'orders',w.orders[0].id))).data()?.name,w.orders[0].name);
   await assertFails(getDocs(collection(b.db,'admins')));
   await assertFails(getDoc(doc(b.db,'admins',admin.auth.currentUser!.uid)));
   await assertFails(getDoc(doc(b.db,'accountLinks',a.auth.currentUser!.uid)));
   const unauth=environment.unauthenticatedContext().firestore() as unknown as Firestore;
   await assertFails(getDoc(doc(unauth,'days',dayId)));await assertFails(getDocs(collection(unauth,'days',dayId,'orders')));await assertFails(getDoc(doc(unauth,'settings','payment')));
  });
  const order=(await a.read(dayId)).orders[0],ref=doc(a.db,'days',dayId,'orders',order.id);
  await t.test('direct SDK attacks cannot change ownership, prices, payment, schema or timestamps',async()=>{
   for(const fields of [{ownerId:b.auth.currentUser!.uid},{price:1000},{quantity:0},{quantity:31},{quantity:1.5},{note:'x'.repeat(301)},{paid:true},{isAdmin:true},{name:'Hacked'},{createdAt:Timestamp.fromMillis(0)},{updatedAt:Timestamp.fromMillis(0)},{note:deleteField()},{dish:'Fake dish'}]){
    await assertFails(updateDoc(ref,{...fields,...('updatedAt' in fields?{}:{updatedAt:serverTimestamp()})}));
   }
   const other=doc(b.db,'days',dayId,'orders',order.id);await assertFails(updateDoc(other,{note:'hacked',updatedAt:serverTimestamp()}));await assertFails(updateDoc(other,{cancelled:true,paid:false,updatedAt:serverTimestamp()}));await assertFails(updateDoc(other,{paid:true,updatedAt:serverTimestamp()}));await assertFails(deleteDoc(other));await assertFails(deleteDoc(ref));
   await assert.rejects(post(b,{action:'order',id:order.id,name:order.name,dish:order.dish,note:'not mine'}));await assert.rejects(post(b,{action:'cancel',id:order.id}));
   const original=(await getDoc(ref)).data()!;
   const newId=await nameId('Forged');
   for(const fields of [{ownerId:a.auth.currentUser!.uid},{price:1},{paid:true},{quantity:-1},{extra:true},{cancelled:true}])await assertFails(setDoc(doc(b.db,'days',dayId,'orders',newId),{...original,name:'Forged',ownerId:b.auth.currentUser!.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),...fields}));
   await assertFails(setDoc(doc(a.db,'days',dayId,'dishes',await nameId(menu[0].name)),{name:menu[0].name,price:1000,active:true,updatedAt:serverTimestamp()}));
   await assertFails(setDoc(doc(a.db,'mealOrders','legacy'),{orders:{private:'blocked'}}));
  });
  await t.test('admin payments, edits and menu price changes preserve order integrity',async()=>{
   await post(admin,{action:'paid',id:order.id,paid:true});
   const changedMenu=[{...menu[0],price:45000},menu[1]];await post(admin,{action:'day',menu:changedMenu,status:'open'});
   const note=await post(a,{action:'order',id:order.id,name:order.name,dish:order.dish,quantity:2,note:'Ít cơm'});assert.equal(note.orders[0].price,40000);assert.equal(note.orders[0].paid,true);
   const qty=await post(a,{action:'order',id:order.id,name:order.name,dish:order.dish,quantity:1});assert.equal(qty.orders[0].paid,true);assert.equal(qty.orders[0].receivedAmount,80000);
   const dish=await post(a,{action:'order',id:order.id,name:order.name,dish:menu[1].name,quantity:1});assert.equal(dish.orders[0].price,50000);
   assert.equal((await post(admin,{action:'order',id:order.id,name:order.name,dish:menu[1].name,quantity:3})).orders.find(o=>o.id===order.id)?.quantity,3);
   const dayRef=doc(admin.db,'days',dayId);
   await assertFails(updateDoc(dayRef,{cutoffAt:Timestamp.fromMillis(0),updatedAt:serverTimestamp()}));
   await assertFails(updateDoc(dayRef,{status:'invalid',updatedAt:serverTimestamp()}));
   await assertFails(updateDoc(dayRef,{label:deleteField(),updatedAt:serverTimestamp()}));
   const paidRef=doc(admin.db,'settings','payment');await setDoc(paidRef,{qrUrl:'https://example.test/qr.png',updatedAt:serverTimestamp()});assert.equal((await a.read(dayId)).paymentAvailable,true);
   await assertFails(updateDoc(paidRef,{qrUrl:'javascript:alert(1)',updatedAt:serverTimestamp()}));await assertFails(updateDoc(doc(a.db,'settings','payment'),{qrUrl:'https://fake.test',updatedAt:serverTimestamp()}));
  });
  await t.test('concurrent duplicate names are rejected atomically and clock bypasses fail',async()=>{
   const result=await Promise.allSettled([post(a,{action:'order',name:'Đặt trùng mẫu',dish:menu[0].name}),post(b,{action:'order',name:'đặt trùng mẫu',dish:menu[0].name})]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
   await post(admin,{action:'day',menu,status:'closed'});
   await assert.rejects(post(a,{action:'order',id:order.id,name:order.name,dish:order.dish}));
   await assertFails(updateDoc(ref,{note:'clock bypass',updatedAt:serverTimestamp()}));await assertFails(updateDoc(ref,{cancelled:true,paid:false,updatedAt:serverTimestamp()}));
   const original=(await getDoc(ref)).data()!;await assertFails(setDoc(doc(a.db,'days',dayId,'orders',await nameId('After cutoff')),{...original,name:'After cutoff',createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
   await post(admin,{action:'paid',id:order.id,paid:true});
   await post(admin,{action:'day',menu,status:'open'});await post(a,{action:'cancel',id:order.id});assert.equal((await a.read(dayId)).orders.some(o=>o.id===order.id),false);
   await post(a,{action:'order',name:order.name,dish:menu[0].name});
   await post(admin,{action:'day',create:true,date:'2000-01-01',menu,status:'auto'});
   await assert.rejects(a.write({dayId:'day-2000-01-01',action:'order',name:'Past day',dish:menu[0].name}));
  });
  await t.test('Google links new accounts without losing anonymous orders; other devices see them',async()=>{
   const uid=a.auth.currentUser!.uid;await linkWithCredential(a.auth.currentUser!,GoogleAuthProvider.credential(googleToken('linked-google')));assert.equal(a.auth.currentUser!.uid,uid);
   assert.ok((await a.read(dayId)).orders.some(o=>o.id===order.id));assert.equal((await a.read(dayId)).signedIn,true);
   const device=await client('second-device','linked-google');assert.equal(device.auth.currentUser!.uid,uid);assert.equal((await device.read(dayId)).orders.find(o=>o.id===order.id)?.canEdit,true);
  });
  await t.test('existing Google account merges require a source-authorized, expiring ticket',async()=>{
   const guest=await client('merge-guest'),target=await client('merge-google','merge-target');
   const placed=await post(guest,{action:'order',name:'Merge sample',dish:menu[0].name}),o=placed.orders.find(x=>x.name==='Merge sample')!,guestUid=guest.auth.currentUser!.uid,targetUid=target.auth.currentUser!.uid;
   const targetRef=doc(target.db,'days',dayId,'orders',o.id);
   await assertFails(updateDoc(targetRef,{ownerId:targetUid,updatedAt:serverTimestamp()}));
   await assertFails(setDoc(doc(b.db,'accountLinks',guestUid),{targetUid,createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+300000)}));
   await assertFails(setDoc(doc(guest.db,'accountLinks',guestUid),{targetUid,createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+86400000)}));
   await setDoc(doc(guest.db,'accountLinks',guestUid),{targetUid,createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+300000)});
   await assertFails(updateDoc(doc(guest.db,'accountLinks',guestUid),{targetUid:b.auth.currentUser!.uid}));
   await assertFails(updateDoc(targetRef,{ownerId:targetUid,paid:true,updatedAt:serverTimestamp()}));
   await post(admin,{action:'day',menu,status:'closed'});
   await moveGuestOrders(target.db,guestUid,targetUid);assert.equal((await getDoc(targetRef)).data()?.ownerId,targetUid);assert.equal((await getDoc(doc(guest.db,'days',dayId,'orders',o.id))).data()?.ownerId,targetUid);await assertFails(updateDoc(doc(guest.db,'days',dayId,'orders',o.id),{note:'old owner',updatedAt:serverTimestamp()}));
   assert.equal((await getDoc(doc(guest.db,'accountLinks',guestUid))).exists(),false);
   await post(admin,{action:'day',menu,status:'open'});
  });
  await t.test('unverified or non-Google identities cannot use admin membership',async()=>{
   for(const [uid,provider,verified] of [['fake-admin','anonymous',true],['unverified-admin','google.com',false],['password-admin','password',true]] as const){
    await bootstrap(uid);const db=environment.authenticatedContext(uid,{email:'test@example.test',email_verified:verified,firebase:{sign_in_provider:provider}}).firestore() as unknown as Firestore;
    assert.ok((await getDocs(collection(db,'days',dayId,'orders'))).size>0);await assertFails(updateDoc(doc(db,'days',dayId),{status:'closed',updatedAt:serverTimestamp()}));
   }
  });
  await t.test('expired handoffs, anonymous recipients and orphaned records stay blocked',async()=>{
   const guest=await client('expired-source'),target=await client('expired-target','expired-google');
   const w=await post(guest,{action:'order',name:'Expiry sample',dish:menu[0].name}),o=w.orders.find(x=>x.name==='Expiry sample')!,uid=guest.auth.currentUser!.uid;
   const ticket=doc(guest.db,'accountLinks',uid);
   await setDoc(ticket,{targetUid:b.auth.currentUser!.uid,createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+300000)});
   await assertFails(updateDoc(doc(b.db,'days',dayId,'orders',o.id),{ownerId:b.auth.currentUser!.uid,updatedAt:serverTimestamp()}));await deleteDoc(ticket);
   await environment.withSecurityRulesDisabled(async c=>{
    const db=c.firestore() as unknown as Firestore;
    await setDoc(doc(db,'accountLinks',uid),{targetUid:target.auth.currentUser!.uid,createdAt:Timestamp.fromMillis(0),expiresAt:Timestamp.fromMillis(1)});
    await setDoc(doc(db,'days','orphan','orders',o.id),(await getDoc(doc(db,'days',dayId,'orders',o.id))).data()!);
   });
   await assertFails(updateDoc(doc(target.db,'days',dayId,'orders',o.id),{ownerId:target.auth.currentUser!.uid,updatedAt:serverTimestamp()}));
   await assertFails(getDoc(doc(guest.db,'days','orphan','orders',o.id)));await assertFails(getDocs(collection(admin.db,'days','orphan','dishes')));
   await deleteDoc(doc(target.db,'accountLinks',uid));
  });
  await t.test('all visitors see the same statistics across days, excluding cancelled orders',async()=>{
   const guest=await client('statistics-guest'),other=await client('statistics-other');
   await post(admin,{action:'day',create:true,date:'2099-01-02',menu,status:'open'});
   await post(guest,{action:'order',name:'Thống kê ngày một',dish:menu[0].name,quantity:2});
   await guest.write({dayId:'day-2099-01-02',action:'order',name:'Thống kê ngày hai',dish:menu[1].name,quantity:1});
   const cancelled=await other.write({dayId:'day-2099-01-02',action:'order',name:'đơn thống kê đã hủy',dish:menu[0].name});
   await other.write({dayId:'day-2099-01-02',action:'cancel',id:cancelled.orders.find(x=>x.name==='đơn thống kê đã hủy')!.id});
   const shared=await guest.statistics(),sample=shared.filter(o=>o.name.startsWith('Thống kê ngày'));assert.equal(sample.length,2);assert.equal(sample.reduce((s,o)=>s+o.amount,0),130000);assert.deepEqual(new Set(sample.map(o=>o.date)),new Set(['2099-01-01','2099-01-02']));
   assert.deepEqual(await other.statistics(),shared);assert.deepEqual(await admin.statistics(),shared);
   const googleViewer=await client('statistics-google-viewer','statistics-google');assert.equal((await googleViewer.read(dayId)).admin,false);assert.deepEqual(await googleViewer.statistics(),shared);
   const otherView=await other.read('day-2099-01-02');assert.equal(otherView.orders.find(o=>o.name==='Thống kê ngày hai')?.canEdit,false);
   await assert.rejects(other.write({dayId:'day-2099-01-02',action:'cancel',id:otherView.orders.find(o=>o.name==='Thống kê ngày hai')!.id}));
   const all=await admin.statistics();assert.ok(all.some(o=>o.name==='Thống kê ngày một'));assert.ok(all.some(o=>o.name==='Thống kê ngày hai'));assert.equal(all.some(o=>o.name==='đơn thống kê đã hủy'),false);
  });
  await t.test('pickup draws balance weekly turns, serialize concurrent spins and keep immutable history',async()=>{
   const today=localNow().date,pickupDay='day-'+today,week=pickupWeek(today),players=[];
   await admin.write({action:'day',create:true,date:today,menu,status:'open'});
   for(let i=0;i<6;i++){const player=await client('pickup-player-'+i);players.push(player);await player.write({dayId:pickupDay,action:'order',name:'Pickup '+i,dish:menu[0].name,quantity:i===0?3:1});}
   if(today!==week.start)await environment.withSecurityRulesDisabled(async c=>{const selected=[{key:'pickup 0',name:'Pickup 0',previousCount:0},{key:'pickup 1',name:'Pickup 1',previousCount:0}];await setDoc(doc(c.firestore() as unknown as Firestore,'pickupDraws',pickupDateOffset(today,-1)),{date:pickupDateOffset(today,-1),weekStart:week.start,dayId:'sample-prior-day',count:2,candidateCount:6,selectedNames:selected.map(p=>p.name),previousCounts:selected.map(p=>p.previousCount),selectedKeys:selected.map(p=>p.key),createdAt:Timestamp.now(),createdBy:admin.auth.currentUser!.uid,version:1});});
   const state=await readPickup(players[0],pickupDay);assert.equal(state.candidates.length,6);assert.equal(state.draw,null);assert.equal(state.candidates.find(p=>p.key==='pickup 0')?.weeklyCount,today===week.start?0:1);
   await assert.rejects(drawPickup(players[0],pickupDay,2));await assert.rejects(drawPickup(admin,pickupDay,7));assert.equal((await admin.read(pickupDay)).day.status,'open');
   const ref=doc(admin.db,'pickupDraws',today),selected=[{key:'pickup 2',name:'Pickup 2',previousCount:0},{key:'pickup 3',name:'Pickup 3',previousCount:0}];
   const base={date:today,weekStart:week.start,dayId:pickupDay,count:2,candidateCount:6,selectedNames:selected.map(p=>p.name),previousCounts:selected.map(p=>p.previousCount),selectedKeys:selected.map(p=>p.key),createdAt:serverTimestamp(),createdBy:admin.auth.currentUser!.uid,version:1};
   await assertFails(setDoc(ref,base)); // Must close the order roster first.
   await admin.write({dayId:pickupDay,action:'day',menu,status:'closed'});
   await assertFails(setDoc(doc(players[0].db,'pickupDraws',today),{...base,createdBy:players[0].auth.currentUser!.uid}));
   for(const extra of [{createdBy:players[0].auth.currentUser!.uid},{createdAt:Timestamp.fromMillis(0)},{count:21},{count:0},{selectedKeys:['pickup 2','pickup 2']},{extra:true},{weekStart:pickupDateOffset(week.start,1)},{selectedNames:['x'.repeat(101),selected[1].name]},{previousCounts:[-1,0]}])await assertFails(setDoc(ref,{...base,...extra}));
   // The largest supported result validates every list element, including the last.
   for(const extra of [{dayId:'missing-pickup-day'},{selectedNames:[42,'Pickup 3']},{previousCounts:[.5,0]},{selectedKeys:['pickup 2',42]}])await assertFails(setDoc(ref,{...base,...extra}));
   const ten=Array.from({length:10},(_,i)=>({key:'fixture '+i,name:'Fixture '+i,previousCount:0}));
   await assertFails(setDoc(ref,{...base,count:10,candidateCount:10,selectedNames:[...ten.slice(0,9).map(p=>p.name),'x'.repeat(101)],previousCounts:ten.map(p=>p.previousCount),selectedKeys:ten.map(p=>p.key)}));
   try{await setDoc(ref,{...base,count:10,candidateCount:10,selectedNames:ten.map(p=>p.name),previousCounts:ten.map(p=>p.previousCount),selectedKeys:ten.map(p=>p.key)});}catch(e){throw new Error('Ten-person result validation failed: '+(e as Error).message);}
   await environment.withSecurityRulesDisabled(async c=>{await deleteDoc(doc(c.firestore() as unknown as Firestore,'pickupDraws',today));});
   await admin.write({dayId:pickupDay,action:'day',menu,status:'open'});
   const [first,second]=await Promise.all([drawPickup(admin,pickupDay,2),drawPickup(admin,pickupDay,2)]);
   assert.deepEqual(first.draw.selectedKeys,second.draw.selectedKeys);assert.equal(Number(first.created)+Number(second.created),1);assert.equal(first.draw.count,2);assert.equal(new Set(first.draw.selectedKeys).size,2);assert.ok(first.draw.selected.every(p=>p.previousCount===0));
   if(today!==week.start)assert.ok(first.draw.selected.every(p=>!['pickup 0','pickup 1'].includes(p.key)));
   const saved=await readPickup(players[0],pickupDay);assert.deepEqual(saved.draw?.selectedKeys,first.draw.selectedKeys);assert.equal(saved.history.filter(d=>d.date===today).length,1);assert.equal((await admin.read(pickupDay)).day.status,'closed');
   const replay=await drawPickup(admin,pickupDay,1);assert.equal(replay.created,false);assert.deepEqual(replay.draw.selectedKeys,first.draw.selectedKeys);
   await assertFails(updateDoc(ref,{count:1,updatedAt:serverTimestamp()}));await assertFails(deleteDoc(ref));await assertFails(deleteDoc(doc(players[0].db,'pickupDraws',today)));
   const unauth=environment.unauthenticatedContext().firestore() as unknown as Firestore;await assertFails(getDocs(collection(unauth,'pickupDraws')));
   const tomorrow=pickupDateOffset(today,1);await assertFails(setDoc(doc(admin.db,'pickupDraws',tomorrow),{...base,date:tomorrow,weekStart:pickupWeek(tomorrow).start}));
  });
  await t.test('user profiles stay private, validate identity and preserve own preferred names',async()=>{
   const guest=await client('profile-guest'),google=await client('profile-google','profile-google');
   await syncUserProfile(guest,'Khách nhớ tên');await syncUserProfile(google,'Tên Google');
   const uid=guest.auth.currentUser!.uid,ref=doc(guest.db,'userProfiles',uid),saved=(await getDoc(ref)).data()!;
   assert.equal(saved.preferredName,'Khách nhớ tên');assert.equal(saved.email,'');assert.equal(saved.provider,'anonymous');
   await assertFails(getDocs(collection(guest.db,'userProfiles')));await assertFails(getDoc(doc(google.db,'userProfiles',uid)));await assertFails(getDocs(collection(google.db,'userAccess')));
   await assert.rejects(listManagedUsers(guest));await assert.rejects(setUserBlocked(guest,google.auth.currentUser!.uid,true));
   for(const extra of [{isAdmin:true},{displayName:'x'.repeat(101)},{preferredName:42},{email:'forged@example.test'},{provider:'google.com'},{createdAt:Timestamp.fromMillis(0)},{lastSeenAt:Timestamp.fromMillis(0)}])await assertFails(updateDoc(ref,{...extra,...('lastSeenAt' in extra?{}:{lastSeenAt:serverTimestamp()})}));
   await assertFails(updateDoc(ref,{email:deleteField(),lastSeenAt:serverTimestamp()}));await assertFails(deleteDoc(ref));
   await assertFails(setDoc(doc(guest.db,'userProfiles',google.auth.currentUser!.uid),{...saved,createdAt:serverTimestamp(),lastSeenAt:serverTimestamp()}));
   const googleRef=doc(google.db,'userProfiles',google.auth.currentUser!.uid);await assertFails(updateDoc(googleRef,{email:'someone-else@example.test',lastSeenAt:serverTimestamp()}));
   await syncUserProfile(admin,'Tên quản trị riêng');await admin.write({action:'day',create:true,date:'2098-02-01',menu,status:'open'});
   const placed=await guest.write({dayId:'day-2098-02-01',action:'order',name:'Khách nhớ tên',dish:menu[0].name});
   await admin.write({dayId:'day-2098-02-01',action:'order',id:placed.orders[0].id,name:'Khách nhớ tên',dish:menu[0].name,quantity:2});
   assert.equal((await getDoc(doc(admin.db,'userProfiles',admin.auth.currentUser!.uid))).data()?.preferredName,'Tên quản trị riêng');
   const broken=new MealClient(guest.auth,guest.db,source);broken.read=async()=>{throw new Error('refresh unavailable');};
   await assert.rejects(broken.write({dayId:'day-2098-02-01',action:'order',name:'Tên lưu sau đặt',dish:menu[0].name}));
   assert.equal((await getDoc(ref)).data()?.preferredName,'Tên lưu sau đặt');
   assert.equal((await getDoc(doc(guest.db,'days','day-2098-02-01','orders',await nameId('Tên lưu sau đặt')))).exists(),true);
   const unauth=environment.unauthenticatedContext().firestore() as unknown as Firestore;await assertFails(getDocs(collection(unauth,'userProfiles')));await assertFails(getDoc(doc(unauth,'userAccess',uid)));
  });
  await t.test('primary-only roles and account blocks resist direct SDK and atomic batch bypasses',async()=>{
   const rootUid=PRIMARY_ADMIN_UID,claims={email:'primary@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}} as const;
   await bootstrap(rootUid);const db=environment.authenticatedContext(rootUid,claims).firestore() as unknown as Firestore;
   const rootUser={uid:rootUid,isAnonymous:false,email:claims.email,displayName:'Primary',getIdTokenResult:async()=>({claims:{email_verified:true},signInProvider:'google.com'})};
   const root=new MealClient({currentUser:rootUser,authStateReady:async()=>{}} as unknown as Auth,db,source);
   const google=await client('role-google','role-google'),guest=await client('role-guest');await syncUserProfile(root);await syncUserProfile(google,'Người quản lý mới');await syncUserProfile(guest,'Khách giới hạn');
   const uid=google.auth.currentUser!.uid,guestUid=guest.auth.currentUser!.uid,roleRef=doc(db,'admins',uid),role={enabled:true,updatedBy:rootUid,updatedAt:serverTimestamp()};
   await assert.rejects(setUserAdmin(admin,uid,true));await assert.rejects(setUserAdmin(root,guestUid,true));await assert.rejects(setUserAdmin(root,'unknown-user',true));
   await assertFails(setDoc(doc(admin.db,'admins',uid),{...role,updatedBy:admin.auth.currentUser!.uid}));await assertFails(setDoc(doc(google.db,'admins',uid),{...role,updatedBy:uid}));
   for(const extra of [{extra:true},{enabled:'yes'},{updatedBy:uid},{updatedAt:Timestamp.fromMillis(0)}])await assertFails(setDoc(roleRef,{...role,...extra}));
   await assertFails(updateDoc(doc(db,'admins',rootUid),{enabled:false,updatedBy:rootUid,updatedAt:serverTimestamp()}));await assertFails(deleteDoc(doc(db,'admins',rootUid)));
   await assert.rejects(setUserBlocked(root,rootUid,true));await assertFails(setDoc(doc(db,'userAccess',rootUid),{blocked:true,updatedBy:rootUid,updatedAt:serverTimestamp()}));
   const batch=writeBatch(db);batch.set(roleRef,role);batch.set(doc(db,'userAccess',uid),{blocked:true,updatedBy:rootUid,updatedAt:serverTimestamp()});await assertFails(batch.commit());
   await setUserAdmin(root,uid,true);assert.equal(await google.isAdmin(),true);assert.ok((await listManagedUsers(google)).users.some(p=>p.uid===rootUid));
   await assert.rejects(setUserBlocked(admin,uid,true));await assertFails(setDoc(doc(admin.db,'userAccess',uid),{blocked:true,updatedBy:admin.auth.currentUser!.uid,updatedAt:serverTimestamp()}));
   await assert.rejects(setUserAdmin(google,guestUid,true));
   await setUserAdmin(root,uid,false);assert.equal(await google.isAdmin(),false);
   const managedDay='day-2098-02-01',order=await google.write({dayId:managedDay,action:'order',name:'Đơn trước khóa',dish:menu[0].name});const own=order.orders.find(o=>o.actor===uid)!;
   await setUserBlocked(admin,uid,true);assert.equal((await google.read(managedDay)).blocked,true);
   await assert.rejects(google.write({dayId:managedDay,action:'order',name:'Đơn mới bị chặn',dish:menu[0].name}));
   const ref=doc(google.db,'days',managedDay,'orders',own.id),original=(await getDoc(ref)).data()!;
   await assertFails(updateDoc(ref,{note:'bypass',updatedAt:serverTimestamp()}));await assertFails(setDoc(doc(google.db,'days',managedDay,'orders',await nameId('Direct blocked')),{...original,name:'Direct blocked',createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
   await assertFails(setDoc(doc(google.db,'userAccess',uid),{blocked:false,updatedBy:uid,updatedAt:serverTimestamp()}));
   await assert.rejects(setUserAdmin(root,uid,true));
   await google.write({dayId:managedDay,action:'cancel',id:own.id});assert.equal((await getDoc(ref)).data()?.cancelled,true);
   await setUserBlocked(admin,uid,false);await google.write({dayId:managedDay,action:'order',name:'Đơn mở lại',dish:menu[0].name});
   const accessRef=doc(db,'userAccess',uid);for(const extra of [{blocked:1},{extra:true},{updatedBy:uid},{updatedAt:Timestamp.fromMillis(0)}])await assertFails(updateDoc(accessRef,{...extra,...('updatedAt' in extra?{}:{updatedAt:serverTimestamp()})}));await assertFails(deleteDoc(accessRef));
   await assert.rejects(listManagedUsers(google));const directory=await listManagedUsers(root);assert.equal(directory.canManageRoles,true);assert.ok(directory.users.some(p=>p.uid===uid&&p.orderCount>=1));assert.equal((await listManagedUsers(admin)).canManageRoles,false);
   await assertFails(getDocs(collection(guest.db,'admins')));await assertFails(getDoc(doc(guest.db,'userAccess',uid)));
  });
  await t.test('bank payments bind QR references and match raw BIDV notifications atomically through REST and Rules',async()=>{
   const payDay='day-2099-02-01',bank={bankBin:'970418',bankName:'BIDV',accountNumber:'000123456789',accountName:'NGUYEN VAN MAU'};
   await admin.write({action:'day',create:true,date:'2099-02-01',menu,status:'open'});
   const payer=await client('bank-payer'),other=await client('bank-other'),bot=await client('bank-bot');
   const uid=PRIMARY_ADMIN_UID;await bootstrap(uid);const rootDb=environment.authenticatedContext(uid,{email:'primary@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore() as unknown as Firestore;
   const root=new MealClient({app:admin.auth.app,currentUser:{uid,isAnonymous:false,email:'primary@example.test',getIdTokenResult:async()=>({claims:{email_verified:true},signInProvider:'google.com'})},authStateReady:async()=>{}} as unknown as Auth,rootDb,source);
   await assert.rejects(saveBankAccount(payer,bank));await saveBankAccount(admin,bank);
   assert.equal((await payer.read(payDay)).paymentAvailable,true);
   for(const extra of [{accountNumber:'../secret'},{bankBin:'BIDV'},{accountName:''},{extra:true},{updatedAt:Timestamp.fromMillis(0)}])await assertFails(setDoc(doc(payer.db,'settings','payment'),{...bank,updatedAt:serverTimestamp(),...extra}));
   await assertFails(setDoc(doc(admin.db,'settings','payment'),{...bank,accountName:'x'.repeat(71),updatedAt:serverTimestamp()}));
   const placed=await payer.write({action:'order',dayId:payDay,name:'Khách QR mẫu',dish:menu[0].name});let own=placed.orders.find(o=>o.actor===payer.auth.currentUser!.uid)!;
   await assert.rejects(requestPayment(other,payDay,own.id));
   const [intent,repeat]=await Promise.all([requestPayment(payer,payDay,own.id),requestPayment(payer,payDay,own.id)]);assert.equal(intent.reference,repeat.reference);assert.equal(intent.amount,40000);assert.ok(intent.description.includes(intent.reference));
   await assertFails(getDoc(doc(other.db,'paymentIntents',intent.reference)));await assertFails(getDocs(collection(payer.db,'paymentIntents')));
   const original=(await getDoc(doc(payer.db,'paymentIntents',intent.reference))).data()!;
   for(const extra of [{amount:1},{expiresAt:Timestamp.fromMillis(Date.now()+2*86400000)},{accountNumber:'9999'},{ownerId:other.auth.currentUser!.uid},{extra:true}]){
    const code='COM'+createHash('sha256').update(JSON.stringify(extra)).digest('hex').slice(0,20).toUpperCase(),batch=writeBatch(payer.db);
    batch.set(doc(payer.db,'paymentIntents',code),{...original,reference:code,description:code,createdAt:serverTimestamp(),...extra});batch.set(doc(payer.db,'paymentLinks',payDay,'orders',own.id),{reference:code,updatedAt:serverTimestamp()});await assertFails(batch.commit());
   }
   await assertFails(updateDoc(doc(payer.db,'paymentIntents',intent.reference),{amount:1}));await assertFails(deleteDoc(doc(payer.db,'paymentIntents',intent.reference)));
   await assertFails(setDoc(doc(payer.db,'paymentLinks',payDay,'orders',own.id),{reference:intent.reference,updatedAt:serverTimestamp()}));
   await assertFails(setDoc(doc(bot.db,'paymentIntegrations',bot.auth.currentUser!.uid),{enabled:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
   await setDoc(doc(rootDb,'paymentIntegrations',bot.auth.currentUser!.uid),{enabled:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
   const orderRef=doc(bot.db,'days',payDay,'orders',own.id);
   await assertFails(updateDoc(orderRef,{paid:true,updatedAt:serverTimestamp()}));await assertFails(updateDoc(doc(bot.db,'days',payDay),{status:'closed',updatedAt:serverTimestamp()}));
   await assertFails(setDoc(doc(bot.db,'paymentTransactions','a'.repeat(64)),{reference:intent.reference,createdAt:serverTimestamp()}));
   await assertFails(getDocs(collection(bot.db,'userProfiles')));await assertFails(setDoc(doc(bot.db,'admins',bot.auth.currentUser!.uid),{enabled:true}));
   async function forgedSettlement(extra:Record<string,unknown>,orderExtra:Record<string,unknown>={}){
    const receipt={reference:intent.reference,transactionId:'FAKE-DIRECT-ATTACK',amount:intent.amount,bankBin:bank.bankBin,accountNumber:bank.accountNumber,occurredAt:Timestamp.now(),notificationHash:'a'.repeat(64),createdBy:bot.auth.currentUser!.uid,createdAt:serverTimestamp(),...extra};
    const key=createHash('sha256').update(`${receipt.bankBin}|${receipt.accountNumber}|${receipt.transactionId}`.toLowerCase()).digest('hex'),batch=writeBatch(bot.db);
    batch.set(doc(bot.db,'paymentReceipts',intent.reference),{...receipt,transactionKey:key});batch.set(doc(bot.db,'paymentTransactions',key),{reference:intent.reference,createdAt:serverTimestamp()});batch.update(orderRef,{paid:true,updatedAt:serverTimestamp(),...orderExtra});await assertFails(batch.commit());assert.equal((await getDoc(orderRef)).data()?.paid,false);
   }
   for(const fields of [{amount:1},{accountNumber:'000000000001'},{bankBin:'970436'},{occurredAt:Timestamp.fromMillis(0)},{transactionId:'x'.repeat(121)},{notificationHash:'z'.repeat(64)},{createdBy:other.auth.currentUser!.uid},{extra:true}])await forgedSettlement(fields);
   await forgedSettlement({},{note:'bot cannot edit meals'});await forgedSettlement({},{quantity:2});
   const now=new Date(Date.now()+7*3600000).toISOString(),time=`${now.slice(11,19)} ${now.slice(8,10)}/${now.slice(5,7)}/${now.slice(0,4)}`;
   const raw=(code:string,amount=40000,transaction='FAKE-BANK-001',account=bank.accountNumber)=>`BIDV notice to customer\nTransaction Time: ${time}\nAccount thanh toán: ${account}\nTransaction Amount: +${amount.toLocaleString('en-US')} VND\nEnding Balance: 99,999,999 VND\nTransaction Details: Tien com ${code}\nTransaction Code: ${transaction}`;
   const secret='k'.repeat(64),env={NODE_ENV:'test',NEXT_PUBLIC_FIREBASE_PROJECT_ID:project,NEXT_PUBLIC_FIREBASE_API_KEY:'fake-api-key',PAYMENT_WEBHOOK_SECRET:secret,PAYMENT_FIREBASE_REFRESH_TOKEN:bot.auth.currentUser!.refreshToken,FIRESTORE_EMULATOR_HOST:process.env.FIRESTORE_EMULATOR_HOST,FIREBASE_AUTH_EMULATOR_HOST:process.env.FIREBASE_AUTH_EMULATOR_HOST};
   async function notify(text:string,options:Record<string,string>={}){const response=await bankWebhook(new Request('https://example.test/api/payments/bank-notification',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({notification:text})}),{...env,...options});const body=await response.json();return {httpStatus:response.status,...body};}
   assert.equal((await notify(raw(intent.reference,41000))).reason,'amount_mismatch');assert.equal((await notify(raw(intent.reference,40000,'FAKE-WRONG-ACCOUNT','999999999'))).reason,'account_mismatch');assert.equal((await getDoc(orderRef)).data()?.paid,false);
   const absent='COM'+('F'.repeat(20));assert.equal((await notify(raw(absent))).reason,'unknown_reference');
   const outcomes=await Promise.all([notify(raw(intent.reference)),notify(raw(intent.reference))]);assert.deepEqual(outcomes.map(o=>o.status).sort(),['duplicate','paid']);
   assert.equal((await getDoc(orderRef)).data()?.paid,true);assert.equal((await getDoc(doc(admin.db,'paymentReceipts',intent.reference))).data()?.amount,40000);assert.equal((await notify(raw(intent.reference))).reason,'reference_already_processed');
   await assertFails(updateDoc(doc(bot.db,'paymentReceipts',intent.reference),{amount:1}));await assertFails(deleteDoc(doc(bot.db,'paymentReceipts',intent.reference)));await assertFails(getDoc(doc(other.db,'paymentReceipts',intent.reference)));
   await admin.write({action:'paid',dayId:payDay,id:own.id,paid:false});await notify(raw(intent.reference));assert.equal((await getDoc(orderRef)).data()?.paid,false);
   const renewed=await requestPayment(payer,payDay,own.id);assert.notEqual(renewed.reference,intent.reference);assert.equal((await notify(raw(renewed.reference))).reason,'transaction_already_processed');assert.equal((await getDoc(orderRef)).data()?.paid,false);
   await payer.write({action:'order',dayId:payDay,id:own.id,name:own.name,dish:own.dish,quantity:2});assert.equal((await notify(raw(renewed.reference,40000,'FAKE-BANK-002'))).reason,'order_changed');
   const changed=await requestPayment(payer,payDay,own.id);assert.equal(changed.amount,80000);assert.notEqual(changed.reference,renewed.reference);assert.equal((await notify(raw(renewed.reference,40000,'FAKE-BANK-003'))).reason,'qr_replaced');
   await saveBankAccount(admin,{...bank,accountNumber:'000999999999'});assert.equal((await notify(raw(changed.reference,80000,'FAKE-BANK-004'))).reason,'payee_changed');await saveBankAccount(admin,bank);
   const fresh=await requestPayment(payer,payDay,own.id);await payer.write({action:'cancel',dayId:payDay,id:own.id});assert.equal((await notify(raw(fresh.reference,80000,'FAKE-BANK-005'))).reason,'order_cancelled');
   await payer.write({action:'order',dayId:payDay,name:own.name,dish:own.dish,quantity:1});const expired=await requestPayment(payer,payDay,own.id);
   await environment.withSecurityRulesDisabled(async c=>updateDoc(doc(c.firestore() as unknown as Firestore,'paymentIntents',expired.reference),{expiresAt:Timestamp.fromMillis(Date.now()-1000)}));assert.equal((await notify(raw(expired.reference,40000,'FAKE-BANK-006'))).reason,'qr_expired');
   const active=await requestPayment(payer,payDay,own.id);await revokePaymentIntegration(root,bot.auth.currentUser!.uid);assert.equal((await notify(raw(active.reference,40000,'FAKE-BANK-007'))).httpStatus,503);assert.equal((await getDoc(orderRef)).data()?.paid,false);
   const previousHost=process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=process.env.FIREBASE_AUTH_EMULATOR_HOST;
   try{const setup=await createPaymentIntegration(root);assert.equal(setup.secret.length,64);const configured=await notify(raw(active.reference,40000,'FAKE-BANK-008'),{PAYMENT_FIREBASE_REFRESH_TOKEN:setup.refreshToken});assert.equal(configured.reference,active.reference,JSON.stringify(configured));assert.equal((await getDoc(orderRef)).data()?.paid,true);await revokePaymentIntegration(root,setup.uid);}finally{if(previousHost===undefined)delete process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;else process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=previousHost;}
   const transferring=await client('bank-transfer-guest'),target=await client('bank-transfer-google','bank-transfer-google');
   const transferView=await transferring.write({action:'order',dayId:payDay,name:'QR chuyển tài khoản',dish:menu[0].name}),transferOrder=transferView.orders.find(o=>o.actor===transferring.auth.currentUser!.uid)!;
   const oldIntent=await requestPayment(transferring,payDay,transferOrder.id),from=transferring.auth.currentUser!.uid,to=target.auth.currentUser!.uid;
   await setDoc(doc(transferring.db,'accountLinks',from),{targetUid:to,createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+300000)});await moveGuestOrders(target.db,from,to);
   const transferredIntent=await requestPayment(target,payDay,transferOrder.id);assert.notEqual(transferredIntent.reference,oldIntent.reference);assert.equal(transferredIntent.ownerId,to);assert.equal(transferredIntent.amount,40000);
  });
  await t.test('Techcombank raw notices settle exact references once without bank time or transaction ID',async()=>{
   const payDay='day-2099-02-02',bank={bankBin:'970407',bankName:'Techcombank',accountNumber:'00012345678901',accountName:'NGUYEN VAN MAU'};
   await admin.write({action:'day',create:true,date:'2099-02-02',menu,status:'open'});await saveBankAccount(admin,bank);
   const payer=await client('tcb-payer'),bot=await client('tcb-bot');
   const rootDb=environment.authenticatedContext(PRIMARY_ADMIN_UID,{email:'primary@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore() as unknown as Firestore;
   await setDoc(doc(rootDb,'paymentIntegrations',bot.auth.currentUser!.uid),{enabled:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
   const placed=await payer.write({action:'order',dayId:payDay,name:'Khách TCB mẫu',dish:menu[0].name}),own=placed.orders.find(o=>o.actor===payer.auth.currentUser!.uid)!,intent=await requestPayment(payer,payDay,own.id);
   const orderRef=doc(payer.db,'days',payDay,'orders',own.id),secret='t'.repeat(64);
   const env={NODE_ENV:'test',NEXT_PUBLIC_FIREBASE_PROJECT_ID:project,NEXT_PUBLIC_FIREBASE_API_KEY:'fake-api-key',PAYMENT_WEBHOOK_SECRET:secret,PAYMENT_FIREBASE_REFRESH_TOKEN:bot.auth.currentUser!.refreshToken,FIRESTORE_EMULATOR_HOST:process.env.FIRESTORE_EMULATOR_HOST,FIREBASE_AUTH_EMULATOR_HOST:process.env.FIREBASE_AUTH_EMULATOR_HOST};
   const raw=(code=intent.reference,amount=40000,account=bank.accountNumber)=>`Account ${account}\nAmount: + ${amount.toLocaleString('en-US')}\nBalance: 39,184\nNGUYEN VAN MAU transfer ${code}`;
   const currencyFirst=(code=intent.reference,amount=40000)=>`+ VND ${amount.toLocaleString('en-US')}\nAccount: ${bank.accountNumber}\nBalance: VND 52,000\n${code}`;
   async function notify(text:string){const response=await bankWebhook(new Request('https://example.test/api/payments/bank-notification',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'text/plain'},body:text}),env);return {httpStatus:response.status,...await response.json()};}
   assert.equal((await notify(raw(''))).httpStatus,422);
   assert.equal((await notify(raw(intent.reference,30000))).reason,'amount_mismatch');
   assert.equal((await notify(raw(intent.reference,40000,'00011111111111'))).reason,'account_mismatch');
   assert.equal((await notify(raw().replace('+ 40,000','- 40,000'))).httpStatus,422);
   assert.equal((await notify(currencyFirst('',40000).repeat(4))).httpStatus,422);
   assert.equal((await notify(currencyFirst(intent.reference,50000).repeat(4))).reason,'amount_mismatch');
   assert.equal((await notify(currencyFirst()+currencyFirst(intent.reference,50000))).httpStatus,422);
   assert.equal((await getDoc(orderRef)).data()?.paid,false);
   const before=Date.now(),outcomes=await Promise.all([notify(currencyFirst().repeat(4)),notify(currencyFirst().replace(/\n/g,' '))]);
   assert.deepEqual(outcomes.map(o=>o.status).sort(),['duplicate','paid']);assert.equal((await getDoc(orderRef)).data()?.paid,true);
   const receipt=(await getDoc(doc(admin.db,'paymentReceipts',intent.reference))).data()!;
   assert.equal(receipt.amount,40000);assert.equal(receipt.bankBin,'970407');assert.match(receipt.transactionId,/^TCBNOTICE-[a-f0-9]{64}$/);assert.ok(receipt.occurredAt.toMillis()>=before&&receipt.occurredAt.toMillis()<=Date.now());assert.equal(receipt.notification,undefined);assert.equal(receipt.balance,undefined);
   await admin.write({action:'paid',dayId:payDay,id:own.id,paid:false});assert.equal((await notify(raw().toLowerCase())).status,'duplicate');assert.equal((await getDoc(orderRef)).data()?.paid,false);
   const renewed=await requestPayment(payer,payDay,own.id);
   await environment.withSecurityRulesDisabled(async c=>updateDoc(doc(c.firestore() as unknown as Firestore,'paymentIntents',renewed.reference),{expiresAt:Timestamp.fromMillis(Date.now()-1000)}));assert.equal((await notify(raw(renewed.reference))).reason,'qr_expired');assert.equal((await getDoc(orderRef)).data()?.paid,false);
  });

  await t.test('multi-dish carts commit atomically, preserve paid portions and transfer name ownership',async()=>{
   const payer=await client('cart-owner'),other=await client('cart-other'),d='day-2099-03-01';
   await admin.write({action:'day',create:true,date:'2099-03-01',menu,status:'open'});
   const cart={action:'order',dayId:d,name:'Người hai món',items:[{dish:menu[0].name,quantity:2},{dish:menu[1].name,quantity:3,note:'Ít sốt'}]};
   let view=await payer.write(cart);assert.equal(view.orders.length,2);assert.equal(view.orders.reduce((sum,o)=>sum+o.price*o.quantity,0),230000);
   await assert.rejects(other.write(cart));await assert.rejects(other.write({action:'order',dayId:d,name:cart.name,dish:menu[0].name}));
   const own=view.orders[0];await assertFails(updateDoc(doc(other.db,'days',d,'orders',own.id),{note:'forged',updatedAt:serverTimestamp()}));
   await assert.rejects(payer.write({...cart,items:[{dish:menu[0].name,quantity:1},{dish:'missing',quantity:1}]}));assert.equal((await payer.read(d)).orders.length,2);
   await admin.write({action:'paid',dayId:d,id:own.id,paid:true});
   view=await payer.write({...cart,items:[{dish:own.dish,quantity:2}]});assert.equal(view.orders.length,3);assert.equal(view.orders.find(o=>o.id===own.id)?.paid,true);
   const target=await client('cart-google','cart-google'),from=payer.auth.currentUser!.uid,to=target.auth.currentUser!.uid;
   await setDoc(doc(payer.db,'accountLinks',from),{targetUid:to,createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+300000)});await moveGuestOrders(target.db,from,to);
   view=await target.write({...cart,items:[{dish:menu[0].name,quantity:1}]});assert.ok(view.orders.every(o=>o.actor===to));
   assert.equal((await getDoc(doc(target.db,'days',d,'orderPeople',await nameId(cart.name)))).data()?.ownerId,to);
   const raceA=await client('cart-race-a'),raceB=await client('cart-race-b');
   const outcomes=await Promise.allSettled([raceA.write({...cart,name:'Tên đồng thời'}),raceB.write({...cart,name:'Tên đồng thời'})]);assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
  });
  await t.test('grouped payments cover many days, reject stale carts and resume settlement without replaying paid lines',async()=>{
   const payer=await client('group-owner'),other=await client('group-other'),bot=await client('group-bot'),refs:{dayId:string;orderId:string}[]=[];
   const bank={bankBin:'970407',bankName:'Techcombank',accountNumber:'00012345678901',accountName:'NGUYEN VAN MAU'};await saveBankAccount(admin,bank);
   for(let i=1;i<=6;i++){const date='2099-04-'+String(i).padStart(2,'0'),dayId='day-'+date;await admin.write({action:'day',create:true,date,menu,status:'open'});const view=await payer.write({action:'order',dayId,name:'Người thanh toán gộp',items:[{dish:menu[0].name,quantity:2},{dish:menu[1].name,quantity:1}]});refs.push(...view.orders.map(o=>({dayId,orderId:o.id})));}
   await assert.rejects(requestPaymentGroup(other,refs));
   let group=await requestPaymentGroup(payer,refs);assert.equal(group.count,12);assert.equal(group.amount,780000);assert.equal((await requestPaymentGroup(payer,refs)).reference,group.reference);
   const first=refs[0],firstRef=doc(payer.db,'days',first.dayId,'orders',first.orderId),order=(await getDoc(firstRef)).data()!;
   await assertFails(updateDoc(firstRef,{quantity:3,updatedAt:serverTimestamp()}));await assertFails(updateDoc(doc(payer.db,'paymentGroups',group.reference),{amount:1,updatedAt:serverTimestamp()}));
   await payer.write({action:'order',dayId:first.dayId,id:first.orderId,name:order.name,dish:order.dish,quantity:3});assert.equal((await getDoc(doc(payer.db,'paymentGroups',group.reference))).data()?.state,'invalid');
   group=await requestPaymentGroup(payer,refs);assert.equal(group.amount,820000);
   await bootstrap(PRIMARY_ADMIN_UID);const rootDb=environment.authenticatedContext(PRIMARY_ADMIN_UID,{email:'primary@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore() as unknown as Firestore;
   await setDoc(doc(rootDb,'paymentIntegrations',bot.auth.currentUser!.uid),{enabled:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
   await assertFails(updateDoc(doc(bot.db,'paymentGroups',group.reference),{state:'paid',updatedAt:serverTimestamp()}));await assertFails(updateDoc(doc(bot.db,'days',first.dayId,'orders',first.orderId),{paid:true,updatedAt:serverTimestamp()}));
   const secret='g'.repeat(64),env={NODE_ENV:'test',NEXT_PUBLIC_FIREBASE_PROJECT_ID:project,NEXT_PUBLIC_FIREBASE_API_KEY:'fake-api-key',PAYMENT_WEBHOOK_SECRET:secret,PAYMENT_FIREBASE_REFRESH_TOKEN:bot.auth.currentUser!.refreshToken,FIRESTORE_EMULATOR_HOST:process.env.FIRESTORE_EMULATOR_HOST,FIREBASE_AUTH_EMULATOR_HOST:process.env.FIREBASE_AUTH_EMULATOR_HOST};
   const raw=(amount=group.amount)=>'+ VND '+amount.toLocaleString('en-US')+'\nAccount: '+bank.accountNumber+'\nBalance: VND 900,000\n'+group.reference;
   async function notify(text=raw()){const response=await bankWebhook(new Request('https://example.test/api/payments/bank-notification',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'text/plain'},body:text}),env);return {http:response.status,...await response.json()};}
   assert.equal((await notify(raw(group.amount+1000))).reason,'amount_mismatch');
   const originalFetch=globalThis.fetch;let failed=false;
   globalThis.fetch=async(input,init)=>{if(!failed&&String(input).endsWith(':commit')&&String(init?.body).includes('paymentGroupSettlements')){failed=true;throw new Error('Injected transport failure');}return originalFetch(input,init);};
   try{assert.equal((await notify()).http,503);}finally{globalThis.fetch=originalFetch;}
   assert.equal((await getDoc(doc(payer.db,'paymentGroups',group.reference))).data()?.state,'paid');
   const blocked=await resumeGroupPayment(new Request('https://example.test/resume',{method:'POST',headers:{Authorization:'Bearer '+await other.auth.currentUser!.getIdToken()}}),group.reference,env);assert.equal(blocked.status,403);
   const recovered=await resumeGroupPayment(new Request('https://example.test/resume',{method:'POST',headers:{Authorization:'Bearer '+await payer.auth.currentUser!.getIdToken()}}),group.reference,env);assert.equal(recovered.status,200);assert.equal((await recovered.json()).status,'paid');
   const outcome=await notify();assert.equal(outcome.status,'duplicate');for(const ref of refs)assert.equal((await getDoc(doc(payer.db,'days',ref.dayId,'orders',ref.orderId))).data()?.paid,true);
   assert.equal((await getDocs(collection(payer.db,'paymentGroupSettlements',group.reference,'items'))).size,12);
   await admin.write({action:'paid',dayId:first.dayId,id:first.orderId,paid:false});assert.equal((await notify()).status,'duplicate');assert.equal((await getDoc(firstRef)).data()?.paid,false);
   await assertFails(deleteDoc(doc(bot.db,'paymentGroupSettlements',group.reference,'items',group.items[0].key)));
  });


  await t.test('restaurant links reveal only a snapshot, require admin creation and stop working after revocation or expiry',async()=>{
   const dayId='day-2099-03-01',view=await admin.read(dayId),summary=restaurantSummary(view.day.date,view.orders),share=await createRestaurantShare(admin,dayId,summary);
   const publicDb=environment.unauthenticatedContext().firestore() as unknown as Firestore,ref=doc(publicDb,'restaurantShares',share.token);
   const data=(await getDoc(ref)).data()!;assert.deepEqual(JSON.parse(data.payload),summary);assert.equal(data.payload.includes('Người hai món'),false);await assertFails(getDocs(collection(publicDb,'restaurantShares')));
   await assert.rejects(createRestaurantShare(a,dayId,summary));await assertFails(updateDoc(doc(a.db,'restaurantShares',share.token),{active:false}));
   await assertFails(updateDoc(doc(admin.db,'restaurantShares',share.token),{payload:'changed'}));
   await revokeRestaurantShare(admin,share.token);await assertFails(getDoc(ref));
   const expired=await createRestaurantShare(admin,dayId,summary);await environment.withSecurityRulesDisabled(async c=>updateDoc(doc(c.firestore() as unknown as Firestore,'restaurantShares',expired.token),{createdAt:Timestamp.fromMillis(Date.now()-8*86400000),expiresAt:Timestamp.fromMillis(Date.now()-86400000)}));await assertFails(getDoc(doc(publicDb,'restaurantShares',expired.token)));
  });


  await t.test('ten-line carts can update previously linked QRs without exceeding Rules access limits',async()=>{
   const payer=await client('cart-budget'),date='2099-05-01',dayId='day-'+date,largeMenu=Array.from({length:10},(_,i)=>({name:'Món số '+(i+1),price:40000}));
   await admin.write({action:'day',create:true,date,menu:largeMenu,status:'open'});
   const body={action:'order',dayId,name:'Giỏ mười món',items:largeMenu.map(m=>({dish:m.name,quantity:1}))};
   const placed=await payer.write(body);assert.equal(placed.orders.length,10);
   for(const order of placed.orders)await requestPayment(payer,dayId,order.id);
   const changed=await payer.write(body);assert.ok(changed.orders.every(o=>o.quantity===2));assert.equal(changed.orders.length,10);
  });


  await t.test('paid edits collect only differences and cancelled meals retain admin-confirmed refund history',async()=>{
   const payer=await client('finance-payer'),other=await client('finance-other'),bot=await client('finance-bot'),dayId='day-2099-06-01',name='Đối soát mẫu';
   const menu=[{name:'Món bốn mươi',price:40000},{name:'Món năm mươi',price:50000},{name:'Món sáu mươi',price:60000}];
   await admin.write({action:'day',create:true,date:'2099-06-01',menu,status:'open'});
   const placed=await payer.write({action:'order',dayId,name,dish:menu[1].name}),id=placed.orders[0].id,ref=doc(payer.db,'days',dayId,'orders',id);
   const read=async()=>orderFinance((await getDoc(ref)).data() as never);
   await admin.write({action:'paid',dayId,id,paid:true});assert.equal((await read()).receivedAmount,50000);
   await payer.write({action:'order',dayId,id,name,dish:menu[2].name});assert.equal((await read()).due,10000);assert.equal((await read()).receivedAmount,50000);
   for(const fields of [{receivedAmount:60000,paid:true},{receivedAmount:0},{refundedAmount:50000},{voidedAmount:50000},{paid:true}])await assertFails(updateDoc(ref,{...fields,updatedAt:serverTimestamp()}));
   const bank={bankBin:'970407',bankName:'Techcombank',accountNumber:'00012345678901',accountName:'NGUYEN VAN MAU'};await saveBankAccount(admin,bank);
   const single=await requestPayment(payer,dayId,id);assert.equal(single.amount,10000);
   await bootstrap(PRIMARY_ADMIN_UID);const rootDb=environment.authenticatedContext(PRIMARY_ADMIN_UID,{email:'primary@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore() as unknown as Firestore;
   await setDoc(doc(rootDb,'paymentIntegrations',bot.auth.currentUser!.uid),{enabled:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
   const secret='f'.repeat(64),env={NODE_ENV:'test',NEXT_PUBLIC_FIREBASE_PROJECT_ID:project,NEXT_PUBLIC_FIREBASE_API_KEY:'fake-api-key',PAYMENT_WEBHOOK_SECRET:secret,PAYMENT_FIREBASE_REFRESH_TOKEN:bot.auth.currentUser!.refreshToken,FIRESTORE_EMULATOR_HOST:process.env.FIRESTORE_EMULATOR_HOST,FIREBASE_AUTH_EMULATOR_HOST:process.env.FIREBASE_AUTH_EMULATOR_HOST};
   async function notify(reference:string,amount:number){const response=await bankWebhook(new Request('https://example.test/api/payments/bank-notification',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'text/plain'},body:'+ VND '+amount.toLocaleString('en-US')+'\nAccount: '+bank.accountNumber+'\nBalance: VND 900,000\n'+reference}),env);return {http:response.status,...await response.json()};}
   assert.equal((await notify(single.reference,60000)).reason,'amount_mismatch');assert.equal((await notify(single.reference,10000)).status,'paid');assert.equal((await read()).receivedAmount,60000);assert.equal((await read()).due,0);
   await payer.write({action:'order',dayId,id,name,dish:menu[0].name});assert.equal((await read()).refundDue,20000);assert.equal((await getDoc(ref)).data()?.paid,true);await assert.rejects(requestPayment(payer,dayId,id));
   await assert.rejects(payer.write({action:'refund',dayId,id,amount:20000}));await assert.rejects(other.write({action:'refund',dayId,id,amount:20000}));await assert.rejects(admin.write({action:'refund',dayId,id,amount:1}));
   await assertFails(updateDoc(doc(admin.db,'days',dayId,'orders',id),{refundedAmount:20000,updatedAt:serverTimestamp()}));
   const refunded=await Promise.allSettled([admin.write({action:'refund',dayId,id,amount:20000}),admin.write({action:'refund',dayId,id,amount:20000})]);assert.equal(refunded.filter(r=>r.status==='fulfilled').length,1);assert.equal((await read()).refundedAmount,20000);assert.equal((await read()).refundDue,0);
   await payer.write({action:'order',dayId,id,name,dish:menu[1].name});assert.equal((await read()).due,10000);
   const group=await requestPaymentGroup(payer,[{dayId,orderId:id}]);assert.equal(group.amount,10000);assert.equal((await notify(group.reference,10000)).status,'paid');assert.equal((await read()).receivedAmount,70000);assert.equal((await read()).refundedAmount,20000);
   const cancelled=await payer.write({action:'cancel',dayId,id});assert.equal(cancelled.orders.length,0);assert.equal(cancelled.cancelledOrders?.[0].id,id);assert.equal((await read()).refundDue,50000);await assert.rejects(requestPaymentGroup(payer,[{dayId,orderId:id}]));
   const stats=(await payer.statistics()).find(o=>o.dayId===dayId&&o.name===name)!;assert.equal(stats.amount,0);assert.equal(stats.refundDue,50000);assert.equal(stats.appliedAmount,0);
   await admin.write({action:'refund',dayId,id,amount:50000});assert.equal((await read()).receivedAmount,70000);assert.equal((await read()).refundedAmount,70000);assert.equal((await read()).refundDue,0);
   const events=await getDocs(collection(payer.db,'days',dayId,'orders',id,'financialEvents'));assert.equal(events.size,3);for(const e of events.docs){await assertFails(updateDoc(e.ref,{kind:'hacked'}));await assertFails(deleteDoc(e.ref));}
   assert.equal((await getDocs(query(collection(admin.db,'days',dayId,'orders',id,'financialEvents'),orderBy('createdAt','desc')))).size,3);
   await assertFails(getDocs(collection(other.db,'days',dayId,'orders',id,'financialEvents')));
   await assertFails(getDoc(doc(other.db,'days',dayId,'orders',id,'financialEvents',events.docs[0].id)));
   const publicDb=environment.unauthenticatedContext().firestore() as unknown as Firestore;
   await assertFails(getDocs(collection(publicDb,'days',dayId,'orders',id,'financialEvents')));
   await assertFails(getDoc(doc(publicDb,'days',dayId,'orders',id,'financialEvents',events.docs[0].id)));
   assert.equal((await getDocs(query(collection(payer.db,'days',dayId,'orders',id,'financialEvents'),orderBy('createdAt','desc')))).size,3);
   assert.equal((await getDoc(doc(other.db,'days',dayId,'orders',id))).exists(),true,'Shared order visibility remains available');
   assert.equal((await notify(single.reference,10000)).status,'duplicate');assert.equal((await read()).refundedAmount,70000);
  });
  await t.test('one owner can pay all their dish lines even under different order names',async()=>{
   const payer=await client('own-alias-payer'),other=await client('own-alias-other'),dayId='day-2099-11-02';
   await admin.write({action:'day',create:true,date:'2099-11-02',menu,status:'open'});
   await payer.write({action:'order',dayId,name:'Tên buổi sáng',items:[{dish:menu[0].name,quantity:2},{dish:menu[1].name,quantity:1}]});
   const placed=await payer.write({action:'order',dayId,name:'Tên khác cùng tài khoản',dish:menu[1].name});
   const own=placed.orders.filter(o=>o.actor===payer.auth.currentUser!.uid),refs=own.map(o=>({dayId,orderId:o.id}));
   const group=await requestPaymentGroup(payer,refs);assert.equal(group.count,3);assert.equal(group.amount,180000);assert.equal(new Set(group.items.map(i=>i.name)).size,2);
   const foreign=await other.write({action:'order',dayId,name:'Tên người khác',dish:menu[0].name});
   const foreignOrder=foreign.orders.find(o=>o.actor===other.auth.currentUser!.uid)!;
   await assert.rejects(requestPaymentGroup(payer,[...refs,{dayId,orderId:foreignOrder.id}]));
   assert.equal((await getDoc(doc(other.db,'days',dayId,'orders',foreignOrder.id))).data()?.paid,false);
  });
  await t.test('legacy paid checkboxes become preserved opening balances and cancelled credit slots are not overwritten',async()=>{
   const payer=await client('legacy-balance'),dayId='day-2099-07-01',name='Số dư cũ',id=await nameId(name);
   await admin.write({action:'day',create:true,date:'2099-07-01',menu,status:'open'});
   await environment.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore() as unknown as Firestore,'days',dayId,'orders',id),{name,ownerId:payer.auth.currentUser!.uid,dish:menu[1].name,dishId:await nameId(menu[1].name),price:50000,quantity:1,note:'',paid:true,cancelled:false,createdAt:Timestamp.now(),updatedAt:Timestamp.now()}));
   await payer.write({action:'order',dayId,id,name,dish:menu[0].name,quantity:2});let old=(await getDoc(doc(payer.db,'days',dayId,'orders',id))).data()!;assert.equal(old.receivedAmount,50000);assert.equal(orderFinance(old as never).due,30000);
   await payer.write({action:'cancel',dayId,id});assert.equal(orderFinance((await getDoc(doc(payer.db,'days',dayId,'orders',id))).data() as never).refundDue,50000);
   const placed=await payer.write({action:'order',dayId,name,items:[{dish:menu[0].name,quantity:1}]});assert.notEqual(placed.orders[0].id,id);assert.equal(placed.cancelledOrders?.find(o=>o.id===id)?.receivedAmount,50000);
  });


  await t.test('surplus can be refunded or carried across days and QR charges only the remaining balance',async()=>{
   const payer=await client('carry-owner'),other=await client('carry-other'),name='Giữ số dư mẫu',sourceDay='day-2099-08-01',nextDay='day-2099-08-02';
   for(const date of ['2099-08-01','2099-08-02'])await admin.write({action:'day',create:true,date,menu,status:'open'});
   let view=await payer.write({action:'order',dayId:sourceDay,name,dish:menu[1].name});const sourceId=view.orders[0].id;await admin.write({action:'paid',dayId:sourceDay,id:sourceId,paid:true});await payer.write({action:'cancel',dayId:sourceDay,id:sourceId});
   assert.equal((await payer.read(sourceDay)).cancelledOrders?.[0].receivedAmount,50000);
   await chooseSurplus(payer,{dayId:sourceDay,orderId:sourceId},'carry');assert.equal((await creditBalances(payer))[payer.auth.currentUser!.uid],50000);
   await assert.rejects(admin.write({action:'refund',dayId:sourceDay,id:sourceId,amount:50000}));await assert.rejects(chooseSurplus(other,{dayId:sourceDay,orderId:sourceId},'refund'));
   view=await payer.write({action:'order',dayId:nextDay,name,items:[{dish:menu[0].name,quantity:1}]});assert.equal(view.orders[0].paid,true);assert.equal(view.orders[0].creditInAmount,40000);assert.equal(view.creditBalances?.[payer.auth.currentUser!.uid],10000);
   const stranger=await other.write({action:'order',dayId:nextDay,name:'Tên giống không lấy được dư',dish:menu[0].name});assert.equal(stranger.orders.find(o=>o.actor===other.auth.currentUser!.uid)?.paid,false);
   const more=await payer.write({action:'order',dayId:nextDay,name,items:[{dish:menu[1].name,quantity:1}]}),unpaid=more.orders.find(o=>o.actor===payer.auth.currentUser!.uid&&!o.paid)!;assert.equal(unpaid.creditInAmount,10000);
   const bank={bankBin:'970407',bankName:'Techcombank',accountNumber:'00012345678901',accountName:'NGUYEN VAN MAU'};await saveBankAccount(admin,bank);const intent=await requestPayment(payer,nextDay,unpaid.id);assert.equal(intent.amount,40000);
   const bot=await client('carry-bank-bot');await bootstrap(PRIMARY_ADMIN_UID);const rootDb=environment.authenticatedContext(PRIMARY_ADMIN_UID,{email:'primary@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore() as unknown as Firestore;await setDoc(doc(rootDb,'paymentIntegrations',bot.auth.currentUser!.uid),{enabled:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
   const secret='c'.repeat(64),env={NODE_ENV:'test',NEXT_PUBLIC_FIREBASE_PROJECT_ID:project,NEXT_PUBLIC_FIREBASE_API_KEY:'fake-api-key',PAYMENT_WEBHOOK_SECRET:secret,PAYMENT_FIREBASE_REFRESH_TOKEN:bot.auth.currentUser!.refreshToken,FIRESTORE_EMULATOR_HOST:process.env.FIRESTORE_EMULATOR_HOST,FIREBASE_AUTH_EMULATOR_HOST:process.env.FIREBASE_AUTH_EMULATOR_HOST};
   const payment=await bankWebhook(new Request('https://example.test/api/payments/bank-notification',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'text/plain'},body:'+ VND 40,000\nAccount: '+bank.accountNumber+'\nBalance: VND 900,000\n'+intent.reference}),env);assert.equal(payment.status,200);assert.equal((await payment.json()).status,'paid');const settled=(await getDoc(doc(payer.db,'days',nextDay,'orders',unpaid.id))).data()!;assert.equal(settled.receivedAmount,40000);assert.equal(settled.creditInAmount,10000);assert.equal(settled.paid,true);
   const source=(await getDoc(doc(payer.db,'days',sourceDay,'orders',sourceId))).data()!;assert.equal(source.creditOutAmount,50000);assert.equal(source.receivedAmount,50000);assert.equal(orderFinance(source as never).creditAvailable,0);
  });
  await t.test('concurrent allocations cannot spend one credit twice and malformed paired transfers are denied',async()=>{
   const payer=await client('carry-race'),other=await client('carry-race-other'),name='Dư đồng thời mẫu',days=['2099-09-01','2099-09-02','2099-09-03'];for(const date of days)await admin.write({action:'day',create:true,date,menu,status:'open'});
   const sourceDay='day-'+days[0],p=await payer.write({action:'order',dayId:sourceDay,name,dish:menu[1].name}),sourceId=p.orders[0].id;await admin.write({action:'paid',dayId:sourceDay,id:sourceId,paid:true});await payer.write({action:'cancel',dayId:sourceDay,id:sourceId});
   const targets=[];for(const date of days.slice(1)){const v=await payer.write({action:'order',dayId:'day-'+date,name,dish:menu[0].name});targets.push({dayId:'day-'+date,orderId:v.orders[0].id});}
   await chooseSurplus(payer,{dayId:sourceDay,orderId:sourceId},'carry');
   for(const period of ['today','week','month','all'] as const){const r=summarizeStatistics(await payer.statistics(),period,new Date('2099-09-03T12:00:00+07:00'));const person=r.people.find(p=>p.name===name);if(person)assert.equal(person.unpaid,Math.max(0,person.total-person.paid-person.creditOffset));}
   const all=summarizeStatistics((await payer.statistics()).filter(o=>o.name===name),'all');assert.equal(all.creditOffset,50000);assert.equal(all.unpaid,30000);const today=summarizeStatistics((await payer.statistics()).filter(o=>o.name===name),'today',new Date('2099-09-03T12:00:00+07:00'));assert.equal(today.creditOffset,40000);assert.equal(today.unpaid,0);
   await assertFails(updateDoc(doc(payer.db,'days',targets[0].dayId,'orders',targets[0].orderId),{creditInAmount:40000,paid:true,updatedAt:serverTimestamp()}));
   await assertFails(setDoc(doc(other.db,'creditSources',sourceDay+'~'+sourceId),{dayId:sourceDay,orderId:sourceId,ownerId:other.auth.currentUser!.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
   const result=await Promise.all([applyCredit(payer,[targets[0]]),applyCredit(payer,[targets[1]])]);assert.equal(result.reduce((a,b)=>a+b,0),50000);
   const orders=await Promise.all(targets.map(ref=>getDoc(doc(payer.db,'days',ref.dayId,'orders',ref.orderId))));assert.equal(orders.reduce((sum,o)=>sum+(o.data()?.creditInAmount||0),0),50000);assert.equal(orders.reduce((sum,o)=>sum+orderFinance(o.data() as never).due,0),30000);
   const transfers=await getDocs(collection(payer.db,'creditTransfers'));assert.ok(transfers.size>=2);for(const d of transfers.docs){await assertFails(updateDoc(d.ref,{amount:1}));await assertFails(deleteDoc(d.ref));}
   const target=targets[0],code='c'.repeat(32),batch=writeBatch(payer.db);batch.update(doc(payer.db,'days',target.dayId,'orders',target.orderId),{creditInAmount:999999,lastCreditTransferId:code,paid:true,updatedAt:serverTimestamp()});batch.set(doc(payer.db,'creditTransfers',code),{ownerId:payer.auth.currentUser!.uid,sourceDayId:sourceDay,sourceOrderId:sourceId,targetDayId:target.dayId,targetOrderId:target.orderId,amount:999999,createdBy:payer.auth.currentUser!.uid,createdAt:serverTimestamp()});await assertFails(batch.commit());
  });
  await t.test('refund choice races safely with spending and Google linking preserves unspent credit',async()=>{
   const payer=await client('carry-refund-race'),name='Dư hoàn mẫu',sourceDay='day-2099-10-01',nextDay='day-2099-10-02';for(const date of ['2099-10-01','2099-10-02'])await admin.write({action:'day',create:true,date,menu,status:'open'});
   const p=await payer.write({action:'order',dayId:sourceDay,name,dish:menu[1].name}),sourceId=p.orders[0].id;await admin.write({action:'paid',dayId:sourceDay,id:sourceId,paid:true});await payer.write({action:'cancel',dayId:sourceDay,id:sourceId});const v=await payer.write({action:'order',dayId:nextDay,name,dish:menu[0].name}),targetId=v.orders[0].id;
   await chooseSurplus(payer,{dayId:sourceDay,orderId:sourceId},'carry');await Promise.allSettled([applyCredit(payer,[{dayId:nextDay,orderId:targetId}]),chooseSurplus(payer,{dayId:sourceDay,orderId:sourceId},'refund')]);
   const sourceRef=doc(payer.db,'days',sourceDay,'orders',sourceId);let source=(await getDoc(sourceRef)).data()!;if(orderFinance(source as never).surplus>0){await chooseSurplus(payer,{dayId:sourceDay,orderId:sourceId},'refund');source=(await getDoc(sourceRef)).data()!;await admin.write({action:'refund',dayId:sourceDay,id:sourceId,amount:orderFinance(source as never).refundDue});}
   source=(await getDoc(sourceRef)).data()!;assert.equal((source.creditOutAmount||0)+(source.refundedAmount||0),50000);
   const guest=await client('carry-link-guest'),target=await client('carry-link-google','carry-link-google'),name2='Số dư theo Google';const own=await guest.write({action:'order',dayId:sourceDay,name:name2,dish:menu[1].name}),id=own.orders.find(o=>o.name===name2)!.id;await admin.write({action:'paid',dayId:sourceDay,id,paid:true});await guest.write({action:'cancel',dayId:sourceDay,id});await chooseSurplus(guest,{dayId:sourceDay,orderId:id},'carry');
   const from=guest.auth.currentUser!.uid,to=target.auth.currentUser!.uid;await setDoc(doc(guest.db,'accountLinks',from),{targetUid:to,createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+300000)});await moveGuestOrders(target.db,from,to);assert.equal((await creditBalances(target))[to],50000);
   const order=await target.write({action:'order',dayId:nextDay,name:name2,items:[{dish:menu[0].name,quantity:1}]});assert.equal(order.orders.find(o=>o.name===name2)?.paid,true);assert.equal(order.creditBalances?.[to],10000);
  });
  await t.test('activity history is owner-scoped, immutable, identity-bound and includes dish changes without secrets',async()=>{
   const payer=await client('audit-owner'),dayId='day-2099-11-01';await admin.write({action:'day',create:true,date:'2099-11-01',menu,status:'open'});
   const p=await payer.write({action:'order',dayId,name:'Nhật ký mẫu',dish:menu[0].name,quantity:2,note:'Không hành'}),id=p.orders[0].id;await payer.write({action:'order',dayId,id,name:'Nhật ký mẫu',dish:menu[1].name,quantity:3,note:'Ít cơm'});await payer.write({action:'cancel',dayId,id});
   await recordActivity(payer,{kind:'app.visit',summary:'Truy cập ứng dụng'});await assertFails(getDocs(collection(payer.db,'activityLogs')));
   const events=await getDocs(collection(admin.db,'activityLogs')),own=events.docs.filter(e=>e.data().actorId===payer.auth.currentUser!.uid);assert.ok(own.some(e=>e.data().kind==='app.visit'));const changed=own.find(e=>e.data().kind==='order.update')!,details=JSON.parse(changed.data().details);assert.equal(details.before.dish,menu[0].name);assert.equal(details.after.dish,menu[1].name);assert.equal(details.after.quantity,3);assert.ok(own.some(e=>e.data().kind==='order.cancel'));
   assert.equal((await getDoc(doc(payer.db,'activityLogs',changed.id))).data()?.actorId,payer.auth.currentUser!.uid);
   const ownPage=await readActivityPage(payer,payer.auth.currentUser!.uid,false);assert.ok(ownPage.entries.length);assert.ok(ownPage.entries.every(e=>e.actorId===payer.auth.currentUser!.uid));
   await assertFails(getDoc(doc(b.db,'activityLogs',changed.id)));await assertFails(getDocs(query(collection(b.db,'activityLogs'),where('actorId','==',payer.auth.currentUser!.uid),orderBy('createdAt','desc'),limit(50))));
   await assertFails(readActivityPage(payer,payer.auth.currentUser!.uid,true));
   const publicDb=environment.unauthenticatedContext().firestore() as unknown as Firestore;await assertFails(getDoc(doc(publicDb,'activityLogs',changed.id)));await assertFails(getDocs(query(collection(publicDb,'activityLogs'),where('actorId','==',payer.auth.currentUser!.uid))));
   await assertFails(updateDoc(changed.ref,{summary:'hacked'}));await assertFails(deleteDoc(changed.ref));
   await assertFails(setDoc(doc(payer.db,'activityLogs','a'.repeat(32)),activityValue(admin.auth.currentUser!.uid,{kind:'app.visit',summary:'Giả danh'})));
   await assertFails(setDoc(doc(payer.db,'activityLogs','b'.repeat(32)),{...activityValue(payer.auth.currentUser!.uid,{kind:'bank.received',summary:'Giả ngân hàng'}),source:'bank'}));
   assert.ok(events.docs.some(e=>e.data().kind==='bank.received'));assert.ok(events.docs.filter(e=>e.data().source==='bank').every(e=>!e.data().details.includes('Balance:')));
  });
  await t.test('activity pages retain null and malformed legacy times without losing valid entries or cursor',async()=>{
   const payer=await client('activity-legacy-time'),uid=payer.auth.currentUser!.uid;
   const valid=Timestamp.fromDate(new Date('2099-01-01T00:00:00Z'));
   await environment.withSecurityRulesDisabled(async context=>{
    const db=context.firestore() as unknown as Firestore,batch=writeBatch(db);
    for(const [id,createdAt] of Object.entries({valid,null:null,text:'not-a-timestamp',number:123,object:{seconds:123,nanoseconds:0}}))batch.set(doc(db,'activityLogs','legacy-time-'+id),{...activityValue(uid,{kind:'app.visit',summary:'Nhật ký thời gian mẫu'}),createdAt});
    await batch.commit();
   });
   const page=await readActivityPage(payer,uid,false);assert.equal(page.entries.length,5);
   assert.equal(page.entries.find(e=>e.id==='legacy-time-valid')?.time,'2099-01-01T00:00:00.000Z');
   for(const id of ['null','text','number','object'])assert.equal(page.entries.find(e=>e.id==='legacy-time-'+id)?.time,null);
   assert.equal(page.cursor?.id,'legacy-time-null');assert.equal(page.more,false);
   assert.equal((await readActivityPage(payer,uid,false,page.cursor)).entries.length,0);
  });
  await t.test('activity pages read a pending server timestamp and keep its eventual server time',async()=>{
   const payer=await client('activity-pending-time'),uid=payer.auth.currentUser!.uid,ref=doc(collection(payer.db,'activityLogs'));
   await disableNetwork(payer.db);
   const write=setDoc(ref,activityValue(uid,{kind:'page.view',summary:'Xem mục trong ứng dụng'}));
   try{
    await new Promise<void>((resolve,reject)=>{const unsubscribe=onSnapshot(ref,snapshot=>{if(snapshot.metadata.hasPendingWrites){assert.equal(snapshot.data()?.createdAt,null);unsubscribe();resolve();}},reject);});
    const page=await readActivityPage(payer,uid,false);assert.equal(page.entries.length,1);assert.equal(page.entries[0].id,ref.id);
    assert.ok(page.entries[0].time);assert.ok(Number.isFinite(Date.parse(page.entries[0].time)));
   }finally{await enableNetwork(payer.db);await write;}
   const saved=await getDoc(ref),page=await readActivityPage(payer,uid,false);
   assert.equal(page.entries[0].time,saved.data()!.createdAt.toDate().toISOString());
  });
  await t.test('personal activity pagination returns only the owner and never reads other profiles',async()=>{
   const payer=await client('activity-pager'),other=await client('activity-pager-other'),uid=payer.auth.currentUser!.uid;
   await syncUserProfile(payer,'Người xem log mẫu');await syncUserProfile(other,'Tên riêng người khác');
   const batch=writeBatch(payer.db);for(let i=0;i<51;i++)batch.set(doc(collection(payer.db,'activityLogs')),activityValue(uid,{kind:'page.view',summary:'Xem mục trong ứng dụng',details:{index:i}}));await batch.commit();await recordActivity(other,{kind:'app.visit',summary:'Truy cập ứng dụng'});
   const first=await readActivityPage(payer,uid,false);assert.equal(first.entries.length,50);assert.equal(first.more,true);
   const second=await readActivityPage(payer,uid,false,first.cursor);assert.equal(second.entries.length,1);assert.equal(second.more,false);assert.equal(new Set([...first.entries,...second.entries].map(e=>e.id)).size,51);assert.ok([...first.entries,...second.entries].every(e=>e.actorId===uid));
   assert.deepEqual(await readActivityNames(payer,uid,false),{[uid]:'Người xem log mẫu'});await assertFails(readActivityNames(payer,uid,true));
   assert.ok((await readActivityPage(admin,admin.auth.currentUser!.uid,true)).entries.some(e=>e.actorId!==admin.auth.currentUser!.uid));
  });


  await t.test('reversing a source confirmation never removes credit already transferred to another order',async()=>{
   const payer=await client('credit-void'),dayId='day-2099-12-01',name='Điều chỉnh tiền có số dư';await admin.write({action:'day',create:true,date:'2099-12-01',menu,status:'open'});
   let view=await payer.write({action:'order',dayId,name,items:[{dish:menu[1].name,quantity:1}]}),sourceId=view.orders[0].id;await admin.write({action:'paid',dayId,id:sourceId,paid:true});await payer.write({action:'order',dayId,id:sourceId,name,dish:menu[0].name});await chooseSurplus(payer,{dayId,orderId:sourceId},'carry');
   view=await payer.write({action:'order',dayId,name,items:[{dish:menu[1].name,quantity:1}]});const target=view.orders.find(o=>o.id!==sourceId)!;assert.equal(target.creditInAmount,10000);await admin.write({action:'paid',dayId,id:sourceId,paid:false});
   const a=(await getDoc(doc(payer.db,'days',dayId,'orders',sourceId))).data()!,b=(await getDoc(doc(payer.db,'days',dayId,'orders',target.id))).data()!;assert.equal(a.receivedAmount,50000);assert.equal(a.voidedAmount,40000);assert.equal(a.creditOutAmount,10000);assert.equal(b.creditInAmount,10000);assert.equal(orderFinance(a as never).held,0);
  });

  await t.test('company and department administration validates schemas, references, immutable fields and defaults',async()=>{
   const member=await client('department-member'),publicDb=environment.unauthenticatedContext().firestore() as unknown as Firestore;
   await assert.rejects(initializeOrganization(member,'Công ty mẫu','Phòng mẫu'));
   await initializeOrganization(admin,'Công ty mẫu','Phòng mẫu');const catalog=await readOrganization(member);assert.equal(catalog.companies.length,1);assert.equal(catalog.departments[0].companyId,catalog.companies[0].id);assert.equal(catalog.defaultCompanyId,catalog.companies[0].id);
   await assert.rejects(initializeOrganization(admin,'Trùng cấu hình','Phòng trùng'));
   const second=await saveOrganizationItem(admin,'company',{name:'Công ty thứ hai',active:true}),department=await saveOrganizationItem(admin,'department',{name:'Phòng thứ hai',active:true,companyId:second});
   await setOrganizationDefault(admin,second,department);assert.equal((await readOrganization(member)).defaultDepartmentId,department);
   await assert.rejects(setOrganizationDefault(admin,catalog.defaultCompanyId,department));
   await assertFails(getDocs(collection(publicDb,'companies')));await assertFails(getDoc(doc(publicDb,'settings','organization')));
   const companyRef=doc(admin.db,'companies',second),old=(await getDoc(companyRef)).data()!;
   await assertFails(setDoc(doc(member.db,'companies','spoof'),{...old,updatedBy:member.auth.currentUser!.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
   for(const patch of [{name:'x'.repeat(101)},{active:'yes'},{extra:'pollution'},{updatedBy:member.auth.currentUser!.uid},{createdAt:Timestamp.fromMillis(0)}])await assertFails(updateDoc(companyRef,{...patch,updatedAt:serverTimestamp()}));
   await assertFails(updateDoc(doc(admin.db,'departments',department),{companyId:catalog.defaultCompanyId,updatedAt:serverTimestamp()}));await assertFails(deleteDoc(companyRef));
   await assertFails(setDoc(doc(admin.db,'departments','orphan'),{name:'Phòng mồ côi',active:true,companyId:'missing-company',createdAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:admin.auth.currentUser!.uid}));
   await saveOrganizationItem(admin,'company',{id:second,name:'Đổi tên công ty',active:false});assert.equal((await readOrganization(member)).companies.find(c=>c.id===second)?.name,'Đổi tên công ty');
   await assert.rejects(setOrganizationDefault(admin,second,department));await setOrganizationDefault(admin,catalog.defaultCompanyId,catalog.defaultDepartmentId);
  });
  await t.test('catalog deletion rejects every linked account including guests, Google users and blocked sessions',async()=>{
   const profiles=[await client('delete-guest'),await client('delete-google','delete-google'),await client('delete-blocked')],orderBefore=(await getDoc(ref)).data();
   for(let i=0;i<profiles.length;i++){
    const owner=profiles[i],uid=owner.auth.currentUser!.uid,c=await saveOrganizationItem(admin,'company',{name:'Công ty có người '+i,active:true}),d=await saveOrganizationItem(admin,'department',{name:'Phòng có người '+i,companyId:c,active:true});
    await savePersonalProfile(owner,{preferredName:'Tài khoản liên kết '+i,companyId:c,departmentId:d,phone:'',jobTitle:''});if(i===2)await setUserBlocked(admin,uid,true);
    await assert.rejects(deleteOrganizationItem(owner,'department',d),/Chỉ quản trị/);
    await assert.rejects(deleteOrganizationItem(admin,'department',d),/vẫn còn tài khoản/);await assert.rejects(deleteOrganizationItem(admin,'company',c),/vẫn còn tài khoản/);
    const company=await getDoc(doc(admin.db,'companies',c)),department=await getDoc(doc(admin.db,'departments',d));assert.ok(company.exists()&&department.exists());assert.equal(company.data()?.deletionToken,undefined);assert.equal(department.data()?.deletionToken,undefined);
    assert.equal((await readPersonalProfile(owner)).departmentId,d);const directory=await listManagedUsers(admin),person=directory.users.find(p=>p.uid===uid)!;assert.equal(person.companyId,c);assert.equal(person.departmentId,d);assert.ok(directory.organization.companies.some(v=>v.id===c));if(i===2)assert.equal(person.blocked,true);
    await savePersonalProfile(owner,{preferredName:'Tài khoản liên kết '+i,companyId:'',departmentId:'',phone:'',jobTitle:''});await deleteOrganizationItem(admin,'department',d);await deleteOrganizationItem(admin,'company',c);
   }
   assert.deepEqual((await getDoc(ref)).data(),orderBefore);
  });
  await t.test('deletion locks block new membership, unauthorized deletion, invalid lock fields and default bypasses',async()=>{
   const owner=await client('deletion-race'),publicDb=environment.unauthenticatedContext().firestore() as unknown as Firestore,c=await saveOrganizationItem(admin,'company',{name:'Công ty khóa xóa',active:true}),d=await saveOrganizationItem(admin,'department',{name:'Phòng khóa xóa',companyId:c,active:true}),cr=doc(admin.db,'companies',c),dr=doc(admin.db,'departments',d),token='a'.repeat(32);
   await setOrganizationDefault(admin,c,d);await assertFails(deleteDoc(cr));await assertFails(deleteDoc(dr));await assertFails(deleteDoc(doc(owner.db,'departments',d)));await assertFails(deleteDoc(doc(publicDb,'companies',c)));
   const lock={deletionToken:token,deletionStartedAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:admin.auth.currentUser!.uid};
   await assertFails(updateDoc(doc(owner.db,'companies',c),{...lock,updatedBy:owner.auth.currentUser!.uid}));
   for(const patch of [{deletionToken:'x'.repeat(33)},{deletionToken:12},{deletionStartedAt:Timestamp.fromMillis(0)},{deletionStartedAt:deleteField()},{extra:true}])await assertFails(updateDoc(cr,{...lock,...patch}));
   await updateDoc(dr,lock);await assertFails(deleteDoc(dr));await assert.rejects(savePersonalProfile(owner,{preferredName:'Không được tham gia',companyId:c,departmentId:d,phone:'',jobTitle:''}));await assert.rejects(setOrganizationDefault(admin,c,d));
   await assertFails(setDoc(doc(owner.db,'personalDetails',owner.auth.currentUser!.uid),{companyId:c,departmentId:d,phone:'',jobTitle:'',updatedAt:serverTimestamp()}));
   await assert.rejects(deleteOrganizationItem(admin,'department',d),/đang được kiểm tra/);
   await updateDoc(dr,{deletionToken:deleteField(),deletionStartedAt:deleteField(),updatedAt:serverTimestamp(),updatedBy:admin.auth.currentUser!.uid});
   await updateDoc(cr,lock);await assert.rejects(savePersonalProfile(owner,{preferredName:'Không được tham gia công ty',companyId:c,departmentId:'',phone:'',jobTitle:''}));await assert.rejects(saveOrganizationItem(admin,'department',{name:'Phòng tạo khi khóa',companyId:c,active:true}));
   await assert.rejects(saveOrganizationItem(admin,'department',{name:'Phòng ngừng tạo khi khóa',companyId:c,active:false}));
   await updateDoc(cr,{deletionToken:deleteField(),deletionStartedAt:deleteField(),updatedAt:serverTimestamp(),updatedBy:admin.auth.currentUser!.uid});
   await assert.rejects(deleteOrganizationItem(admin,'company',c),/xóa các phòng ban/);assert.equal((await getDoc(cr)).data()?.deletionToken,undefined);
   await saveOrganizationItem(admin,'company',{id:c,name:'Công ty ngừng sử dụng',active:false});await deleteOrganizationItem(admin,'department',d);assert.equal((await getDoc(dr)).exists(),false);assert.equal((await getDoc(doc(admin.db,'settings','organization'))).data()?.defaultCompanyId,'');
   await deleteOrganizationItem(admin,'company',c);assert.equal((await getDoc(cr)).exists(),false);const log=await getDocs(query(collection(admin.db,'activityLogs'),where('kind','==','organization.save')));assert.ok(log.docs.some(v=>JSON.parse(v.data().details).action==='delete'&&JSON.parse(v.data().details).id===c));
   const org=await readOrganization(admin),first=org.departments.find(v=>v.active&&org.companies.find(c=>c.id===v.companyId)?.active)!;await setOrganizationDefault(admin,first.companyId,first.id);
   assert.deepEqual(resolveAffiliation(org,{companyId:c,departmentId:d}),{companyId:'',departmentId:''});await assert.rejects(deleteOrganizationItem(admin,'company','invalid/id'));await assert.rejects(deleteOrganizationItem(admin,'company',c),/không còn tồn tại/);
  });
  await t.test('personal details remain private and cannot change roles, identity or invalid affiliation',async()=>{
   const owner=await client('personal-details-owner'),other=await client('personal-details-other'),uid=owner.auth.currentUser!.uid,org=await readOrganization(owner);
   const input={preferredName:'Người dùng hồ sơ mẫu',phone:'+84 900 123 456',jobTitle:'Kỹ sư mẫu',companyId:org.defaultCompanyId,departmentId:org.defaultDepartmentId};
   await savePersonalProfile(owner,input);const profile=await readPersonalProfile(owner);assert.equal(profile.preferredName,input.preferredName);assert.equal(profile.phone,input.phone);await syncUserProfile(owner);assert.equal((await readPersonalProfile(owner)).departmentId,input.departmentId);
   assert.equal((await getDoc(doc(admin.db,'personalDetails',uid))).data()?.phone,input.phone);
   await assertFails(getDoc(doc(other.db,'personalDetails',uid)));await assertFails(getDocs(collection(owner.db,'personalDetails')));
   await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore() as unknown as Firestore,'personalDetails',uid)));
   await assertFails(setDoc(doc(admin.db,'personalDetails',uid),{...input,updatedAt:serverTimestamp()}));
   const ref=doc(owner.db,'personalDetails',uid);
   for(const patch of [{phone:'x'.repeat(31)},{phone:'not-a-phone'},{jobTitle:'x'.repeat(101)},{companyId:''},{departmentId:'orphan'},{updatedAt:Timestamp.fromMillis(0)},{admin:true},{phone:123}])await assertFails(updateDoc(ref,{updatedAt:serverTimestamp(),...patch}));
   await assertFails(setDoc(doc(other.db,'personalDetails',uid),{companyId:'',departmentId:'',phone:'',jobTitle:'',updatedAt:serverTimestamp()}));await assertFails(deleteDoc(ref));
   const unchanged=(await getDoc(doc(owner.db,'userProfiles',uid))).data()!;assert.equal(unchanged.provider,'anonymous');assert.equal(unchanged.email,'');assert.equal(unchanged.preferredName,input.preferredName);await assert.rejects(savePersonalProfile(owner,{...input,companyId:'missing-company'}));
  });
  await t.test('server exports attest actual owned data and reject changed files before any import writes',async()=>{
   const owner=await client('verified-export-owner'),other=await client('verified-export-other'),uid=owner.auth.currentUser!.uid;await savePersonalProfile(owner,{preferredName:'Chủ bản xuất',companyId:'',departmentId:'',phone:'',jobTitle:''});
   const raw=await exportPersonalBackup(owner),backup=parsePersonalBackup(raw),exportId=backup.exportId!;assert.equal(backup.version,2);const receipt=await getDoc(doc(owner.db,'personalExports',exportId)),v=receipt.data()!;assert.equal(v.ownerId,uid);assert.equal(v.fileHash,createHash('sha256').update(raw).digest('hex'));assert.equal(v.bytes,Buffer.byteLength(raw));assert.equal(v.orderCount,0);assert.notEqual(v.createdBy,uid);
   await assertFails(getDoc(doc(other.db,'personalExports',exportId)));await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore() as unknown as Firestore,'personalExports',exportId)));await assertFails(getDocs(collection(owner.db,'personalExports')));await assertFails(getDocs(collection(admin.db,'personalExports')));await assertFails(getDoc(doc(backupService!.db,'personalDetails',uid)));await assertFails(updateDoc(doc(backupService!.db,'personalExports',exportId),{fileHash:'c'.repeat(64)}));await assertFails(deleteDoc(doc(backupService!.db,'personalExports',exportId)));
   for(const c of [owner,other,admin]){await assertFails(setDoc(doc(c.db,'personalExports','a'.repeat(32)),{...v,createdAt:serverTimestamp(),createdBy:c.auth.currentUser!.uid}));await assertFails(updateDoc(doc(c.db,'personalExports',exportId),{fileHash:'a'.repeat(64)}));await assertFails(deleteDoc(doc(c.db,'personalExports',exportId)));}
   for(const patch of [{fileHash:'x'},{ownerId:123},{bytes:10000001},{formatVersion:1},{exportedAt:'x'.repeat(41)},{orderCount:-1},{createdAt:Timestamp.fromMillis(0)},{extra:true}])await assertFails(setDoc(doc(backupService!.db,'personalExports','b'.repeat(32)),{...v,createdBy:backupService!.auth.currentUser!.uid,createdAt:serverTimestamp(),...patch}));
   const before=(await getDoc(doc(owner.db,'userProfiles',uid))).data();
   for(const changed of [raw+' ',raw.replace('Chủ bản xuất','Tên đã sửa'),JSON.stringify({...backup,exportId:'e'.repeat(32)}),JSON.stringify({...backup,sourceUserId:other.auth.currentUser!.uid,activity:[]})])await assert.rejects(importPersonalBackup(owner,changed),/đã bị thay đổi/);
   const legacy={...backup,version:1};delete legacy.exportId;await assert.rejects(importPersonalBackup(owner,JSON.stringify(legacy)),/Bản sao lưu cũ/);assert.deepEqual((await getDoc(doc(owner.db,'userProfiles',uid))).data(),before);assert.equal((await listPersonalImports(owner)).length,0);
   const metadata={exportId,fileHash:v.fileHash,bytes:v.bytes,sourceUserId:uid},token=await owner.auth.currentUser!.getIdToken(),env=await backupEnv();
   assert.equal((await exportBackupApi(new Request('http://localhost/export',{method:'POST'}),env)).status,401);assert.equal((await exportBackupApi(new Request('http://localhost/export',{method:'POST',headers:{Authorization:'Bearer fake'}}),env)).status,401);
   assert.equal((await exportBackupApi(new Request('http://localhost/export',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({sourceUserId:other.auth.currentUser!.uid,fileHash:'a'.repeat(64)})}),env)).status,400);
   const verify=(body:string,extra:Record<string,string>={})=>verifyBackupApi(new Request('http://localhost/verify',{method:'POST',headers:{Authorization:'Bearer '+token,...extra},body}),env);
   assert.equal((await verify(JSON.stringify(metadata))).status,200);assert.equal((await verify(JSON.stringify({...metadata,bytes:123}))).status,422);assert.equal((await verify('{broken')).status,400);assert.equal((await verify('x'.repeat(2049))).status,400);assert.equal((await verify(JSON.stringify({...metadata,fileHash:123}))).status,400);
   const disabled=doc(admin.db,'paymentIntegrations',backupService!.auth.currentUser!.uid);await environment.withSecurityRulesDisabled(async c=>{await updateDoc(doc(c.firestore() as unknown as Firestore,'paymentIntegrations',backupService!.auth.currentUser!.uid),{enabled:false});});await assert.rejects(exportPersonalBackup(owner));assert.equal((await verify(JSON.stringify(metadata))).status,503);await environment.withSecurityRulesDisabled(async c=>{await updateDoc(doc(c.firestore() as unknown as Firestore,'paymentIntegrations',disabled.id),{enabled:true});});
  });
  await t.test('personal JSON round trips restore only missing unpaid orders, retain history and cannot replay money',async()=>{
   const owner=await client('backup-owner'),other=await client('backup-other'),uid=owner.auth.currentUser!.uid,day='day-2099-12-20';
   await admin.write({action:'day',create:true,date:'2099-12-20',menu,status:'open'});await savePersonalProfile(owner,{preferredName:'Sao lưu mẫu',phone:'0900123456',jobTitle:'',companyId:'',departmentId:''});
   const unpaid=await owner.write({action:'order',dayId:day,name:'Sao lưu chưa trả',dish:menu[0].name,quantity:2}),unpaidId=unpaid.orders.find(o=>o.name==='Sao lưu chưa trả')!.id;
   const paid=await owner.write({action:'order',dayId:day,name:'Sao lưu đã trả',dish:menu[1].name}),paidId=paid.orders.find(o=>o.name==='Sao lưu đã trả')!.id;await admin.write({action:'paid',dayId:day,id:paidId,paid:true});await owner.write({action:'cancel',dayId:day,id:paidId});await chooseSurplus(owner,{dayId:day,orderId:paidId},'carry');
   await other.write({action:'order',dayId:day,name:'Đơn riêng người khác',dish:menu[0].name});await recordActivity(other,{kind:'app.visit',summary:'Hoạt động người khác'});
   const raw=await exportPersonalBackup(owner),backup=parsePersonalBackup(raw);assert.equal(backup.orders.length,2);assert.ok(backup.orders.every(o=>o.order.ownerId===uid));assert.ok(backup.activity.every(o=>o.actorId===uid));assert.ok(backup.orders.find(o=>o.orderId===paidId)!.financialEvents.length>0);assert.ok(!raw.includes('Đơn riêng người khác'));assert.ok(!raw.includes('refreshToken'));assert.ok(!raw.includes('apiKey'));
   const moneyBefore=(await getDoc(doc(owner.db,'days',day,'orders',paidId))).data()!,creditBefore=(await creditBalances(owner))[uid];
   await environment.withSecurityRulesDisabled(async c=>{const db=c.firestore() as unknown as Firestore;await deleteDoc(doc(db,'days',day,'orders',unpaidId));});
   const restored=await importPersonalBackup(owner,raw);assert.equal(restored.restored,1);assert.equal(restored.review,1);assert.equal(restored.skipped,0);assert.equal(await readImportedBackup(owner,restored.id),raw);
   const repeated=await importPersonalBackup(owner,raw);assert.equal(repeated.restored,0);assert.equal(repeated.existing,1);assert.equal(repeated.id,restored.id);
   assert.deepEqual((await getDoc(doc(owner.db,'days',day,'orders',paidId))).data(),moneyBefore);assert.equal((await creditBalances(owner))[uid],creditBefore);
   assert.equal((await getDoc(doc(owner.db,'days',day,'orders',unpaidId))).data()?.quantity,2);assert.equal((await getDoc(doc(owner.db,'days',day,'orders',unpaidId))).data()?.receivedAmount,0);
   await assertFails(getDoc(doc(other.db,'personalImports',restored.id)));await assertFails(getDocs(collection(owner.db,'personalImports')));await assertFails(getDocs(query(collection(other.db,'personalImports'),where('ownerId','==',uid))));await assertFails(getDoc(doc(other.db,'personalImports',restored.id,'chunks','0')));await assert.rejects(listPersonalImports(owner,true));
   const manifest=doc(owner.db,'personalImports',restored.id);for(const patch of [{ownerId:other.auth.currentUser!.uid},{sourceUid:other.auth.currentUser!.uid},{fileHash:'a'.repeat(64)},{chunkCount:71},{state:'reviewed',reviewedBy:uid},{orderCount:'2'},{reviewNote:'x'.repeat(1001)},{bytes:10000001},{createdAt:Timestamp.fromMillis(0)}])await assertFails(updateDoc(manifest,{...patch,updatedAt:serverTimestamp()}));
   await assertFails(updateDoc(doc(owner.db,'personalImports',restored.id,'chunks','0'),{data:'changed'}));await assertFails(deleteDoc(manifest));await assert.rejects(acknowledgeImport(owner,restored.id,'Không có quyền'));
   await acknowledgeImport(admin,restored.id,'Đã đối chiếu sổ; không cộng lại số dư.');assert.equal((await listPersonalImports(owner))[0].state,'reviewed');assert.equal((await creditBalances(owner))[uid],creditBefore);await assertFails(updateDoc(manifest,{state:'pending',updatedAt:serverTimestamp()}));
   const forged=structuredClone(backup);forged.orders.find(o=>o.orderId===paidId)!.order.receivedAmount=9000000;await assert.rejects(importPersonalBackup(owner,JSON.stringify(forged)),/đã bị thay đổi/);assert.equal((await creditBalances(owner))[uid],creditBefore);assert.deepEqual((await getDoc(doc(owner.db,'days',day,'orders',paidId))).data(),moneyBefore);
  });
  await t.test('restore preserves existing orders, refuses foreign names and closed menus, and archive chunks are bounded',async()=>{
   const owner=await client('restore-conflict'),recipient=await client('restore-recipient'),uid=owner.auth.currentUser!.uid,day='day-2099-12-21';await admin.write({action:'day',create:true,date:'2099-12-21',menu,status:'open'});
   await owner.write({action:'order',dayId:day,name:'Tên đã giữ',dish:menu[0].name});const raw=await exportPersonalBackup(owner),backup=parsePersonalBackup(raw);
   const conflict=await importPersonalBackup(recipient,raw);assert.equal(conflict.restored,0);assert.equal(conflict.skipped,1);assert.equal((await getDoc(doc(owner.db,'days',day,'orders',backup.orders[0].orderId))).data()?.ownerId,uid);
   await admin.write({action:'day',dayId:day,menu,status:'closed'});await environment.withSecurityRulesDisabled(async c=>{await deleteDoc(doc(c.firestore() as unknown as Firestore,'days',day,'orders',backup.orders[0].orderId));});const closed=await importPersonalBackup(owner,raw);assert.equal(closed.restored,0);assert.equal(closed.skipped,1);
   const blankOwner=await client('blank-backup-owner'),blankRaw=await exportPersonalBackup(blankOwner);assert.equal(parsePersonalBackup(blankRaw).orders.length,0);const concurrent=await Promise.all([importPersonalBackup(blankOwner,blankRaw),importPersonalBackup(blankOwner,blankRaw)]);assert.equal(concurrent[0].id,concurrent[1].id);assert.equal((await listPersonalImports(blankOwner)).length,1);
   const fileHash='f'.repeat(64),id=uid+'~'+fileHash,ref=doc(owner.db,'personalImports',id),value={ownerId:uid,sourceUid:uid,fileHash,bytes:10,chunkCount:1,orderCount:0,moneyCount:0,restoredCount:0,skippedCount:0,state:'uploading',reviewedBy:'',reviewNote:'',createdAt:serverTimestamp(),updatedAt:serverTimestamp()};await assertFails(setDoc(ref,value));await assertFails(setDoc(ref,{...value,exportId:'a'.repeat(32)}));
   const exportId='f'.repeat(32);await backupEnv();await setDoc(doc(backupService!.db,'personalExports',exportId),{ownerId:uid,fileHash,bytes:10,formatVersion:2,exportedAt:new Date().toISOString(),orderCount:0,createdBy:backupService!.auth.currentUser!.uid,createdAt:serverTimestamp()});await setDoc(ref,{...value,exportId});

   const chunk={index:0,data:'valid',createdAt:serverTimestamp()};await assertFails(setDoc(doc(recipient.db,'personalImports',id,'chunks','0'),chunk));await assertFails(setDoc(doc(owner.db,'personalImports',id,'chunks','1'),{...chunk,index:1}));await assertFails(setDoc(doc(owner.db,'personalImports',id,'chunks','0'),{...chunk,data:'x'.repeat(150001)}));await assertFails(setDoc(doc(owner.db,'personalImports',uid+'~'+'e'.repeat(64),'chunks','0'),chunk));
   await setDoc(doc(owner.db,'personalImports',id,'chunks','0'),chunk);await updateDoc(ref,{state:'ready',updatedAt:serverTimestamp()});await assert.rejects(readImportedBackup(owner,id),/chưa đầy đủ/);
  });
  await mealDayChangeCases(t,admin,client,environment);
 }finally{const coverage=await fetch(`http://${host}:${port}/emulator/v1/projects/${project}:ruleCoverage`);fs.mkdirSync('.firebase',{recursive:true});fs.writeFileSync('.firebase/rules-coverage.json',await coverage.text());await Promise.all(databases.map(db=>terminate(db)));await Promise.all(apps.map(app=>deleteApp(app)));await environment.cleanup();}
});
