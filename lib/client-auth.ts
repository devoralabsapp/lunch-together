import {appendActivity,recordActivity,orderAudit} from './activity';
import {GoogleAuthProvider,linkWithPopup,signInWithCredential,signOut,setPersistence,inMemoryPersistence,getAuth,connectAuthEmulator,type AuthError} from 'firebase/auth';
import {deleteApp,initializeApp} from 'firebase/app';
import {collection,doc,getDoc,getDocs,query,where,setDoc,deleteDoc,runTransaction,serverTimestamp,Timestamp,getFirestore,connectFirestoreEmulator,type Firestore} from 'firebase/firestore';
import {assertCustomerAccount} from './portal-access';
import {ensureUser,firebaseClient} from './firebase-client';
import {invalidateLinkedGroup} from './payment-group-client';
import type {MealClient} from './meal-client';

const pendingKey='com-nha:transfer:v2';
export async function moveGuestOrders(db:Firestore,sourceUid:string,targetUid:string){
 const days=await getDocs(collection(db,'days'));
 for(let i=0;i<days.docs.length;i+=8){await Promise.all(days.docs.slice(i,i+8).map(async day=>{
  const orders=await getDocs(query(collection(db,'days',day.id,'orders'),where('ownerId','==',sourceUid)));
  for(const order of orders.docs)await runTransaction(db,async tx=>{const current=await tx.get(order.ref);if(current.data()?.ownerId!==sourceUid)return;const sourceRef=doc(db,'creditSources',day.id+'~'+order.id),credit=await tx.get(sourceRef);const apply=await invalidateLinkedGroup({db} as MealClient,tx,day.id,order.id);apply();tx.update(order.ref,{ownerId:targetUid,updatedAt:serverTimestamp()});if(credit.exists())tx.update(sourceRef,{ownerId:targetUid,updatedAt:serverTimestamp()});appendActivity(tx,db,targetUid,{kind:'order.transfer',summary:'Chuyển đơn khách sang Google',dayId:day.id,orderId:order.id,details:{before:orderAudit(current.data()),targetUid}});});
  const people=await getDocs(query(collection(db,'days',day.id,'orderPeople'),where('ownerId','==',sourceUid)));
  for(const person of people.docs)await runTransaction(db,async tx=>{const current=await tx.get(person.ref);if(current.data()?.ownerId===sourceUid)tx.update(person.ref,{ownerId:targetUid,updatedAt:serverTimestamp()});});
 }));}
 await deleteDoc(doc(db,'accountLinks',sourceUid));
}

let transferTask:Promise<void>|undefined;
export async function resumeGuestTransfer(){
 if(transferTask)return transferTask;
 const {auth,db}=firebaseClient(),user=await ensureUser(auth);
 if(user.isAnonymous)return;
 await assertCustomerAccount(user,db);
 let source:string|null=null;try{source=localStorage.getItem(pendingKey);}catch{return;}if(!source)return;
 if(transferTask)return transferTask;
 transferTask=(async()=>{try{await moveGuestOrders(db,source!,user.uid);localStorage.removeItem(pendingKey);}catch{throw new Error('Một số đơn khách chưa chuyển xong. Vui lòng tải lại trang để thử lại hoặc liên hệ người gom cơm.');}})();
 try{await transferTask;}finally{transferTask=undefined;}
}

export async function googleSignIn(){
 const {auth,db}=firebaseClient(),guest=await ensureUser(auth),provider=new GoogleAuthProvider();
 if(!guest.isAnonymous)return;
 try{await linkWithPopup(guest,provider);await recordActivity({auth,db} as MealClient,{kind:'auth.signin',summary:'Đăng nhập Google',details:{linkedGuest:true}}).catch(()=>{});return;}catch(error){
  if((error as AuthError).code!=='auth/credential-already-in-use')throw error;
  const credential=GoogleAuthProvider.credentialFromError(error as AuthError);if(!credential)throw error;
  // Keep the anonymous session until Google identifies the existing account.
  const secondary=initializeApp(auth.app.options,'account-link-'+crypto.randomUUID());
  try{
   const other=getAuth(secondary);if(auth.emulatorConfig){const c=auth.emulatorConfig;connectAuthEmulator(other,`${c.protocol}://${c.host}:${c.port}`,{disableWarnings:true});}await setPersistence(other,inMemoryPersistence);
   const target=await signInWithCredential(other,credential);
   const targetDb=getFirestore(secondary,process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID||'(default)');
   if(auth.emulatorConfig){const [host,port]=process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST!.split(':');connectFirestoreEmulator(targetDb,host,Number(port));}
   await assertCustomerAccount(target.user,targetDb);
   await setDoc(doc(db,'accountLinks',guest.uid),{targetUid:target.user.uid,createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+5*60000)});
   localStorage.setItem(pendingKey,guest.uid);
   await signInWithCredential(auth,credential);
   await resumeGuestTransfer();await recordActivity({auth,db} as MealClient,{kind:'auth.signin',summary:'Đăng nhập Google',details:{linkedGuest:true}}).catch(()=>{});
  }finally{await deleteApp(secondary);}
 }
}
export async function googleSignOut(){const client=firebaseClient();await recordActivity(client as MealClient,{kind:'auth.signout',summary:'Đăng xuất'}).catch(()=>{});await signOut(client.auth);}
