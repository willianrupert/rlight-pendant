import { describe, expect, it } from 'vitest';
import { SHELL_PREFIX, cacheName, cachesToKeep, precacheList, routeFor } from './sw-routes';

// O app abre na hora, mesmo sem rede: a casca (index, bundles, ícones) mora no
// aparelho; o WebSocket nunca passa pelo service worker.

describe('precacheList: o que fica guardado no aparelho', () => {
  const built = [
    'index.html',
    'assets/index-a1b2c3.js',
    'assets/index-d4e5f6.css',
    'assets/index-a1b2c3.js.map',
    'manifest.webmanifest',
    'icons/icon-180.png',
    'icons/icon-512.png',
    'icons/favicon-32.png',
    'sw.js',
    '.DS_Store',
  ];

  it('a casca inteira, sem o próprio service worker nem mapas de fonte', () => {
    expect(precacheList(built)).toEqual([
      'assets/index-a1b2c3.js',
      'assets/index-d4e5f6.css',
      'icons/favicon-32.png',
      'icons/icon-180.png',
      'icons/icon-512.png',
      'index.html',
      'manifest.webmanifest',
    ]);
  });

  it('sem index.html não há casca: a build está errada', () => {
    expect(() => precacheList(['assets/x.js'])).toThrow(/index\.html/);
  });

  it('caminhos com barra no início ou do Windows viram relativos', () => {
    expect(precacheList(['/index.html', 'assets\\a.js'])).toEqual(['assets/a.js', 'index.html']);
  });
});

describe('routeFor: o que o service worker faz com cada pedido', () => {
  const precached = new Set(['index.html', 'assets/index-a1b2c3.js', 'manifest.webmanifest']);

  for (const base of ['/', '/rlight-pendant/']) {
    const scope = new URL(`https://exemplo.test${base}`);
    const at = (p: string) => new URL(p, scope);

    describe(`em ${base}`, () => {
      it('abrir o app (navegação) é a casca guardada', () => {
        expect(routeFor({ url: at(''), method: 'GET', navigate: true }, scope, precached)).toEqual({ kind: 'shell', key: 'index.html' });
        // Qualquer caminho do app volta para o index (como o try_files do Caddy).
        expect(routeFor({ url: at('qualquer/coisa'), method: 'GET', navigate: true }, scope, precached)).toEqual({ kind: 'shell', key: 'index.html' });
      });

      it('um arquivo guardado vem do aparelho', () => {
        expect(routeFor({ url: at('assets/index-a1b2c3.js'), method: 'GET', navigate: false }, scope, precached)).toEqual({
          kind: 'cache',
          key: 'assets/index-a1b2c3.js',
        });
        // A consulta (?v=) não troca o arquivo.
        expect(routeFor({ url: at('manifest.webmanifest?v=2'), method: 'GET', navigate: false }, scope, precached)).toEqual({
          kind: 'cache',
          key: 'manifest.webmanifest',
        });
      });

      it('o WebSocket e tudo sob /ws nunca passam pelo service worker', () => {
        expect(routeFor({ url: new URL('/ws', scope), method: 'GET', navigate: false }, scope, precached).kind).toBe('bypass');
        expect(routeFor({ url: new URL('/ws/x', scope), method: 'GET', navigate: true }, scope, precached).kind).toBe('bypass');
        expect(routeFor({ url: at('ws'), method: 'GET', navigate: false }, scope, precached).kind).toBe('bypass');
      });

      it('o resto vai para a rede, sem guardar', () => {
        expect(routeFor({ url: at('outro.json'), method: 'GET', navigate: false }, scope, precached).kind).toBe('network');
      });

      it('fora do app, outro site ou outro método: não mexe', () => {
        expect(routeFor({ url: new URL('https://outro.test/a.js'), method: 'GET', navigate: false }, scope, precached).kind).toBe('bypass');
        expect(routeFor({ url: at('index.html'), method: 'POST', navigate: false }, scope, precached).kind).toBe('bypass');
      });
    });
  }

  it('no Pages, um caminho fora de /rlight-pendant/ não é do app', () => {
    const scope = new URL('https://exemplo.test/rlight-pendant/');
    expect(routeFor({ url: new URL('https://exemplo.test/outro/', scope), method: 'GET', navigate: true }, scope, precached).kind).toBe('bypass');
  });
});

describe('versões da casca', () => {
  it('o nome do cache leva a versão da build', () => {
    expect(cacheName('abc123')).toBe(`${SHELL_PREFIX}abc123`);
  });

  it('ao ativar, fica a versão nova e a anterior (uma tela aberta ainda pode pedir um arquivo dela)', () => {
    // caches.keys() vem em ordem de criação: a anterior é a última antes da atual.
    const names = [cacheName('v1'), cacheName('v2'), 'outra-coisa', cacheName('v3')];
    expect(cachesToKeep(names, cacheName('v3'))).toEqual([cacheName('v2'), 'outra-coisa', cacheName('v3')]);
  });

  it('a primeira versão fica sozinha (e o que não é nosso)', () => {
    expect(cachesToKeep([cacheName('v2'), 'x'], cacheName('v2'))).toEqual([cacheName('v2'), 'x']);
  });
});
