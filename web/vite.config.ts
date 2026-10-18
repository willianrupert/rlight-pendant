import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Em desenvolvimento, o app fala com o servidor do RLight pelo mesmo endereço
// (/ws), como vai ser atrás do proxy no Proxmox (ADR-0001).
const server = process.env.RLIGHT_SERVER ?? 'ws://127.0.0.1:8787';

// VITE_DEMO=1: a demonstração pública (GitHub Pages). O FluidNC falso e o servidor
// de verdade rodam na página, com `node:net`, `ws` e `node:fs` trocados por canos
// em memória (server/demo). VITE_BASE: o caminho do site, /rlight-pendant/ no Pages.
const demo = process.env.VITE_DEMO === '1';
const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [svelte()],
  resolve: {
    alias: demo
      ? {
          $demo: at('../server/demo/in-page.ts'),
          'node:net': at('../server/demo/net.ts'),
          'node:fs': at('../server/demo/fs.ts'),
          'node:path': at('../server/demo/path.ts'),
          ws: at('../server/demo/ws.ts'),
        }
      : { $demo: at('src/lib/no-demo.ts') },
  },
  server: {
    port: 5180,
    strictPort: true,
    proxy: { '/ws': { target: server, ws: true, rewrite: () => '/' } },
  },
});
