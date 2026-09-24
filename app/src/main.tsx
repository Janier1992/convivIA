import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Actualiza en segundo plano; sólo pide recargar cuando ya hay una versión
// nueva lista, para no interrumpir a alguien completando una reserva.
const updateSW = registerSW({
  onNeedRefresh() {
    toast("Hay una nueva versión disponible.", {
      action: { label: "Actualizar", onClick: () => updateSW(true) },
      duration: Infinity
    });
  }
});
