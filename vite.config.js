import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Two outputs from one source tree:
//   npm run build          -> dist/index.html, everything inlined, openable from disk
//   npm run dev            -> normal Vite dev server with HMR
//
// The single-file build is the point. The primary user is a small advocacy org
// with no budget and sensitive data (SPEC 3, 9): they should be able to save one
// file and keep using it offline forever, with no server and nothing to trust.
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: "es2020",
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
  },
});
