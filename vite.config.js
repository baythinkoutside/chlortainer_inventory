import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["@zxing/library"],
    esbuildOptions: {
      target: "es2020",
    },
  },
  build: {
    target: "es2020",
    commonjsOptions: {
      include: [/@zxing\/library/, /node_modules/],
    },
  },
});
