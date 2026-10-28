import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/server.ts";
import { MemoryRepository } from "../src/repository.ts";

const env = { TRUST_SITES_HEADERS: "true", CUSTOMER_APP_ORIGIN: "https://order.example" };
const details = { rfc: " XAXX010101000 ", legal_name: "CLIENTE DEMOSTRACION", postal_code: "01000", tax_regime: "616", cfdi_use: "S01" };
async function fixture() {
  const repo = new MemoryRepository();
  const call = async (path: string, method = "GET", body?: unknown, headers: Record<string,string> = {}, settings: any = env) => {
    const response = await handleRequest(new Request(`https://ring.test/api/${path}`, {
      method, headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), settings, repo);
    return { status: response.status, data: response.status === 204 ? null : await response.json() as any, response };
  };
  const owner = (path: string, method = "GET", body?: unknown) => call(path,method,body,{"oai-authenticated-user-id":"alice"});
  const created = await owner("orders","POST",{customer:{name:"Ana",phone:"+525555550123"},items:[{catalog_item_id:"latte"}]});
  const order = created.data;
  const editing = await owner(`orders/${order.id}/customer-link`,"POST",{});
  const editToken = new URL(editing.data.url).hash.slice(1);
  await call("customer/confirm","POST",{revision:order.revision,reviewed_total:74,confirmed:true},{Authorization:`Bearer ${editToken}`});
  const issued = await owner(`orders/${order.id}/receipt-link`,"POST",{});
  const token = issued.data.url ? new URL(issued.data.url).hash.slice(1) : "missing";
  const guest = (path="receipt",method="GET",body?:unknown) => call(`customer/${path}`,method,body,{Authorization:`Bearer ${token}`,Origin:env.CUSTOMER_APP_ORIGIN});
  return {repo,call,owner,order,issued,token,editToken,guest};
}

test("receipt grant lasts seven days, reports unpaid truth and cannot edit or confirm",async()=>{
  const f=await fixture();
  assert.equal(f.issued.status,201);
  assert.equal(new URL(f.issued.data.url).pathname,"/receipt");
  assert.ok(Date.parse(f.issued.data.expires_at)>Date.now()+6.99*86400000);
  const view=await f.guest();
  assert.equal(view.status,200);
  assert.equal(view.data.order.payment_status,"PENDING");
  assert.equal(view.data.editable,false);
  assert.equal(view.data.order.reference,f.order.external_reference);
  assert.deepEqual(view.data.billing,{status:"NOT_REQUESTED",revision:0,rfc_masked:null});
  assert.equal((await f.guest("order","PATCH",{revision:0,operations:[]})).status,403);
  assert.equal((await f.guest("confirm","POST",{confirmed:true,revision:0,reviewed_total:74})).status,403);
  assert.equal((await f.call("customer/receipt","GET",undefined,{Authorization:`Bearer ${f.editToken}`})).status,403);
  assert.equal(JSON.stringify(await f.repo.loadByMerchant(f.order.merchant_id)).includes(f.token),false);
});

test("billing is normalized, masked to the guest and absent from general owner and staff views",async()=>{
  const f=await fixture();
  const save=await f.guest("billing","PUT",{revision:0,details});
  assert.equal(save.status,200,JSON.stringify(save.data));
  assert.deepEqual(save.data,{status:"DETAILS_RECEIVED",revision:1,rfc_masked:"*********1000"});
  const fiscal=await f.owner(`orders/${f.order.id}/billing`);
  assert.equal(fiscal.status,200);
  assert.equal(fiscal.data.details.rfc,"XAXX010101000");
  for (const path of ["bootstrap","orders",`orders/${f.order.id}`]) {
    const result=await f.owner(path);
    assert.equal(JSON.stringify(result.data).includes("XAXX010101000"),false,path);
    assert.equal(JSON.stringify(result.data).includes("CLIENTE DEMOSTRACION"),false,path);
  }
  assert.equal(JSON.stringify((await f.guest()).data).includes("XAXX010101000"),false);
  for (const role of ["MANAGER","STAFF"] as const) {
    f.repo.members.push({merchant_id:f.order.merchant_id,subject:`sites:${role}`,name:role,email:`${role}@example.test`,role});
    assert.equal((await f.call(`orders/${f.order.id}/billing`,"GET",undefined,{"oai-authenticated-user-id":role})).status,403);
    assert.equal((await f.call(`orders/${f.order.id}/receipt-link`,"POST",{},{"oai-authenticated-user-id":role})).status,403);
  }
  const row=(await f.repo.loadByMerchant(f.order.merchant_id))!;
  assert.equal(JSON.stringify(row.state.events).includes("XAXX010101000"),false);
});

test("billing rejects stale, malformed and injected fields without changing saved details",async()=>{
  const f=await fixture();
  assert.equal((await f.guest("billing","PUT",{revision:0,details})).status,200);
  assert.equal((await f.guest("billing","PUT",{revision:0,details:{...details,legal_name:"STALE"}})).status,409);
  for(const change of [{rfc:"bad"},{postal_code:"1000"},{legal_name:""},{email:"bad"},{tax_regime:"hello"},{cfdi_use:"anything"},{merchant_id:"other"}])
    assert.equal((await f.guest("billing","PUT",{revision:1,details:{...details,...change}})).status,422,JSON.stringify(change));
  assert.equal((await f.owner(`orders/${f.order.id}/billing`)).data.details.legal_name,"CLIENTE DEMOSTRACION");
});

test("receipt replacement/revocation/expiry are independent from editing grants",async()=>{
  const f=await fixture();
  const replacement=await f.owner(`orders/${f.order.id}/receipt-link`,"POST",{});
  assert.equal(replacement.status,201);
  assert.equal((await f.guest()).status,401);
  assert.equal((await f.call("customer/order","GET",undefined,{Authorization:`Bearer ${f.editToken}`})).status,200);
  const fresh={Authorization:`Bearer ${new URL(replacement.data.url).hash.slice(1)}`};
  assert.equal((await f.call("customer/receipt","GET",undefined,fresh)).status,200);
  const row=(await f.repo.loadByMerchant(f.order.merchant_id))!;
  row.state.order_metadata[f.order.id].receipt_link!.expires_at=new Date(Date.now()-1).toISOString();
  await f.repo.saveTrusted(f.order.merchant_id,row.revision,row.state);
  assert.equal((await f.call("customer/receipt","GET",undefined,fresh)).status,401);
  await f.owner(`orders/${f.order.id}/receipt-link`,"POST",{});
  assert.equal((await f.owner(`orders/${f.order.id}/receipt-link`,"DELETE")).status,200);
  assert.equal((await f.call("customer/receipt","GET",undefined,fresh)).status,401);
});

test("receipt uses backend paid status and cannot reopen checkout after payment",async()=>{
  const f=await fixture();
  assert.equal((await f.guest("checkout","POST",{})).status,503);
  await f.owner(`orders/${f.order.id}/action`,"POST",{action:"demo_pay"});
  assert.equal((await f.guest()).data.order.payment_status,"PAID");
  assert.equal((await f.guest("checkout","POST",{})).status,409);
});

test("receipt token cannot be forged to select another order or tenant and is never cached",async()=>{
  const f=await fixture();
  const payload=JSON.parse(Buffer.from(f.token,"base64url").toString());
  for (const mutation of [{order_id:"another"},{merchant_id:"another"},{scope:"order"}]) {
    const forged=Buffer.from(JSON.stringify({...payload,...mutation})).toString("base64url");
    assert.equal((await f.call("customer/receipt","GET",undefined,{Authorization:`Bearer ${forged}`})).status,401);
  }
  const issued=await f.call(`orders/${f.order.id}/receipt-link`,"POST",{},{"oai-authenticated-user-id":"alice","Idempotency-Key":"receipt-cache"});
  const token=new URL(issued.data.url).hash.slice(1);
  assert.equal(JSON.stringify(await f.repo.loadByMerchant(f.order.merchant_id)).includes(token),false);
  const cors=await f.call("customer/billing","OPTIONS",undefined,{Origin:env.CUSTOMER_APP_ORIGIN,"Access-Control-Request-Method":"PUT"});
  assert.equal(cors.status,204);
  assert.equal(cors.response.headers.get("Access-Control-Allow-Origin"),env.CUSTOMER_APP_ORIGIN);
});
