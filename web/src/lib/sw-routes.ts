// As decisões do service worker (web/sw/worker.ts), puras e testadas: o que
// guardar no aparelho e o que fazer com cada pedido. O app abre na hora, mesmo
// sem rede; o WebSocket nunca passa por aqui (ADR-0007: nada fica para depois).

/** O prefixo dos caches da casca; o resto do nome é a versão da build. */
export const SHELL_PREFIX = 'rlight-shell-';

export function cacheName(version: string): string {
  return SHELL_PREFIX + version;
}

const SHELL = /^(index\.html|manifest\.webmanifest|assets\/[^/]+\.(js|css|woff2?|svg|png)|icons\/[^/]+\.(png|svg|ico))$/;

/**
 * Os arquivos da build que ficam no aparelho, relativos à base do app: o
 * index, os bundles com hash, o manifesto e os ícones. Não o próprio sw.js
 * (o navegador cuida dele) nem mapas de fonte.
 */
export function precacheList(files: readonly string[]): string[] {
  const rel = files.map((f) => f.replace(/\\/g, '/').replace(/^\/+/, ''));
  if (!rel.includes('index.html')) throw new Error('precacheList: a build não tem index.html');
  return [...new Set(rel.filter((f) => SHELL.test(f)))].sort();
}

export type Route =
  /** Abrir o app: o index guardado, na hora. */
  | { kind: 'shell'; key: string }
  /** Um arquivo guardado: do aparelho. */
  | { kind: 'cache'; key: string }
  /** Do app, mas não guardado: só a rede. */
  | { kind: 'network' }
  /** Não é com o service worker: o navegador segue como se ele não existisse. */
  | { kind: 'bypass' };

export interface RouteRequest {
  url: URL;
  method: string;
  /** Uma navegação (abrir ou recarregar o app). */
  navigate: boolean;
}

export function routeFor(req: RouteRequest, scope: URL, precached: ReadonlySet<string>): Route {
  if (req.method !== 'GET' || req.url.origin !== scope.origin) return { kind: 'bypass' };
  const path = req.url.pathname;
  // O servidor mora em /ws (Caddy em produção). Na base do app também, por garantia.
  if (isWs(path, '/') || isWs(path, scope.pathname)) return { kind: 'bypass' };
  if (!path.startsWith(scope.pathname)) return { kind: 'bypass' };
  if (req.navigate) return { kind: 'shell', key: 'index.html' };
  const key = decodeURIComponent(path.slice(scope.pathname.length));
  return precached.has(key) ? { kind: 'cache', key } : { kind: 'network' };
}

function isWs(path: string, base: string): boolean {
  const ws = `${base.endsWith('/') ? base : `${base}/`}ws`;
  return path === ws || path.startsWith(`${ws}/`);
}

/**
 * Os caches que ficam ao ativar uma versão nova: ela e a anterior (uma tela
 * aberta continua rodando o código velho e pode pedir um arquivo dele), e o
 * que não é da casca.
 */
export function cachesToKeep(names: readonly string[], current: string): string[] {
  // caches.keys() vem em ordem de criação: a anterior é a última da casca antes da atual.
  const others = names.filter((n) => n.startsWith(SHELL_PREFIX) && n !== current);
  const previous = others[others.length - 1] ?? null;
  return names.filter((n) => !n.startsWith(SHELL_PREFIX) || n === current || n === previous);
}
