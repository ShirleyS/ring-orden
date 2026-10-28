import { build } from "esbuild";
import { mkdir, cp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(root, ".netlify", "merchant-preview");
for (const folder of ["public", "server", "functions-source"])
  await mkdir(path.join(output, folder), { recursive: true });
await cp(path.join(root, "dist-netlify"), path.join(output, "public"), {
  recursive: true,
});
await build({
  entryPoints: [path.join(root, "netlify/functions/api.mts")],
  outfile: path.join(output, "server/handler.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
await writeFile(
  path.join(output, "functions-source/api.mjs"),
  'import api from "../server/handler.mjs"; export default api; export const config={path:"/api/*"};\n',
);
await writeFile(
  path.join(output, "netlify.toml"),
  '[build]\n publish="public"\n functions="functions-source"\n[build.environment]\n NODE_VERSION="24"\n[functions]\n node_bundler="esbuild"\n[[redirects]]\n from="/*"\n to="/index.html"\n status=200\n force=false\n',
);
console.log(`Built standalone merchant preview at ${output}`);
