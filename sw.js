/* =============================================
   sw.js — faz o app abrir sem internet
   =============================================
   Estratégia: stale-while-revalidate no esqueleto do app.
   Entrega o que está em cache na hora (abre instantâneo,
   funciona offline) e busca a versão nova em paralelo,
   que passa a valer na próxima abertura.

   O que NUNCA passa por aqui: chamadas ao banco.
   Elas vão direto para a rede — dado de contagem em
   cache seria mentira.
   ============================================= */
// SEMPRE suba este número ao publicar: é ele que faz o navegador
// perceber a versão nova e trocar sozinho (ver pwa.js).
const VERSAO = "v16";
const CACHE = `contagens-${VERSAO}`;

const ESQUELETO = [
  "./", "./index.html", "./importar.html", "./contar.html",
  "./divergencias.html", "./cadastro.html",
  "./estilo.css", "./config.js", "./api.js", "./local.js",
  "./index.js", "./importar.js", "./contar.js", "./divergencias.js", "./cadastro.js",
  "./pwa.js", "./manifest.json",
  "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png",
];

// O pwa.js pede para a versão nova assumir sem esperar as abas fecharem.
self.addEventListener("message", (e) => {
  if (e.data?.tipo === "assumir") self.skipWaiting();
});

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // cache:"reload" obriga a buscar do servidor. Sem isso o navegador
      // devolve a cópia dele (o GitHub Pages manda guardar por 10 minutos)
      // e a versão nova nasceria com os arquivos velhos dentro.
      .then((c) => Promise.allSettled(
        ESQUELETO.map((u) => c.add(new Request(u, { cache: "reload" })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // banco e CDN nunca vão para o cache
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const guardado = await cache.match(req, { ignoreSearch: true });
      // a busca em paralelo também ignora o cache do navegador, senão a
      // cópia guardada nunca se renova antes da hora
      const daRede = fetch(req.url, { cache: "no-cache" })
        .then((r) => { if (r && r.ok) cache.put(req, r.clone()); return r; })
        .catch(() => null);
      return guardado || (await daRede) ||
        new Response("Sem conexão e sem cópia local.", { status: 503, headers: { "Content-Type": "text/plain" } });
    })
  );
});
