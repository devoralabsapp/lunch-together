import test from 'node:test';
import assert from 'node:assert/strict';
import {restaurantSummary,restaurantTotals,type RestaurantSummary} from '../lib/restaurant-summary';
import {restaurantDisplayRows,restaurantNoteLines} from '../lib/restaurant-presentation';
import type {Order} from '../lib/types';
const order=(quantity:number,note='',price=40000,cancelled=false)=>({id:'private-order',dayId:'private-day',name:'PRIVATE PERSON',actor:'private-owner',dish:'Cơm gà mẫu',price,quantity,note,cancelled,paid:true,updatedAt:''} as Order);

test('eight servings with only one special note clearly identify the affected serving',()=>{
 const summary=restaurantSummary('2026-10-27',[...Array.from({length:7},()=>order(1)),order(1,'Ít cơm, không hành')]),original=JSON.stringify(summary);
 const rows=restaurantDisplayRows(summary);assert.equal(rows.length,1);assert.equal(rows[0].quantity,8);
 assert.deepEqual(restaurantNoteLines(rows[0],'vi'),['1 suất: Ít cơm, không hành','7 suất không có ghi chú']);
 assert.deepEqual(restaurantNoteLines(rows[0],'en'),['1 serving: Ít cơm, không hành','7 servings without notes']);
 assert.equal(rows[0].quantity*rows[0].unitPrice,restaurantTotals(summary).amount);assert.equal(JSON.stringify(summary),original);
 for(const identity of ['PRIVATE PERSON','private-owner','private-order','paid'])assert.equal(JSON.stringify(rows).includes(identity),false);
});

test('note counts sum servings rather than people and preserve distinct prices and notes',()=>{
 const summary=restaurantSummary('2026-10-27',[order(3,' Ít cơm '),order(2,'Ít cơm'),order(1,'Không hành'),order(1),order(2,'Ít cơm',45000),order(20,'Ít cơm',40000,true)]);
 const rows=restaurantDisplayRows(summary);assert.equal(rows.length,2);assert.equal(rows[0].quantity,7);assert.equal(rows[1].quantity,2);
 assert.deepEqual(rows[0].notes,[{text:'Ít cơm',quantity:5},{text:'Không hành',quantity:1}]);
 assert.deepEqual(restaurantNoteLines(rows[0],'en'),['5 servings: Ít cơm','1 serving: Không hành','1 serving without notes']);
 assert.deepEqual(restaurantNoteLines(rows[1],'vi'),['2 suất: Ít cơm']);
 assert.equal(rows.reduce((n,row)=>n+row.quantity*row.unitPrice,0),restaurantTotals(summary).amount);
});

test('ordinary rows stay uncluttered and existing version-one shared snapshots remain compatible',()=>{
 const snapshot:RestaurantSummary={version:1,date:'2026-10-23',generatedAt:'2026-10-23T01:00:00.000Z',rows:[{dish:'Món mẫu',quantity:2,unitPrice:50000,note:''},{dish:'Món mẫu',quantity:3,unitPrice:50000,note:'Không hành'}]};
 assert.deepEqual(restaurantNoteLines(restaurantDisplayRows(snapshot)[0],'vi'),['3 suất: Không hành','2 suất không có ghi chú']);
 assert.deepEqual(restaurantNoteLines(restaurantDisplayRows({...snapshot,rows:[snapshot.rows[0]]})[0],'vi'),[]);
});

test('many distinct notes are retained without losing or duplicating quantities',()=>{
 const summary=restaurantSummary('2026-10-27',Array.from({length:100},(_,i)=>order(i%3+1,'Ghi chú mẫu '+i)));
 const rows=restaurantDisplayRows(summary);assert.equal(rows.length,1);assert.equal(rows[0].notes.length,100);
 assert.equal(rows[0].notes.reduce((n,note)=>n+note.quantity,0),restaurantTotals(summary).quantity);
 assert.equal(restaurantNoteLines(rows[0],'vi').length,100);
});
