import {doc,runTransaction,serverTimestamp} from 'firebase/firestore';
import type {MealClient} from './meal-client';import {ensureUser} from './firebase-client';
import {dayClosureFields} from './day-closure';import {appendActivity} from './activity';
export async function setMealDayStatus(client:MealClient,dayId:string,status:string){
 if(!/^[\w-]{1,100}$/.test(dayId)||!['open','closed','auto'].includes(status))throw Error('Ngày hoặc trạng thái không hợp lệ.');
 const user=await ensureUser(client.auth);if(!await client.isAdmin())throw Error('Chỉ quản trị được chốt hoặc mở lại ngày đặt cơm.');
 await runTransaction(client.db,async tx=>{
  const ref=doc(client.db,'days',dayId),day=await tx.get(ref);if(!day.exists())throw Error('Cần đăng thực đơn trên web trước khi chốt cơm.');
  if(day.data().changing===true)throw Error('Ngày đang đổi nhà hàng. Hãy hoàn tất đổi nhà hàng trước.');
  tx.update(ref,{status,updatedAt:serverTimestamp(),...dayClosureFields(day.data(),status)});
  appendActivity(tx,client.db,user.uid,{kind:'menu.save',summary:status==='closed'?'Chốt ngày đặt cơm':'Đổi trạng thái nhận đơn',dayId,details:{before:day.data().status,after:status}});
 });
}
