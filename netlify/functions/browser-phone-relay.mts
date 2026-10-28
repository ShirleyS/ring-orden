import { handleBrowserPhoneRelay } from "../../packages/browser-phone-relay/src/index";
export default function relay(request:Request){return handleBrowserPhoneRelay(request,process.env);}
export const config={path:["/api/browser-phone/transport","/api/browser-phone/relay","/api/browser-phone/probe"],rateLimit:{windowLimit:20,windowSize:60,aggregateBy:["ip"]}};
