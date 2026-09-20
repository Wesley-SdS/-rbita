// ÓRBITA — service worker (PWA). App shell offline + network-first p/ navegação.
const CACHE = "orbita-v3";
const CACHE_API = "orbita-api-v1";
const SHELL = ["/", "/app", "/login", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

/**
 * Guardar no aparelho a última resposta das LEITURAS seguras.
 *
 * O dono liga e desliga isto em Ajustes (`cache.offlineLeitura`); a casca manda
 * o valor por `postMessage` a cada carga. O padrão é ligado, e o valor fica
 * também numa entrada de cache porque o service worker é desligado e religado
 * pelo navegador o tempo todo: sem isso, ele acordaria sem saber da escolha.
 */
let offlineLeitura = true;
const CHAVE_CONFIG = "/__orbita__/config";

async function lerConfigGuardada() {
  try {
    const c = await caches.open(CACHE_API);
    const r = await c.match(CHAVE_CONFIG);
    if (r) offlineLeitura = (await r.json()).offlineLeitura !== false;
  } catch {
    /* sem config guardada: vale o padrão */
  }
}

self.addEventListener("message", (event) => {
  const d = event.data;
  if (!d || d.tipo !== "orbita:config") return;
  offlineLeitura = d.offlineLeitura !== false;
  event.waitUntil(
    caches
      .open(CACHE_API)
      .then((c) => c.put(CHAVE_CONFIG, new Response(JSON.stringify({ offlineLeitura }), { headers: { "content-type": "application/json" } })))
      // desligou: o que já estava guardado tem de sair junto, senão a escolha
      // só valeria para as leituras seguintes
      .then(() => (offlineLeitura ? undefined : limparLeiturasGuardadas())),
  );
});

async function limparLeiturasGuardadas() {
  const c = await caches.open(CACHE_API);
  for (const req of await c.keys()) {
    if (new URL(req.url).pathname !== CHAVE_CONFIG) await c.delete(req);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== CACHE_API).map((k) => caches.delete(k))))
      .then(lerConfigGuardada)
      .then(() => self.clients.claim()),
  );
});

/**
 * Esta resposta pode ser guardada?
 *
 * Quem decide é o SERVIDOR, pelo `Cache-Control` que ele mesmo mandou, e não
 * uma lista de rotas aqui dentro. Só as leituras estáveis passam por
 * `leituraCacheavel` no apps/api, e só elas saem com `private, max-age=N`.
 * Qualquer rota nova de leitura entra nisto de graça, e nenhuma rota de
 * escrita entra por engano, porque `Response.json` puro não traz max-age.
 *
 * Um dia alguém vai acrescentar uma rota de leitura com dado sensível: a
 * proteção é que guardar é opt-in do servidor, não do cliente.
 */
function podeGuardar(res) {
  if (!res || !res.ok) return false;
  const cc = res.headers.get("Cache-Control") || "";
  if (cc.includes("no-store") || cc.includes("no-cache")) return false;
  return /max-age=[1-9]/.test(cc);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/")) {
    // Rede primeiro, sempre: o cache aqui é rede de segurança para abrir sem
    // conexão, nunca um atalho que mostre dado velho com a rede boa.
    if (!offlineLeitura) return;
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (podeGuardar(res)) {
            const copia = res.clone();
            caches.open(CACHE_API).then((c) => c.put(request, copia));
          }
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || Response.error())),
    );
    return;
  }

  // navegação: network-first, cai pro cache offline
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match("/app"))),
    );
    return;
  }

  // assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((res) => {
      if (res.ok && (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/icon"))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return res;
    })),
  );
});

// Web Push: mostra a notificação enviada pelo servidor (proatividade).
self.addEventListener("push", (event) => {
  let data = { title: "ÓRBITA", body: "", url: "/app" };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch { if (event.data) data.body = event.data.text(); }
  event.waitUntil(
    self.registration.showNotification(data.title || "ÓRBITA", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/app" },
    }),
  );
});

// Clicar na notificação: foca uma aba aberta ou abre o app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
