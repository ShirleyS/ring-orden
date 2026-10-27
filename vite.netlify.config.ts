import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
  root: root + "platform/netlify",
  publicDir: root + "public",
  plugins: [react()],
  resolve: { alias: { "@": root } },
  build: { outDir: root + "dist-netlify", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 5174 },
});
