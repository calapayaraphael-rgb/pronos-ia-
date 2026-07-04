import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./theme.css";

createRoot(document.getElementById("root")).render(<App />);

// PWA : service worker (installable depuis Safari iOS via
// « Ajouter à l'écran d'accueil »). Prod uniquement — en dev il gênerait le HMR.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
