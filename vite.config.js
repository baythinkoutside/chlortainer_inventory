import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  build: {
    rollupOptions: {
      output: {
        // Single bundle — no chunk splitting, no load order issues
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
  },
});
