import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";

const root = import.meta.dirname;
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
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
      "/api": `http://127.0.0.1:${process.env.PORT || loadEnv(mode, root, "PORT").PORT || 3001}`,
    },
    fs: {
      strict: true,
      deny: ["**/.*", "**/.*/**", "**/*.{crt,pem}", "**/.git/**"],
    },
  },
}));
