import assert from 'node:assert/strict';import type {TestContext} from 'node:test';
import {doc,setDoc,getDoc,getDocs,collection,updateDoc,deleteDoc,serverTimestamp,Timestamp,deleteField,writeBatch,type Firestore} from 'firebase/firestore';
import {assertFails,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import type {MealClient} from '../lib/meal-client';import {nameId} from '../lib/meal-client-model';
import {beginMealDayChange,resumeMealDayChange,readMealDayEditor} from '../lib/meal-day-change';
import {orderFinance,moneyFields} from '../lib/order-finance';import {creditBalances,applyCredit} from '../lib/credit-client';
import {saveBankAccount} from '../lib/payment-client';import {requestPaymentGroup} from '../lib/payment-group-client';

export async function mealDayChangeCases(t:TestContext,admin:MealClient,client:(id:string,google?:string)=>Promise<MealClient>,environment:RulesTestEnvironment){
 await t.test('parent-only status changes close legacy and large menus without rewriting dishes',async()=>{
  const date='2099-08-20',dayId='day-'+date,menu=Array.from({length:60},(_,i)=>({name:'Sample '+i,price:40000}));await admin.write({action:'day',create:true,date,menu,status:'open'});
  await environment.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore() as unknown as Firestore,'days',dayId,'dishes','legacy-inactive-id'),{name:'Legacy inactive',price:40000,active:false,legacyField:'retained',updatedAt:Timestamp.fromMillis(0)});});
  const old=(await getDocs(collection(admin.db,'days',dayId,'dishes'))).docs.map(d=>({id:d.id,value:d.data()}));
  await admin.write({action:'status',dayId,status:'closed'});assert.equal((await getDoc(doc(admin.db,'days',dayId))).data()!.status,'closed');
  assert.deepEqual((await getDocs(collection(admin.db,'days',dayId,'dishes'))).docs.map(d=>({id:d.id,value:d.data()})),old);
  const guest=await client('status-forbidden');await assert.rejects(guest.write({action:'status',dayId,status:'open'}));await admin.write({action:'status',dayId,status:'open'});
 });
 await t.test('restaurant replacement cancels orders, preserves net credit and resumes safely across payment races',async t=>{
  const date='2099-08-25',dayId='day-'+date,db=admin.db,uid=admin.auth.currentUser!.uid,storeA='change-store-a',storeB='change-store-b',dish='Original sample',newDish='New sample',dishId=await nameId(dish);
  const a=await client('change-a'),b=await client('change-b'),c=await client('change-c'),prior=await client('change-prior'),chefA=await client('change-chef-a','change-chef-a'),chefB=await client('change-chef-b','change-chef-b');
  for(const [id,name]of [[storeA,'Original store'],[storeB,'New store']]){await setDoc(doc(db,'merchants',id),{name,active:true,phone:'',address:'',createdAt:serverTimestamp(),createdBy:uid,updatedAt:serverTimestamp(),updatedBy:uid});const nameDish=id===storeA?dish:newDish;await setDoc(doc(db,'merchants',id,'menus',date),{date,menuCount:1,updatedAt:serverTimestamp(),updatedBy:uid});await setDoc(doc(db,'merchants',id,'menus',date,'dishes',await nameId(nameDish)),{name:nameDish,price:40000,active:true,updatedAt:serverTimestamp()});}
  for(const [chef,store]of [[chefA,storeA],[chefB,storeB]] as const)await setDoc(doc(db,'merchantUsers',chef.auth.currentUser!.uid),{merchantId:store,role:'manager',enabled:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:uid});
  await admin.write({action:'day',create:true,date,merchantId:storeA,status:'open'});
  const refs:{client:MealClient;id:string;name:string}[]=[];for(const [person,name]of [[a,'Change A'],[b,'Change B'],[c,'Change C'],[prior,'Prior cancel']] as const){await person.write({action:'order',dayId,name,dish});refs.push({client:person,id:await nameId(name),name});}
  await environment.withSecurityRulesDisabled(async ctx=>{const d=ctx.firestore() as unknown as Firestore;await updateDoc(doc(d,'days',dayId,'orders',refs[0].id),{paid:true,receivedAmount:deleteField(),refundedAmount:deleteField(),voidedAmount:deleteField(),creditInAmount:deleteField(),creditOutAmount:deleteField(),surplusChoice:deleteField()});await updateDoc(doc(d,'days',dayId,'orders',refs[1].id),{receivedAmount:40000,refundedAmount:5000,voidedAmount:0,creditInAmount:10000,creditOutAmount:15000,paid:false,surplusChoice:'refund'});});
  await admin.write({action:'paid',dayId,id:refs[3].id,paid:true});await prior.write({action:'cancel',dayId,id:refs[3].id});
  await saveBankAccount(admin,{bankBin:'970418',bankName:'BIDV',accountNumber:'1234567890',accountName:'SAMPLE'});
  const group=await requestPaymentGroup(c,[{dayId,orderId:refs[2].id}]);await environment.withSecurityRulesDisabled(async ctx=>{await updateDoc(doc(ctx.firestore() as unknown as Firestore,'paymentGroups',group.reference),{state:'paid'});});
  await admin.write({action:'status',dayId,status:'closed'});const firstClose=(await getDoc(doc(db,'days',dayId))).data()!.closedAt;
  const event=crypto.randomUUID().replaceAll('-',''),batch=writeBatch(chefA.db),oldDispatch=(await getDoc(doc(db,'days',dayId))).data()!.dispatchId;batch.set(doc(chefA.db,'merchantFulfillments',dayId),{merchantId:storeA,date,state:'accepted',note:'',dispatchId:oldDispatch,orderHash:'a'.repeat(64),lastEventId:event,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:chefA.auth.currentUser!.uid});batch.set(doc(chefA.db,'merchants',storeA,'events',event),{kind:'status.change',message:'Sample accepted',dayId,createdAt:serverTimestamp(),actorId:chefA.auth.currentUser!.uid});await batch.commit();
  await environment.withSecurityRulesDisabled(async ctx=>{await updateDoc(doc(ctx.firestore() as unknown as Firestore,'days',dayId),{closedAt:Timestamp.fromMillis(Date.now()-3600000)});});
  let id='';
  await t.test('only admins begin a real source change, and normal reopening still expires',async()=>{
   await assert.rejects(admin.write({action:'status',dayId,status:'open'}),/15 phút/);await assert.rejects(readMealDayEditor(a,dayId));const editor=await readMealDayEditor(admin,dayId);await assert.rejects(beginMealDayChange(a,{dayId,merchantId:storeB,expectedRevision:editor.revision}));id=await beginMealDayChange(admin,{dayId,merchantId:storeB,expectedRevision:editor.revision});assert.equal((await getDoc(doc(db,'days',dayId))).data()!.changing,true);await assertFails(getDoc(doc(chefA.db,'days',dayId,'orders',refs[0].id)));await assert.rejects(admin.write({action:'status',dayId,status:'closed'}));
  });
  await t.test('lock blocks ordering, job/receipt tampering and unauthorized job reads',async()=>{
   await assert.rejects(a.write({action:'order',dayId,name:'Blocked new',dish}));await assertFails(getDoc(doc(a.db,'mealDayChanges',id)));await assertFails(updateDoc(doc(db,'mealDayChanges',id),{toMerchantId:storeA,updatedAt:serverTimestamp()}));await assertFails(deleteDoc(doc(db,'mealDayChanges',id)));await assertFails(setDoc(doc(a.db,'mealDayChanges',id,'cancelledOrders',refs[0].id),{creditAmount:999999}));
   const original=(await getDoc(doc(db,'days',dayId,'orders',refs[0].id))).data()!,cancel={...original,...moneyFields(original as never),cancelled:true,paid:false,updatedAt:serverTimestamp()};
   for(const change of [{ownerId:b.auth.currentUser!.uid},{price:1000},{quantity:2},{receivedAmount:80000},{note:'changed'},{unexpected:true},{createdAt:Timestamp.fromMillis(0)}])await assertFails(setDoc(doc(db,'days',dayId,'orders',refs[0].id),{...cancel,...change}));
   await assertFails(setDoc(doc(a.db,'days',dayId,'orders',refs[0].id),cancel));
  });
  await t.test('confirmed unfinished bank group pauses the replacement and retains its lock for resumption',async()=>{
   await assert.rejects(resumeMealDayChange(admin,id),/Ngân hàng đã xác nhận/);assert.equal((await getDoc(doc(db,'days',dayId))).data()!.changing,true);assert.equal((await getDoc(doc(db,'merchantDays',dayId))).data()!.merchantId,storeA);
   await environment.withSecurityRulesDisabled(async ctx=>{const d=ctx.firestore() as unknown as Firestore;await setDoc(doc(d,'paymentGroupSettlements',group.reference,'items',dayId+'~'+refs[2].id),{settled:true});await updateDoc(doc(d,'days',dayId,'orders',refs[2].id),{receivedAmount:40000,paid:true});});
  });
  await t.test('resumption preserves partial/refunded/spent amounts, isolates owners and never doubles credit',async()=>{
   await resumeMealDayChange(admin,id);const day=(await getDoc(doc(db,'days',dayId))).data()!;assert.equal(day.changing,false);assert.equal(day.status,'open');assert.equal(day.closedAt,undefined);assert.equal(day.dispatchId,undefined);assert.equal((await getDoc(doc(db,'merchantDays',dayId))).data()!.merchantId,storeB);
   for(const [index,amount]of [[0,40000],[1,30000],[2,40000]]){const o=(await getDoc(doc(db,'days',dayId,'orders',refs[index].id))).data()!;assert.equal(o.cancelled,true);assert.equal(o.paid,false);assert.equal(orderFinance(o as never).creditAvailable,amount);assert.equal((await creditBalances(refs[index].client))[refs[index].client.auth.currentUser!.uid],amount);}
   assert.equal((await getDoc(doc(db,'days',dayId,'orders',refs[3].id))).data()!.surplusChoice,'refund');const before=await creditBalances(a);await resumeMealDayChange(admin,id);assert.deepEqual(await creditBalances(a),before);assert.equal((await getDocs(collection(db,'mealDayChanges',id,'cancelledOrders'))).size,3);
   await assertFails(updateDoc(doc(db,'mealDayChanges',id,'cancelledOrders',refs[0].id),{creditAmount:80000}));await assertFails(updateDoc(doc(db,'mealDayChanges',id),{phase:'cancelling',updatedAt:serverTimestamp()}));
  });
  await t.test('new orders use credit once, keep original receipts, and only the new store receives the next dispatch',async()=>{
   const result=await a.write({action:'order',dayId,name:'Change A',items:[{dish:newDish,quantity:1,note:''}]}),fresh=result.orders.find(o=>o.actor===a.auth.currentUser!.uid)!;assert.equal(fresh.paid,true);assert.equal(fresh.creditInAmount,40000);assert.equal((await creditBalances(a))[a.auth.currentUser!.uid],0);await applyCredit(a,[{dayId,orderId:fresh.id}]);assert.equal((await creditBalances(a))[a.auth.currentUser!.uid],0);
   await assertFails(getDocs(collection(chefA.db,'days',dayId,'orders')));await assertFails(getDocs(collection(chefB.db,'days',dayId,'orders')));await admin.write({action:'status',dayId,status:'closed'});const next=(await getDoc(doc(db,'days',dayId))).data()!;assert.ok(next.closedAt.toMillis()>firstClose.toMillis());await getDocs(collection(chefB.db,'days',dayId,'orders'));
   assert.equal((await getDoc(doc(db,'merchantFulfillments',dayId))).exists(),false);assert.equal((await getDoc(doc(db,'mealDayChanges',id,'fulfillmentArchive','previous'))).data()!.merchantId,storeA);const old=await getDoc(doc(chefB.db,'merchantFulfillments',dayId)),eid=crypto.randomUUID().replaceAll('-',''),b=writeBatch(chefB.db);b.set(old.ref,{merchantId:storeB,date,note:'',orderHash:'a'.repeat(64),createdAt:serverTimestamp(),state:'accepted',dispatchId:next.dispatchId,lastEventId:eid,updatedAt:serverTimestamp(),updatedBy:chefB.auth.currentUser!.uid});b.set(doc(chefB.db,'merchants',storeB,'events',eid),{kind:'status.change',message:'Sample accepted again',dayId,createdAt:serverTimestamp(),actorId:chefB.auth.currentUser!.uid});await b.commit();assert.equal((await getDoc(doc(db,'merchantFulfillments',dayId))).data()!.merchantId,storeB);
  });
  await t.test('interruption after cancellation resumes carry once when changing to a manual menu',async()=>{
   const list=await getDocs(collection(db,'days',dayId,'orders')),row=list.docs.find(o=>!o.data().cancelled)!;assert.ok(row);
   await environment.withSecurityRulesDisabled(async ctx=>{await updateDoc(doc(ctx.firestore() as unknown as Firestore,'days',dayId),{closedAt:Timestamp.fromMillis(Date.now()-3600000)});});
   const editor=await readMealDayEditor(admin,dayId),nextJob=await beginMealDayChange(admin,{dayId,merchantId:'',menu:[{name:'Manual replacement',price:35000}],expectedRevision:editor.revision});
   await setDoc(doc(db,'mealDayChanges',nextJob,'pendingOrders',row.id),{ownerId:row.data().ownerId,createdAt:serverTimestamp(),createdBy:uid});
   await updateDoc(row.ref,{...moneyFields(row.data() as never),cancelled:true,paid:false,updatedAt:serverTimestamp()});
   assert.equal((await creditBalances(a))[a.auth.currentUser!.uid],0);
   await resumeMealDayChange(admin,nextJob);assert.equal((await getDoc(doc(db,'merchantDays',dayId))).exists(),false);assert.equal((await getDoc(doc(db,'days',dayId))).data()!.status,'open');assert.equal((await creditBalances(a))[a.auth.currentUser!.uid],40000);
   await resumeMealDayChange(admin,nextJob);assert.equal((await creditBalances(a))[a.auth.currentUser!.uid],40000);assert.equal((await getDocs(collection(db,'mealDayChanges',nextJob,'cancelledOrders'))).size,1);
  });
 });
}
