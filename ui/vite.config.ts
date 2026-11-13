import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The build lands in internal/web/static, which the Go binary embeds.
// netwatch serves it under a strict CSP (no inline script/style, no data:
// fonts), so nothing may be inlined into the HTML or the CSS.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: "../internal/web/static",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:8377" },
  },
});
