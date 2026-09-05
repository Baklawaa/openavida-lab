import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
  build: {
    target: "es2022",
    sourcemap: true,
    assetsInlineLimit: 0,
  },
});
