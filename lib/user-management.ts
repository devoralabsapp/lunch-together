import {appendActivity} from './activity';
import {collection,doc,getDoc,getDocs,runTransaction,serverTimestamp,type DocumentData} from 'firebase/firestore';
import type {MealClient} from './meal-client';
import {ensureUser} from './firebase-client';
import {normalizedOrderName} from './order-name';
import {PRIMARY_ADMIN_UID,validUserId,type ManagedUser,type UserDirectory} from './user-model';
import {readOrganization,resolveAffiliation,type PersonalDetails} from './organization';
import {assertCustomerAccount} from './portal-access';

const dateText=(value:DocumentData)=>value?.toDate?.().toISOString()||'';
function checkUid(uid:string){if(!validUserId(uid))throw new Error('UID người dùng chưa hợp lệ.');}
async function requireAdmin(client:MealClient){const user=await ensureUser(client.auth);if(!await client.isAdmin())throw new Error('Chỉ quản trị viên được quản lý người dùng.');return user;}
export async function ownAccess(client:MealClient){
 const user=await ensureUser(client.auth);
 try{return (await getDoc(doc(client.db,'userAccess',user.uid))).data()?.blocked===true;}
 catch(error){if((error as {code?:string}).code==='permission-denied')return false;throw error;}
}
export async function syncUserProfile(client:MealClient,preferredName?:string){
 const user=await ensureUser(client.auth),token=await user.getIdTokenResult();
 await assertCustomerAccount(user,client.db);
 const provider=user.isAnonymous?'anonymous':'google.com';
 if(!user.isAnonymous&&(token.signInProvider!=='google.com'||token.claims.email_verified!==true))return;
 const preferred=preferredName===undefined?undefined:normalizedOrderName(preferredName);
 if(preferred!==undefined&&(!preferred||preferred.length>100))throw new Error('Tên đặt cơm cần từ 1 đến 100 ký tự.');
 const ref=doc(client.db,'userProfiles',user.uid);
 await runTransaction(client.db,async tx=>{
  const profile=await tx.get(ref),old=profile.data(),name=preferred??old?.preferredName??'';
  tx.set(ref,{displayName:(name||user.displayName||'').slice(0,100),preferredName:name,email:user.isAnonymous?'':user.email||'',provider,createdAt:old?.createdAt||serverTimestamp(),lastSeenAt:serverTimestamp()});
 });
}
export async function listManagedUsers(client:MealClient):Promise<UserDirectory>{
 const user=await requireAdmin(client);
 const [profiles,access,roles,days,details,organization]=await Promise.all([getDocs(collection(client.db,'userProfiles')),getDocs(collection(client.db,'userAccess')),getDocs(collection(client.db,'admins')),getDocs(collection(client.db,'days')),getDocs(collection(client.db,'personalDetails')),readOrganization(client)]);
 const records=new Map<string,ManagedUser>();
 function entry(uid:string){let person=records.get(uid);if(!person){person={uid,displayName:'',preferredName:'',email:'',provider:'unknown',createdAt:'',lastSeenAt:'',admin:false,blocked:false,orderCount:0,lastOrderDate:'',aliases:[]};records.set(uid,person);}return person;}
 for(const profile of profiles.docs){const p=profile.data();Object.assign(entry(profile.id),{displayName:p.displayName,preferredName:p.preferredName,email:p.email,provider:p.provider,createdAt:dateText(p.createdAt),lastSeenAt:dateText(p.lastSeenAt)});}
 for(const role of roles.docs)entry(role.id).admin=role.data().enabled===true;
 for(const state of access.docs)Object.assign(entry(state.id),{blocked:state.data().blocked===true,deleted:state.data().deleted===true});
 for(const detail of details.docs){const data=detail.data(),value=resolveAffiliation(organization,data);Object.assign(entry(detail.id),value,{phone:String(data.phone||''),jobTitle:String(data.jobTitle||''),affiliation:[organization.companies.find(c=>c.id===value.companyId)?.name,organization.departments.find(d=>d.id===value.departmentId)?.name].filter(Boolean).join(' · ')});}
 for(let i=0;i<days.docs.length;i+=6){await Promise.all(days.docs.slice(i,i+6).map(async day=>{
  const orders=await getDocs(collection(client.db,'days',day.id,'orders'));
  for(const order of orders.docs){const o=order.data();if(typeof o.ownerId!=='string'||!validUserId(o.ownerId))continue;const person=entry(o.ownerId);person.hasOrderHistory=true;if(o.cancelled)continue;person.orderCount++;person.lastOrderDate=[person.lastOrderDate,day.data().date].sort().at(-1)||'';if(typeof o.name==='string'&&!person.aliases.includes(o.name)&&person.aliases.length<5)person.aliases.push(o.name);}
 }));}
 if(client.auth.currentUser?.uid!==user.uid)throw new Error('Phiên đăng nhập đã thay đổi. Vui lòng tải lại.');
 const users=[...records.values()].filter(p=>!p.deleted).map(p=>({...p,displayName:p.displayName||p.preferredName||p.aliases[0]||'Chưa có tên'})).sort((a,b)=>Number(b.uid===PRIMARY_ADMIN_UID)-Number(a.uid===PRIMARY_ADMIN_UID)||Number(b.admin)-Number(a.admin)||a.displayName.localeCompare(b.displayName,'vi'));
 return {users,canManageRoles:user.uid===PRIMARY_ADMIN_UID,organization};
}
export async function setUserBlocked(client:MealClient,uid:string,blocked:boolean){
 const user=await requireAdmin(client);checkUid(uid);
 if(uid===user.uid||uid===PRIMARY_ADMIN_UID)throw new Error('Không thể khóa tài khoản quản trị đang sử dụng hoặc quản trị chính.');
 await runTransaction(client.db,async tx=>{
  const role=await tx.get(doc(client.db,'admins',uid));if(role.data()?.enabled===true)throw new Error('Cần thu hồi quyền quản trị trước khi khóa đặt cơm.');
  tx.set(doc(client.db,'userAccess',uid),{blocked,updatedBy:user.uid,updatedAt:serverTimestamp()});appendActivity(tx,client.db,user.uid,{kind:'user.block',summary:blocked?'Khóa đặt cơm':'Mở khóa đặt cơm',details:{targetUid:uid,blocked}});
 });
}
export async function setUserAdmin(client:MealClient,uid:string,enabled:boolean){
 const user=await requireAdmin(client);checkUid(uid);
 if(user.uid!==PRIMARY_ADMIN_UID)throw new Error('Chỉ quản trị chính được cấp hoặc thu hồi quyền quản trị.');
 if(uid===user.uid||uid===PRIMARY_ADMIN_UID)throw new Error('Không thể thay đổi quyền quản trị chính.');
 await runTransaction(client.db,async tx=>{
  const [profile,state]=await Promise.all([tx.get(doc(client.db,'userProfiles',uid)),tx.get(doc(client.db,'userAccess',uid))]);
  if(enabled&&(profile.data()?.provider!=='google.com'||!profile.data()?.email))throw new Error('Người này cần đăng nhập Google một lần trước khi được cấp quyền.');
  if(enabled&&state.data()?.blocked===true)throw new Error('Cần mở lại quyền đặt cơm trước khi cấp quyền quản trị.');
  tx.set(doc(client.db,'admins',uid),{enabled,updatedBy:user.uid,updatedAt:serverTimestamp()});appendActivity(tx,client.db,user.uid,{kind:'user.role',summary:enabled?'Cấp quyền quản trị':'Thu hồi quyền quản trị',details:{targetUid:uid,enabled}});
 });
}

export async function updateManagedUser(client:MealClient,uid:string,input:PersonalDetails&{preferredName:string}){
 const user=await requireAdmin(client);checkUid(uid);
 const preferredName=normalizedOrderName(input.preferredName),phone=input.phone.trim(),jobTitle=input.jobTitle.trim();
 if(!preferredName||preferredName.length>100||phone.length>30||!/^[-+()0-9 .]*$/.test(phone)||jobTitle.length>100||(!input.companyId&&input.departmentId))throw new Error('Thông tin cá nhân chưa hợp lệ.');
 const organization=await readOrganization(client),affiliation=resolveAffiliation(organization,input,true);
 if(affiliation.companyId!==input.companyId||affiliation.departmentId!==input.departmentId)throw new Error('Công ty và phòng ban không khớp hoặc đã ngừng sử dụng.');
 const profileRef=doc(client.db,'userProfiles',uid),detailsRef=doc(client.db,'personalDetails',uid);
 await runTransaction(client.db,async tx=>{
  const [profile,details,role,state]=await Promise.all([tx.get(profileRef),tx.get(detailsRef),tx.get(doc(client.db,'admins',uid)),tx.get(doc(client.db,'userAccess',uid))]);
  if(!profile.exists())throw new Error('Người dùng cần truy cập ứng dụng một lần để tạo hồ sơ.');
  if(uid!==user.uid&&user.uid!==PRIMARY_ADMIN_UID&&(uid===PRIMARY_ADMIN_UID||role.data()?.enabled===true))throw new Error('Chỉ quản trị chính được sửa hồ sơ của quản trị viên khác.');
  if(state.data()?.deleted||state.data()?.deletionToken)throw new Error('Tài khoản đã bị xóa hoặc đang được kiểm tra xóa.');
  tx.update(profileRef,{displayName:preferredName,preferredName});
  tx.set(detailsRef,{companyId:input.companyId,departmentId:input.departmentId,phone,jobTitle,updatedAt:serverTimestamp()});
  appendActivity(tx,client.db,user.uid,{kind:'user.update',summary:'Quản trị cập nhật hồ sơ người dùng',details:{targetUid:uid,before:{preferredName:profile.data()?.preferredName||'',companyId:details.data()?.companyId||'',departmentId:details.data()?.departmentId||''},after:{preferredName,companyId:input.companyId,departmentId:input.departmentId}}});
 });
}

export async function deleteManagedUser(client:MealClient,uid:string,request:typeof fetch=fetch){
 const user=await requireAdmin(client);checkUid(uid);
 const response=await request('/api/admin/users/delete',{method:'POST',headers:{Authorization:'Bearer '+await user.getIdToken(),'Content-Type':'application/json'},body:JSON.stringify({uid})});
 const result=await response.json().catch(()=>({}));if(!response.ok||result.deleted!==true)throw new Error(typeof result.error==='string'?result.error:'Chưa xóa được người dùng. Vui lòng thử lại.');
}
