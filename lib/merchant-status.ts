import type {Order} from './types';
// Merchant protocol v1: operational edits, excluding payment-only changes.
export async function merchantOrderHash(orders:Order[]){
 const text=JSON.stringify([...orders].sort((a,b)=>a.id.localeCompare(b.id)).map(o=>[o.id,o.dish,o.quantity,o.price,o.note,o.cancelled]));
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(n=>n.toString(16).padStart(2,'0')).join('');
}
