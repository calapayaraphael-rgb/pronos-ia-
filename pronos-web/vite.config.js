import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En dev, /api est redirige vers le backend local (evite tout souci de CORS).
// En production, on definit VITE_API_URL = https://mon-backend/api/v1
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // expose sur le reseau local (utile pour tester depuis l'iPhone en Wi-Fi)
    proxy: {
      "/api": { target: process.env.BACKEND_URL || "http://localhost:8080", changeOrigin: true },
    },
  },
});
