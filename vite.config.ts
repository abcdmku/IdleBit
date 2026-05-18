import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = "127.0.0.1";

export default defineConfig({
  plugins: [react()],
  server: {
    host,
    port: 6173,
    strictPort: true,
  },
  preview: {
    host,
    port: 4173,
    strictPort: true,
  },
});
