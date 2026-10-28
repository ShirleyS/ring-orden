import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPinnedOutbound} from '../vendor/scripts/pinned-outbound.mjs';
test('native socket pins the checked address and preserves hostname TLS validation',async()=>{
 let options:any;let resolutions=0;let sends=0;
 const adapter=createPinnedOutbound(async()=>{resolutions++;return resolutions===1?['8.8.8.8']:['127.0.0.1'];},(opts:any,callback:any)=>{
  sends++;options=opts;return Object.assign(new EventEmitter(),{destroy(){},end(){const res=Object.assign(new EventEmitter(),{statusCode:200,destroy(){}});callback(res);res.emit('data',Buffer.from('{}'));res.emit('end');}});
 });
 assert.equal((await adapter.fetch('https://hooks.example.com/webhook/test',{headers:{},body:'{}',timeoutMs:1000})).status,200);
 assert.equal(options.hostname,'hooks.example.com');assert.equal(options.servername,'hooks.example.com');assert.equal(options.headers.Host,'hooks.example.com');assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);
 options.lookup('hooks.example.com',{},(error:unknown,address:string,family:number)=>{assert.equal(error,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);});
 assert.ok(options.checkServerIdentity('8.8.8.8',{subjectaltname:'DNS:wrong.example.com'}) instanceof Error);
 await assert.rejects(adapter.fetch('https://hooks.example.com/webhook/test',{headers:{},body:'{}',timeoutMs:1000}),/Private/);
 assert.equal(resolutions,2);assert.equal(sends,1);
});
test('native transport rejects mixed private answers and IPv4-mapped IPv6 before opening sockets',async()=>{
 for(const answers of [['8.8.8.8','::1'],['::ffff:127.0.0.1'],['169.254.169.254'],['fc00::1']]){
  let calls=0;const adapter=createPinnedOutbound(async()=>answers,()=>{calls++;});
  await assert.rejects(adapter.fetch('https://hooks.example.com/webhook/test',{headers:{},body:'{}',timeoutMs:1000}),/Private/);assert.equal(calls,0);
 }
});
test('native transport returns redirects without making a follow-up request',async()=>{
 let calls=0;const adapter=createPinnedOutbound(async()=>['8.8.8.8'],(_opts:any,callback:any)=>{
  calls++;return Object.assign(new EventEmitter(),{destroy(){},end(){callback(Object.assign(new EventEmitter(),{statusCode:302,destroy(){}}));}});
 });
 const response=await adapter.fetch('https://hooks.example.com/webhook/test',{headers:{},body:'{}',timeoutMs:1000});assert.equal(response.status,302);assert.equal(calls,1);
});
