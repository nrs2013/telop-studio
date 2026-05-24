import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages: https://nrs2013.github.io/telop-studio/ で公開するので、
  // 全ての asset URL に /telop-studio/ を前置する必要がある。
  // dev サーバ（localhost）では '/'。VITE_GITHUB_PAGES=1 のときだけサブパスに。
  base: process.env.VITE_GITHUB_PAGES === "1" ? "/telop-studio/" : "/",
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
