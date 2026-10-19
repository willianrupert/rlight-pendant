// O service worker do RLight: a casca do app (index, bundles, ícones) mora no
// aparelho e abre na hora, mesmo sem a rede da oficina. As decisões estão em
// src/lib/sw-routes.ts (testadas); aqui só a ligação com o navegador.
// Montado por web/sw/plugin.ts, que injeta __SHELL__ com a versão e os arquivos.

/// <reference lib="webworker" />
import { cacheName, cachesToKeep, routeFor } from '../src/lib/sw-routes';

declare const __SHELL__: { version: string; files: string[] };

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = cacheName(__SHELL__.version);
const precached = new Set(__SHELL__.files);
const scope = () => new URL(sw.registration.scope);

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // cache: 'reload' pula o cache HTTP: a casca nova é a da build nova, inteira.
      await cache.addAll(__SHELL__.files.map((f) => new Request(new URL(f, scope()), { cache: 'reload' })));
      // A versão nova assume sem esperar todas as telas fecharem (no iPhone, o app
      // quase nunca fecha de verdade). A tela aberta segue com o código que já
      // carregou; a anterior fica guardada para ela (cachesToKeep).
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      const keep = new Set(cachesToKeep(names, CACHE));
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  const route = routeFor({ url: new URL(req.url), method: req.method, navigate: req.mode === 'navigate' }, scope(), precached);
  // O WebSocket, o que é de fora e o que não está guardado: o navegador segue sozinho.
  if (route.kind === 'bypass' || route.kind === 'network') return;
  event.respondWith(fromShell(route.key, req));
});

/** Do aparelho primeiro (a versão atual, senão a anterior); sem ele, a rede. */
async function fromShell(key: string, req: Request): Promise<Response> {
  const url = new URL(key, scope()).href;
  const hit = (await (await caches.open(CACHE)).match(url)) ?? (await caches.match(url));
  if (hit) return hit.redirected ? unredirect(hit) : hit;
  return fetch(req);
}

/** O Safari recusa uma resposta redirecionada para uma navegação: copia o corpo. */
async function unredirect(r: Response): Promise<Response> {
  return new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers });
}
