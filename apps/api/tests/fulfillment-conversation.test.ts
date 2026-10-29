import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/server.ts';
import { MemoryRepository } from '../src/repository.ts';
async function fixture() {
 const repo=new MemoryRepository();
 const call=async(path:string,body?:unknown,method=body===undefined?'GET':'POST')=>{
  const r=await handleRequest(new Request('https://ring.test/api/'+path,{method,headers:{'Content-Type':'application/json','oai-authenticated-user-id':'fulfillment-owner'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{TRUST_SITES_HEADERS:'true',DEMO_MODE:'true'},repo);
  assert.ok(r.ok,await r.clone().text()); return await r.json() as any;
 };
 await call('bootstrap');
 const session=await call('sessions',{});
 return {call,turn:(utterance:string)=>call(`sessions/${session.id}/turn`,{utterance,request_id:crypto.randomUUID()})};
}
test('pickup readback asks fulfillment and confirmation uses the configured preparation estimate',async()=>{
 const f=await fixture();
 await f.call('settings',{section:'agent',values:{pickup_minutes:23}},'PATCH');
 const added=await f.turn('One latte');
 assert.match(added.reply,/pickup or delivery/i);
 const pickup=await f.turn('Pickup');
 assert.equal(pickup.order.fulfillment.type,'pickup');
 const result=await f.turn('Yes, confirm my order.');
 assert.equal(result.order.status,'PAYMENT_PENDING');
 assert.match(result.reply,/ready.*23 minutes.*pickup/i);
 assert.doesNotMatch(result.reply,/order is saved/i);
});
test('delivery collects an address before confirmation and persists it with the order',async()=>{
 const f=await fixture(); await f.call('settings',{section:'business',values:{delivery_fee:40}},'PATCH'); await f.turn('One latte');
 const choice=await f.turn('Delivery');
 assert.equal(choice.order.fulfillment.type,'delivery');
 assert.match(choice.reply,/delivery address/i);
 const blocked=await f.turn('Yes, confirm my order.');
 assert.notEqual(blocked.order.status,'PAYMENT_PENDING');
 assert.match(blocked.reply,/delivery address/i);
 const addressed=await f.turn('100 Example Street, Apartment 2');
 assert.equal(addressed.order.fulfillment.delivery_address,'100 Example Street, Apartment 2');
 const result=await f.turn('Yes, confirm my order.');
 assert.equal(result.order.status,'PAYMENT_PENDING');
 assert.equal(result.order.fulfillment.type,'delivery');
 assert.equal(result.order.fees,40);
 assert.equal(result.order.total,114);
 assert.match(result.reply,/Delivery fee: 40.00 MXN/);
 assert.match(result.reply,/Thank you/);
 assert.match(result.reply,/ready.*15 minutes.*delivery/i);
});
