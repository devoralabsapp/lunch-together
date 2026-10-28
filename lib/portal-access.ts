import type {User} from 'firebase/auth';
import {doc,getDoc,onSnapshot,type Firestore} from 'firebase/firestore';

export const merchantOnlyMessage='Tài khoản này thuộc portal nhà hàng. Vui lòng đăng nhập tại Merchant; chỉ quản trị được dùng cả hai portal.';
export class PortalAccessError extends Error{constructor(){super(merchantOnlyMessage);this.name='PortalAccessError';}}

// Membership is authoritative, including disabled memberships. A suspension
// must never turn a merchant account into a customer account.
export async function assertCustomerAccount(user:User,db:Firestore){
 if(user.isAnonymous)return;
 const token=await user.getIdTokenResult();
 if(token.signInProvider!=='google.com'||token.claims.email_verified!==true)throw new Error('Cần xác minh tài khoản Google.');
 const admin=await getDoc(doc(db,'admins',user.uid));
 if(admin.data()?.enabled===true)return;
 if((await getDoc(doc(db,'merchantUsers',user.uid))).exists())throw new PortalAccessError();
}

export function watchCustomerAccount(user:User,db:Firestore,onDenied:()=>void,onError:(e:unknown)=>void){
 let admin=false,merchant=false;const ready=new Set<string>();
 const emit=(key:string)=>{ready.add(key);if(ready.size===2&&!admin&&merchant)onDenied();};
 const a=onSnapshot(doc(db,'admins',user.uid),s=>{admin=s.data()?.enabled===true;emit('admin');},onError);
 const b=onSnapshot(doc(db,'merchantUsers',user.uid),s=>{merchant=s.exists();emit('member');},onError);
 return ()=>{a();b();};
}
