// A build normal não tem simulador: a tela fala com o servidor de verdade.
// A build de demonstração (VITE_DEMO=1) troca este módulo por server/demo/in-page.ts.

import type { OpenSocket } from './connection';

export const openDemoSocket: OpenSocket | null = null;
