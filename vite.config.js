import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(rootDir, "client"),
  base: "/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_URL || "http://127.0.0.1:3301"
      }
    }
  },
  build: {
    outDir: path.join(rootDir, "dist", "client"),
    emptyOutDir: true
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{js,jsx}"],
    setupFiles: ["src/testSetup.js"]
  }
});
