// Monta o sw.js na build: depois de tudo escrito em dist/ (bundles com hash e
// public/), lista a casca, tira a versão do conteúdo dela e empacota
// web/sw/worker.ts com isso dentro. Em desenvolvimento não há service worker.

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ResolvedConfig } from 'vite';
import { precacheList } from '../src/lib/sw-routes';

const WORKER = fileURLToPath(new URL('./worker.ts', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

export function serviceWorker(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'rlight-service-worker',
    apply: 'build',
    configResolved(c) {
      config = c;
    },
    async writeBundle() {
      const out = resolve(config.root, config.build.outDir);
      const files = precacheList(walk(out).map((f) => relative(out, f)));
      // A versão muda quando qualquer arquivo da casca muda (inclusive um ícone).
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(out, f)));
      const version = hash.digest('hex').slice(0, 12);
      const result = await build({
        entryPoints: [WORKER],
        bundle: true,
        write: false,
        format: 'iife',
        target: 'es2020',
        minify: true,
        define: { __SHELL__: JSON.stringify({ version, files }) },
      });
      writeFileSync(join(out, 'sw.js'), result.outputFiles[0]!.text);
    },
  };
}
