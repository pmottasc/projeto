import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // jsdom tenta carregar 'canvas' (binding nativo) — não precisamos no ambiente de testes.
      canvas: path.resolve(__dirname, "./src/test/canvas-stub.ts"),
    },
  },
});
