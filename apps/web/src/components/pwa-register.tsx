"use client";

import { useEffect } from "react";

/** Registra o service worker da PWA (silencioso; no-op se não suportado). */
export function PWARegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // Em desenvolvimento o SW cachearia os bundles e quebraria o HMR — desregistra.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
      if ("caches" in window) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
      return;
    }
    const onLoad = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}
