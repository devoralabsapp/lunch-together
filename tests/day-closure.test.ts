import test from 'node:test';import assert from 'node:assert/strict';
import {Timestamp} from 'firebase/firestore';
import {canReopenDay,dayClosureFields,REOPEN_WINDOW_MS} from '../lib/day-closure';
test('first closure anchors the exact reopening boundary and redispatch does not extend it',()=>{
 const start=Date.parse('2026-10-29T02:30:00Z'),closedAt=Timestamp.fromMillis(start),day={status:'closed',closedAt,dispatchId:'a'.repeat(32)};
 assert.equal(canReopenDay(day,start+REOPEN_WINDOW_MS),true);assert.equal(canReopenDay(day,start+REOPEN_WINDOW_MS+1),false);
 assert.throws(()=>dayClosureFields(day,'open',start+REOPEN_WINDOW_MS+1),/15 phút/);
 const reopened={...day,...dayClosureFields(day,'open',start+1000),status:'open'};
 const again=dayClosureFields(reopened,'closed',start+2000);assert.equal(again.closedAt,closedAt);assert.notEqual(again.dispatchId,day.dispatchId);
 assert.equal(canReopenDay({...day,closedAt:closedAt.toDate().toISOString()},start+REOPEN_WINDOW_MS+1),false);
});
test('legacy closed days use cutoff as deadline; ordinary menu edits retain dispatch identity',()=>{
 const cutoffAt=Timestamp.fromMillis(1000),legacy={status:'closed',cutoffAt};
 assert.equal(canReopenDay(legacy,901001),false);assert.throws(()=>dayClosureFields(legacy,'auto',901001));
 assert.equal(dayClosureFields(legacy,'closed',901001).closedAt,cutoffAt);
 const old={status:'closed',closedAt:cutoffAt,dispatchId:'a'.repeat(32)};assert.deepEqual(dayClosureFields(old,'closed'),{closedAt:cutoffAt,dispatchId:old.dispatchId});
 assert.deepEqual(dayClosureFields(undefined,'open'),{});
});
