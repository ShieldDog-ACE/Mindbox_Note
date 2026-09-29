import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { port: 5173, strictPort: true },
  build: {
    outDir: "dist",
    reportCompressedSize: false, // 跳过 gzip 统计,加快构建
    chunkSizeWarningLimit: 1500,
  },
});
