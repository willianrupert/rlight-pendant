import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// Em desenvolvimento, o app fala com o servidor do RLight pelo mesmo endereço
// (/ws), como vai ser atrás do proxy no Proxmox (ADR-0001).
const server = process.env.RLIGHT_SERVER ?? 'ws://127.0.0.1:8787';

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: { '/ws': { target: server, ws: true, rewrite: () => '/' } },
  },
});
