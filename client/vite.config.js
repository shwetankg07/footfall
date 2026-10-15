import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api goes to the local API so the dashboard and API share an origin, like the Vercel rewrite in production.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:8080" },
  },
});
