import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(() => ({
  server: {
    host: true,
    port: 8080,
    hmr: { overlay: false },

    // ✅ Permite abrir el dev server por Cloudflare Tunnel (HTTPS)
    allowedHosts: [
      ".trycloudflare.com", // permite cualquier subdominio tipo xxxx.trycloudflare.com
    ],
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));

