import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
  },
  define: {
    // Excalidraw checks this; required for it to render correctly.
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  build: {
    sourcemap: true,
    target: "es2022",
  },
});
