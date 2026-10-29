import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
const root = fileURLToPath(new URL(".", import.meta.url));
function workspaceEntry(
  request: { url?: string },
  _response: unknown,
  next: () => void,
) {
  const url = new URL(request.url || "/", "http://localhost");
  if (["/app", "/customer", "/integration"].includes(url.pathname.replace(/\/$/, ""))) {
    request.url = "/app/index.html" + url.search;
  }
  next();
}
export default defineConfig({
  root: root + "platform/netlify",
  publicDir: root + "public",
  plugins: [
    {
      name: "ring-orden-showcase-homepage",
      configureServer(server) {
        server.middlewares.use(workspaceEntry);
      },
      configurePreviewServer(server) {
        server.middlewares.use(workspaceEntry);
      },
      transformIndexHtml: {
        order: "pre",
        handler(html, context) {
          return context.filename === root + "platform/netlify/index.html"
            ? readFileSync(root + "showcase/index.html", "utf8")
            : html;
        },
      },
    },
    react(),
  ],
  resolve: { alias: { "@": root } },
  build: {
    outDir: root + "dist-netlify",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        homepage: root + "platform/netlify/index.html",
        workspace: root + "platform/netlify/app/index.html",
      },
    },
  },
  server: { host: "127.0.0.1", port: 5174 },
});
