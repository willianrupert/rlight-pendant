declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component;
  export default component;
}
declare module '*.css';

// O simulador da demonstração, ou null na build normal (web/vite.config.ts).
declare module '$demo' {
  import type { OpenSocket } from './lib/connection';
  export const openDemoSocket: OpenSocket | null;
}
