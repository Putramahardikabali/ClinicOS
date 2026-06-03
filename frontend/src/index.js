import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { loadPlatformBranding } from "@/lib/platformBranding";

function removeEmergentBadge() {
  document.getElementById("emergent-badge")?.remove();
  document.querySelectorAll('a[href*="app.emergent.sh"], a[href*="emergent-badge"]').forEach((el) => {
    if (/made with emergent/i.test(el.textContent || "")) el.remove();
  });
}

removeEmergentBadge();
document.addEventListener("DOMContentLoaded", removeEmergentBadge);
if (document.body) {
  new MutationObserver(removeEmergentBadge).observe(document.body, { childList: true, subtree: true });
}

(async () => {
  await loadPlatformBranding();
  const enableSw =
    process.env.NODE_ENV === "production"
    || process.env.REACT_APP_APP_ENV === "production"
    || process.env.REACT_APP_APP_ENV === "production_beta";
  if ("serviceWorker" in navigator && enableSw) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    });
  }
  const root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
})();
