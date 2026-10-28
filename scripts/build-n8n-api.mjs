import { build } from "esbuild";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(root, ".netlify", "n8n-api");
for (const folder of ["server", "functions-source", "public"])
  await mkdir(path.join(output, folder), { recursive: true });
await build({
  entryPoints: [path.join(root, "netlify", "ingress.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: path.join(output, "server", "handler.mjs"),
});
await build({
  entryPoints: [path.join(root, "packages", "browser-phone-relay", "src", "index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: path.join(output, "server", "browser-phone-relay.mjs"),
});
await writeFile(
  path.join(output,"functions-source","browser-phone-relay.mjs"),
  `import { handleBrowserPhoneRelay } from "../server/browser-phone-relay.mjs";
export default function relay(request){return handleBrowserPhoneRelay(request,process.env);}
export const config={path:["/api/browser-phone/transport","/api/browser-phone/relay","/api/browser-phone/probe"],rateLimit:{windowLimit:20,windowSize:60,aggregateBy:["ip"]}};
`,
);
await copyFile(
  path.join(root, "public-ingress", "index.html"),
  path.join(output, "public", "index.html"),
);
await writeFile(
  path.join(output, "netlify.toml"),
  `[build]\n  publish = "public"\n  functions = "functions-source"\n[build.environment]\n  NODE_VERSION = "24"\n[functions]\n  node_bundler = "esbuild"\n`,
);
await writeFile(
  path.join(output, "functions-source", "ingress.mjs"),
  `import { handlePublicIngress } from "../server/handler.mjs";
export default function ingress(request) {
  return handlePublicIngress(request, process.env);
}
export const config = {
  path: ["/api/tools/*", "/api/automation/*", "/api/customer/*", "/api/webhooks/stripe", "/api/webhooks/elevenlabs", "/api/health"],
  rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ["ip"] }
};
`,
);
console.log(`Built API-only deployment at ${output}`);
