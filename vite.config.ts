import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";

export default defineConfig(() => ({
  server: {
    host: true,
    port: 8080,

    // ✅ HTTPS local real (Safari + geolocalización)
   https:
  process.env.NODE_ENV === "development" &&
  fs.existsSync("localhost+2-key.pem") &&
  fs.existsSync("localhost+2.pem")
    ? {
        key: fs.readFileSync("localhost+2-key.pem"),
        cert: fs.readFileSync("localhost+2.pem"),
      }
    : undefined,

    hmr: { overlay: false },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
