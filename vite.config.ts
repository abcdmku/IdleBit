import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = "127.0.0.1";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "IdleBit";
const base = process.env.GITHUB_PAGES === "true" ? `/${repositoryName}/` : "/";

export default defineConfig({
  base,
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
