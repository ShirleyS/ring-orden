import { createHash } from "node:crypto";
import { createPinnedOutbound } from "../vendor/scripts/pinned-outbound.mjs";
import { checkWebhookUrl } from "../vendor/src/lib/shared/net.ts";

type RelayEnv = { BP_RELAY_ALLOWED_ORIGINS?: unknown; [key:string]:unknown };
type Transport = { fetch(url:string,input:{headers:Record<string,string>;body:string;timeoutMs:number}):Promise<Response> };
const responseHeaders = {"Content-Type":"application/json","Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:responseHeaders});
const eventTypes=new Set(["connection.pairing","message.sent","call.start","call.end"]);

export function relayOrigins(env:RelayEnv):string[]{
 const value=String(env.BP_RELAY_ALLOWED_ORIGINS??"").trim();
 if(!value)return [];
 try{
  const list:unknown=value.startsWith("[")?JSON.parse(value):value.split(",").map(item=>item.trim());
  if(!Array.isArray(list)||list.length<1||list.length>8)return [];
  const origins=list.map(raw=>{
   if(typeof raw!=="string")throw new Error();
   const result=checkWebhookUrl(raw);
   if(!result.ok||result.url.protocol!=="https:"||result.url.pathname!=="/"||result.url.search||result.url.hash||result.url.origin!==raw)throw new Error();
   return result.url.origin;
  });
  return [...new Set(origins)];
 }catch{return [];}
}

async function readBounded(request:Request,limit:number):Promise<string>{
 if(Number(request.headers.get("Content-Length")??0)>limit)throw new Error("too_large");
 if(!request.body)return "";
 const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>limit){await reader.cancel();throw new Error("too_large");}chunks.push(next.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return new TextDecoder("utf-8",{fatal:true}).decode(bytes);
}

export async function handleBrowserPhoneRelay(request:Request,env:RelayEnv,transport:Transport=createPinnedOutbound()):Promise<Response>{
 const path=new URL(request.url).pathname;
 const allowed=relayOrigins(env);
 const enabled=allowed.length>0&&process.release.name==="node"&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=="0";
 if(path==="/api/browser-phone/transport"&&request.method==="GET")return json({enabled,transport:enabled?"node-pinned-relay":"disabled",allowed_origins:allowed,private_addresses_blocked:true,tls_verified:true,redirects_followed:false,max_body_bytes:16384,max_response_bytes:65536});
 if(path==="/api/browser-phone/probe"&&request.method==="POST"){
  try{const body=await readBounded(request,16384);return json({ok:true,raw_sha256:createHash("sha256").update(body).digest("hex"),event_type:request.headers.get("X-BrowserPhone-Event"),signature_sha256:createHash("sha256").update(request.headers.get("X-BrowserPhone-Signature")??"").digest("hex")});}
  catch{return json({error:"payload_too_large"},413);}
 }
 if(path!=="/api/browser-phone/relay")return json({error:"not_found"},404);
 if(request.method!=="POST")return json({error:"method_not_allowed"},405);
 if(!enabled)return json({error:"relay_not_configured"},503);
 if(!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json"))return json({error:"json_required"},415);
 try{
  const envelope=JSON.parse(await readBounded(request,40000));
  if(!envelope||typeof envelope!=="object"||typeof envelope.url!=="string"||typeof envelope.body!=="string")return json({error:"invalid_request"},400);
  if(Buffer.byteLength(envelope.body,"utf8")>16384)return json({error:"payload_too_large"},413);
  const target=checkWebhookUrl(envelope.url);
  if(!target.ok||target.url.protocol!=="https:"||!allowed.includes(target.url.origin))return json({error:"destination_not_allowed"},403);
  // The relay is limited to public n8n webhook paths and its own controlled probe.
  if(!/^\/webhook(?:-test)?\/[A-Za-z0-9_/-]+$/.test(target.url.pathname)&&!(target.url.origin===new URL(request.url).origin&&target.url.pathname==="/api/browser-phone/probe"))return json({error:"destination_path_not_allowed"},403);
  const headers=envelope.headers;
  const eventType=headers?.["X-BrowserPhone-Event"];
  const signature=headers?.["X-BrowserPhone-Signature"];
  const match=typeof signature==="string"&&/^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec(signature);
  if(!eventTypes.has(eventType)||!match||Math.abs(Date.now()/1000-Number(match[1]))>300)return json({error:"invalid_signature_envelope"},400);
  let event;try{event=JSON.parse(envelope.body);}catch{return json({error:"invalid_event"},400);}
  if(!event||event.type!==eventType||typeof event.id!=="string"||!event.id||event.id.length>128)return json({error:"invalid_event"},400);
  const result=await transport.fetch(target.url.toString(),{headers:{"Content-Type":"application/json","User-Agent":"BrowserPhone-Webhook/1.0","X-BrowserPhone-Event":eventType,"X-BrowserPhone-Signature":signature},body:envelope.body,timeoutMs:8000});
  if(result.status>=300&&result.status<400)return json({error:"redirects_not_followed"},502);
  const body=await readBounded(new Request("https://relay.response",{method:"POST",body:result.body,duplex:"half"} as RequestInit),65536);
  return new Response([204,205].includes(result.status)?null:body,{status:result.status,headers:responseHeaders});
 }catch(error){return json({error:error instanceof Error&&error.message==="too_large"?"payload_too_large":"relay_delivery_failed"},error instanceof Error&&error.message==="too_large"?413:502);}
}
