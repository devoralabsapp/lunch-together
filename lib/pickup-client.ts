import {appendActivity} from './activity';
import {dayClosureFields} from './day-closure';
import {collection,doc,getDocFromServer,getDocsFromServer,query,where,runTransaction,serverTimestamp,type DocumentSnapshot,type DocumentData} from 'firebase/firestore';
import type {MealClient} from './meal-client';
import {ensureUser} from './firebase-client';
import {localNow,validDate} from './meal-client-model';
import {personKey} from './statistics';
import {choosePickup,MAX_PICKUP_PEOPLE,pickupCandidates,pickupWeek,type PickupDraw,type PickupState} from './pickup';

function readDraw(snapshot:DocumentSnapshot<DocumentData>):PickupDraw|null{
 if(!snapshot.exists())return null;const d=snapshot.data();
 if(!Array.isArray(d.selectedKeys)||!Array.isArray(d.selectedNames)||!Array.isArray(d.previousCounts)||d.selectedNames.length!==d.count||d.previousCounts.length!==d.count)throw new Error('Lịch sử lấy cơm chưa hợp lệ.');
 const selected=d.selectedKeys.map((key:string,i:number)=>({key,name:d.selectedNames[i],previousCount:d.previousCounts[i]}));
 if(!validDate(d.date)||snapshot.id!==d.date||d.weekStart!==pickupWeek(d.date).start||d.version!==1||!Number.isInteger(d.count)||d.count<1||d.count>MAX_PICKUP_PEOPLE||!Number.isInteger(d.candidateCount)||d.candidateCount<d.count||d.candidateCount>500||selected.length!==d.count||new Set(d.selectedKeys).size!==d.count||selected.some((p:{key:string;name:string;previousCount:number})=>typeof p.name!=='string'||!p.name||p.key!==personKey(p.name)||!Number.isInteger(p.previousCount)||p.previousCount<0||p.previousCount>6)||typeof d.dayId!=='string'||typeof d.createdBy!=='string'||!d.createdAt?.toDate)throw new Error('Lịch sử lấy cơm chưa hợp lệ. Cần đối chiếu trước khi quay tiếp.');
 return {...d,selected,createdAt:d.createdAt.toDate().toISOString()} as PickupDraw;
}
async function roster(client:MealClient,dayId:string){
 if(!/^[\w-]{1,100}$/.test(dayId))throw new Error('Chưa chọn ngày đặt cơm.');
 const day=await getDocFromServer(doc(client.db,'days',dayId));if(!day.exists()||!validDate(day.data().date))throw new Error('Cần đăng thực đơn và có đơn trên web trước khi chọn người lấy cơm.');
 const orders=await getDocsFromServer(collection(client.db,'days',dayId,'orders'));if(orders.size>500)throw new Error('Danh sách vượt quá 500 đơn; vui lòng liên hệ người quản lý.');
 return {day,orders};
}
export async function readPickup(client:MealClient,dayId:string):Promise<PickupState>{
 const user=await ensureUser(client.auth),{day,orders}=await roster(client,dayId),date=day.data()!.date,week=pickupWeek(date);
 const snapshots=await getDocsFromServer(query(collection(client.db,'pickupDraws'),where('weekStart','==',week.start)));
 const history=snapshots.docs.map(s=>readDraw(s)!).sort((a,b)=>a.date.localeCompare(b.date));
 if(client.auth.currentUser?.uid!==user.uid)throw new Error('Phiên đặt cơm đã thay đổi. Vui lòng tải lại.');
 return {dayId,date,weekStart:week.start,weekEnd:week.end,candidates:pickupCandidates(orders.docs.map(o=>({name:o.data().name,cancelled:o.data().cancelled})),history),history,draw:history.find(d=>d.date===date)||null,closed:day.data()!.status==='closed'};
}
export async function drawPickup(client:MealClient,dayId:string,count:number){
 const user=await ensureUser(client.auth);if(!await client.isAdmin())throw new Error('Chỉ người quản lý được quay và lưu kết quả lấy cơm.');
 const initial=await readPickup(client,dayId);if(initial.date!==localNow().date)throw new Error('Chỉ quay cho ngày hôm nay theo giờ Việt Nam.');
 if(initial.draw)return {draw:initial.draw,candidates:initial.candidates,created:false};
 choosePickup(initial.candidates,count,()=>0); // Validate before closing the roster.
 const dayRef=doc(client.db,'days',dayId),drawRef=doc(client.db,'pickupDraws',initial.date);
 // Close before querying orders: no guest order can enter or leave the roster
 // between the query and the final transaction. A changed day version is rejected.
 try{await runTransaction(client.db,async tx=>{const [day,existing]=await Promise.all([tx.get(dayRef),tx.get(drawRef)]);if(existing.exists())return;if(!day.exists()||day.data().date!==initial.date)throw new Error('Ngày đặt cơm vừa thay đổi. Vui lòng cập nhật.');if(day.data().status!=='closed')tx.update(dayRef,{status:'closed',updatedAt:serverTimestamp(),...dayClosureFields(day.data(),'closed')});});}catch(error){
  // Concurrent closers may be evaluated against the winning dispatch before the
  // SDK sees a version conflict. Accept only a server-confirmed closed roster;
  // the final draw transaction still rechecks administrator rights and versions.
  if(!['permission-denied','aborted'].includes((error as {code?:string}).code||''))throw error;
  const winner=await getDocFromServer(dayRef),data=winner.data();
  if(!winner.exists()||data?.date!==initial.date||data.status!=='closed'||!data.closedAt||!/^[a-f0-9]{32}$/.test(data.dispatchId||''))throw error;
 }
 const locked=await roster(client,dayId),week=pickupWeek(initial.date);
 const result=await runTransaction(client.db,async tx=>{
  const [day,...draws]=await Promise.all([tx.get(dayRef),...week.dates.map(date=>tx.get(doc(client.db,'pickupDraws',date)))]);
  const history=draws.map(readDraw).filter((d):d is PickupDraw=>!!d),existing=history.find(d=>d.date===initial.date);
  if(existing)return {draw:existing,candidates:initial.candidates,created:false};
  if(!day.exists()||day.data().status!=='closed'||!day.data().updatedAt?.isEqual(locked.day.data()!.updatedAt))throw new Error('Danh sách vừa thay đổi. Vui lòng cập nhật rồi quay lại.');
  const orders=await Promise.all(locked.orders.docs.map(o=>tx.get(o.ref)));
  const candidates=pickupCandidates(orders.filter(o=>o.exists()).map(o=>({name:o.data()!.name,cancelled:o.data()!.cancelled})),history.filter(d=>d.date<initial.date));
  const selected=choosePickup(candidates,count),data={date:initial.date,weekStart:week.start,dayId,count,candidateCount:candidates.length,selectedNames:selected.map(p=>p.name),previousCounts:selected.map(p=>p.previousCount),selectedKeys:selected.map(p=>p.key),createdBy:user.uid,createdAt:serverTimestamp(),version:1};
  tx.set(drawRef,data);appendActivity(tx,client.db,user.uid,{kind:'pickup.draw',summary:'Lưu kết quả vòng quay',dayId,details:{date:initial.date,count,selectedNames:data.selectedNames}});return {candidates,created:true};
 });
 const draw=result.created?readDraw(await getDocFromServer(drawRef)):result.draw;if(!draw)throw new Error('Chưa xác nhận được kết quả. Vui lòng cập nhật, không quay lại.');
 return {...result,draw};
}
