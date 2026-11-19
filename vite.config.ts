import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Plugin, type Connect } from "vite";

import { apiPort, serverEnvironment } from "./server/environment";
import { isRetiredPath, isStorefrontPath } from "./shared/routes";

const documents: Connect.NextHandleFunction = (req, res, next) => {
  const [pathname, query] = (req.url ?? "/").split(/\?(.*)/s);
  if (isRetiredPath(pathname)) {
    res.statusCode = 410;
    res.end("Gone");
    return;
  }
  if (["GET", "HEAD"].includes(req.method ?? "") && isStorefrontPath(pathname))
    req.url = "/index.html" + (query ? "?" + query : "");
  next();
};
const documentRoutes: Plugin = {
  name: "storefront-documents",
  configureServer(server) {
    server.middlewares.use(documents);
  },
  configurePreviewServer(server) {
    server.middlewares.use(documents);
  },
};
const root = import.meta.dirname;
export default defineConfig({
  appType: "mpa",
  plugins: [documentRoutes, react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.join(root, "client/src"),
      "@shared": path.join(root, "shared"),
      "@assets": path.join(root, "attached_assets"),
    },
  },
  envDir: root,
  root: path.join(root, "client"),
  build: { outDir: path.join(root, "dist/public"), emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort(serverEnvironment(root).PORT)}`,
    },
    fs: {
      strict: true,
      deny: ["**/.*", "**/*.{crt,pem}", "**/.git/**"],
    },
  },
});
