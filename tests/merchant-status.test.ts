import test from 'node:test';import assert from 'node:assert/strict';
import {merchantOrderHash} from '../lib/merchant-status';
import type {Order} from '../lib/types';
test('merchant acknowledgment fingerprints track preparation instructions without payment-only changes',async()=>{
 const a={id:'a',dish:'Món mẫu',quantity:2,price:40000,note:'Ít cơm',cancelled:false,paid:false,updatedAt:'2026-10-28T02:00:00Z'} as Order,b={...a,id:'b'};
 assert.equal(await merchantOrderHash([a,b]),await merchantOrderHash([b,a]));
 assert.equal(await merchantOrderHash([a]),await merchantOrderHash([{...a,paid:true,receivedAmount:80000,updatedAt:'2026-10-28T03:00:00Z'}]));
 assert.notEqual(await merchantOrderHash([a]),await merchantOrderHash([{...a,note:'Không hành'}]));
 assert.notEqual(await merchantOrderHash([a]),await merchantOrderHash([{...a,cancelled:true}]));
 assert.equal((await merchantOrderHash([a])).length,64);
});
