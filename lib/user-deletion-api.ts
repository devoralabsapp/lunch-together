import {randomUUID} from 'node:crypto';
import {verifyStatisticsViewer,StatisticsAccessError} from './statistics-access';
import {backupServiceStore} from './payment-webhook';
import {PRIMARY_ADMIN_UID,validUserId} from './user-model';

type Env=Record<string,string|undefined>;
type Value={stringValue?:string;booleanValue?:boolean;timestampValue?:string};
type Document={name:string;fields?:Record<string,Value>;updateTime:string};
const text=(value:string)=>({stringValue:value});
const flag=(value:boolean)=>({booleanValue:value});
const headers={'Cache-Control':'private, no-store','Vary':'Authorization','X-Content-Type-Options':'nosniff'};
class UserDeleteError extends Error{constructor(message:string,public status=409){super(message);}}
const historyMessage='Không thể xóa người dùng đã từng đặt cơm, kể cả đơn đã hủy hoặc đã chuyển sang tài khoản khác.';

class AdminStore{
 readonly root:string;readonly url:string;private calls=0;private bytes=0;
 constructor(env:Env,private token:string){
  const project=env.NEXT_PUBLIC_FIREBASE_PROJECT_ID||'',database=env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID||'(default)';
  if(!/^[a-z0-9-]{6,100}$/.test(project)||!/^[A-Za-z0-9_()-]{1,100}$/.test(database))throw new UserDeleteError('Website chưa có cấu hình Firebase.',503);
  const host=env.FIRESTORE_EMULATOR_HOST,local=env.NODE_ENV!=='production'&&project.startsWith('demo-')&&host&&/^127\.0\.0\.1:\d+$/.test(host);
  this.root=`projects/${project}/databases/${database}/documents`;this.url=(local?'http://'+host:'https://firestore.googleapis.com')+'/v1/'+this.root;
 }
 async call(suffix:string,method='GET',body?:unknown):Promise<any>{
  if(++this.calls>5000)throw new UserDeleteError('Chưa thể kiểm tra hết lịch sử. Không xóa người dùng; vui lòng thử lại sau.',413);
  const r=await fetch(this.url+suffix,{method,headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(r.status===404)return null;
  if(!r.ok)throw new UserDeleteError(r.status===403?'Chưa được cấp quyền quản trị hoặc Rules chưa được cập nhật.':'Dữ liệu vừa thay đổi hoặc chưa đọc được. Không xóa người dùng; hãy tải lại.',r.status===403?403:503);
  const reader=r.body?.getReader();if(!reader)throw new UserDeleteError('Chưa kiểm tra được lịch sử người dùng.',503);
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const v=await reader.read();if(v.done)break;size+=v.value.length;this.bytes+=v.value.length;if(size>20_000_000||this.bytes>50_000_000)throw new UserDeleteError('Lịch sử vượt giới hạn kiểm tra. Không xóa người dùng.',413);chunks.push(v.value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 async get(path:string):Promise<Document|null>{return this.call('/'+path);}
 async days(){const all:Document[]=[];let page='';do{const r=await this.call('/days?pageSize=1000'+(page?'&pageToken='+encodeURIComponent(page):''));all.push(...(r?.documents||[]));if(all.length>3000)throw new UserDeleteError('Chưa thể kiểm tra hết lịch sử. Không xóa người dùng.',413);page=r?.nextPageToken||'';}while(page);return all;}
 async owned(collectionId:string,field:string,uid:string,max:number,parent=''):Promise<Document[]>{
  const rows=await this.call((parent?'/'+parent:'')+':runQuery','POST',{structuredQuery:{from:[{collectionId}],where:{fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:text(uid)}},limit:max}});
  return (rows||[]).flatMap((r:{document?:Document})=>r.document?[r.document]:[]);
 }
 write(path:string,fields:Record<string,Value>,old:Document|null){return {update:{name:this.root+'/'+path,fields},currentDocument:old?{updateTime:old.updateTime}:{exists:false},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]};}
}

async function uidBody(request:Request){
 if(Number(request.headers.get('Content-Length')||0)>1024)throw new UserDeleteError('Yêu cầu xóa người dùng chưa hợp lệ.',400);
 const reader=request.body?.getReader();if(!reader)throw new UserDeleteError('Chưa chọn người dùng.',400);
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>1024){await reader.cancel();throw new UserDeleteError('Yêu cầu xóa người dùng chưa hợp lệ.',400);}chunks.push(p.value);}
 let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new UserDeleteError('Yêu cầu xóa người dùng chưa hợp lệ.',400);}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!validUserId(value.uid)||typeof value.uid!=='string')throw new UserDeleteError('UID người dùng chưa hợp lệ.',400);
 return value.uid as string;
}

export async function deleteManagedUserApi(request:Request,env:Env=process.env):Promise<Response>{
 let store:AdminStore|undefined,lock:Document|null=null,previous:Document|null=null,target='';let completed=false;
 try{
  const token=request.headers.get('Authorization')?.replace(/^Bearer /i,'')||'';
  const actor=await verifyStatisticsViewer(token,{projectId:env.NEXT_PUBLIC_FIREBASE_PROJECT_ID||'',apiKey:env.NEXT_PUBLIC_FIREBASE_API_KEY||'',authHost:env.NODE_ENV!=='production'?env.FIREBASE_AUTH_EMULATOR_HOST:undefined});
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
  if(claims.email_verified!==true||claims.firebase?.sign_in_provider!=='google.com')throw new UserDeleteError('Chỉ quản trị viên Google đã xác minh được xóa người dùng.',403);
  store=new AdminStore(env,token);if((await store.get('admins/'+actor))?.fields?.enabled?.booleanValue!==true)throw new UserDeleteError('Chỉ quản trị viên được xóa người dùng.',403);
  target=await uidBody(request);if(target===actor||target===PRIMARY_ADMIN_UID)throw new UserDeleteError('Không thể xóa tài khoản đang sử dụng hoặc quản trị chính.');
  const [profile,details,role,integration,state]=await Promise.all(['userProfiles/','personalDetails/','admins/','paymentIntegrations/','userAccess/'].map(p=>store!.get(p+target)));
  if(role?.fields?.enabled?.booleanValue===true)throw new UserDeleteError('Cần thu hồi quyền quản trị trước khi xóa người dùng.');
  if(integration)throw new UserDeleteError('Không thể xóa tài khoản dịch vụ của hệ thống.');
  if(state?.fields?.deleted?.booleanValue===true){completed=true;return Response.json({deleted:true},{headers});}
  if(!profile&&!details&&!state)throw new UserDeleteError('Không tìm thấy hồ sơ người dùng.',404);
  // Resolve the server identity before placing a lock; never strand users when
  // the existing server integration has not been configured.
  const service=await backupServiceStore(env);previous=state;
  const deletionToken=randomUUID().replaceAll('-','');
  await store.call(':commit','POST',{writes:[store.write('userAccess/'+target,{blocked:flag(true),updatedBy:text(actor),deletionToken:text(deletionToken)},state)]});
  lock=await store.get('userAccess/'+target);
  if(lock?.fields?.deletionToken?.stringValue!==deletionToken)throw new UserDeleteError('Có thao tác quản trị khác đang xử lý tài khoản này.');
  const days=await store.days();
  for(let i=0;i<days.length;i+=6){const found=await Promise.all(days.slice(i,i+6).map(day=>store!.owned('orders','ownerId',target,1,'days/'+day.name.split('/').at(-1))));if(found.some(rows=>rows.length))throw new UserDeleteError(historyMessage);}
  const logs=await store.owned('activityLogs','actorId',target,10001);
  if(logs.some(log=>log.fields?.kind?.stringValue?.startsWith('order.')))throw new UserDeleteError(historyMessage);
  if(logs.length>10000)throw new UserDeleteError('Chưa thể kiểm tra hết lịch sử. Không xóa người dùng.',413);
  const deletedFields={blocked:flag(true),deleted:flag(true),deletedBy:text(actor),deletionToken:text(deletionToken),updatedBy:text(service.uid)};
  const writes:unknown[]=[{...store.write('userAccess/'+target,deletedFields,lock),updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'deletedAt',setToServerValue:'REQUEST_TIME'}]}];
  for(const document of [profile,details])if(document)writes.push({delete:document.name,currentDocument:{updateTime:document.updateTime}});
  writes.push(service.store.create('activityLogs/'+randomUUID().replaceAll('-',''),{kind:text('user.delete'),actorId:text(service.uid),source:text('app'),summary:text('Quản trị xóa người dùng chưa từng đặt cơm'),dayId:text(''),orderId:text(''),reference:text(''),details:text(JSON.stringify({targetUid:target,adminUid:actor}))}));
  await service.store.call(':commit','POST',{writes});completed=true;
  return Response.json({deleted:true},{headers});
 }catch(error){
  if(error instanceof StatisticsAccessError||error instanceof UserDeleteError)return Response.json({error:error.message},{status:error.status,headers});
  return Response.json({error:'Chưa xóa được người dùng. Kiểm tra cấu hình dịch vụ và Rules rồi thử lại.'},{status:503,headers});
 }finally{
  if(!completed&&store&&lock&&target){try{const fields={blocked:flag(previous?.fields?.blocked?.booleanValue===true),updatedBy:lock.fields!.updatedBy!};await store.call(':commit','POST',{writes:[store.write('userAccess/'+target,fields,lock)]});}catch{console.warn('[user-delete] access_lock_changed_or_release_failed');}}
 }
}
