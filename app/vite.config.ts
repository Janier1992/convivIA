import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/apple-touch-icon.png"],
      // injectManifest (en vez de generateSW): las notificaciones push
      // necesitan un service worker propio que escuche los eventos "push" y
      // "notificationclick" (ver src/sw.ts) — generateSW arma un SW
      // automático que no permite agregar ese código.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      manifest: {
        name: "ConvivIA — Administración de copropiedades",
        short_name: "ConvivIA",
        description: "Cartera, pagos, PQRS, reservas de zonas comunes y comunicados de tu copropiedad.",
        lang: "es",
        start_url: "/dashboard",
        scope: "/",
        display: "standalone",
        theme_color: "#174A8B",
        background_color: "#F4F7FA",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      injectManifest: {
        // Sólo se precachea el shell de la app (HTML/JS/CSS/íconos) para que
        // abra instantáneo/offline como shell. No se agrega runtime caching:
        // los datos de la copropiedad van siempre a InsForge por red,
        // nunca deben servirse desde cache.
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"]
      },
      devOptions: {
        enabled: false
      }
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    port: 5173
  },
  build: {
    rollupOptions: {
      output: {
        // Separa las librerías grandes del código de la app en sus propios
        // chunks: cambian mucho menos seguido que las páginas, así que el
        // navegador los cachea por más tiempo entre deploys, y evita el
        // chunk único de >500kB que mezclaba todo el vendor code.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-radix": [
            "@radix-ui/react-avatar",
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-label",
            "@radix-ui/react-select",
            "@radix-ui/react-switch",
            "@radix-ui/react-tabs",
            "@radix-ui/react-toast"
          ]
        }
      }
    }
  }
});
