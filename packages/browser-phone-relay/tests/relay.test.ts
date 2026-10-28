import test from "node:test";
import assert from "node:assert/strict";
import { handleBrowserPhoneRelay } from "../src/index.ts";

const env={BP_RELAY_ALLOWED_ORIGINS:"https://hooks.example.com"};
const raw=JSON.stringify({id:"test-1",type:"message.sent",data:{text:"synthetic test"}});
function request(url="https://hooks.example.com/webhook/demo",body=raw){return new Request("https://ring.test/api/browser-phone/relay",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url,body,headers:{"X-BrowserPhone-Event":"message.sent","X-BrowserPhone-Signature":`t=${Math.floor(Date.now()/1000)},v1=${"a".repeat(64)}`}})});}

test("relay capability stays disabled until an exact HTTPS allowlist is configured",async()=>{
 const req=new Request("https://ring.test/api/browser-phone/transport");
 assert.equal(((await (await handleBrowserPhoneRelay(req,{})).json()) as {enabled:boolean}).enabled,false);
 const result=await handleBrowserPhoneRelay(req,env);
 assert.deepEqual(((await result.json()) as {allowed_origins:string[]}).allowed_origins,["https://hooks.example.com"]);
});

test("relay rejects arbitrary, private, credentialed and non-HTTPS targets before sending",async()=>{
 let calls=0;const transport={fetch:async()=>{calls++;return Response.json({ok:true});}};
 for(const target of ["https://evil.example/webhook/demo","http://hooks.example.com/webhook/demo","https://127.0.0.1/webhook/demo","https://[::1]/webhook/demo","https://user:pass@hooks.example.com/webhook/demo"]){
  const response=await handleBrowserPhoneRelay(request(target),env,transport);
  assert.equal(response.status,403,target);
 }
 assert.equal(calls,0);
});

test("relay preserves signed raw bytes and only forwards the Browser Phone header allowlist",async()=>{
 let observed:any;
 const response=await handleBrowserPhoneRelay(request(),env,{fetch:async(url,init)=>{observed={url,...init};return Response.json({reply:{text:"accepted"}});}});
 assert.equal(response.status,200);
 assert.equal(observed.body,raw);
 assert.equal(observed.headers["X-BrowserPhone-Event"],"message.sent");
 assert.match(observed.headers["X-BrowserPhone-Signature"],/^t=\d+,v1=[a-f0-9]{64}$/);
 assert.equal(observed.headers.Authorization,undefined);
 assert.equal(observed.timeoutMs,8000);
 assert.deepEqual(await response.json(),{reply:{text:"accepted"}});
});

test("relay refuses redirects, oversize bodies and invalid event/signature envelopes",async()=>{
 const response=await handleBrowserPhoneRelay(request(),env,{fetch:async()=>new Response(null,{status:302,headers:{Location:"https://127.0.0.1"}})});
 assert.equal(response.status,502);
 assert.equal((await handleBrowserPhoneRelay(request(undefined,"x".repeat(16385)),env)).status,413);
 assert.equal((await handleBrowserPhoneRelay(request(undefined,JSON.stringify({id:"x",type:"unknown"})),env)).status,400);
});
