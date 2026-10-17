<script lang="ts">
  // ONDE: a mesa vista de cima (VISION.md). Com homing e o controle, arrasta-se
  // o fantasma e solta-se; movendo, o mapa inteiro vira Parar.
  import { onDestroy, onMount } from 'svelte';
  import type { Vec3 } from '@rlight/core';
  import { MapView, destinationText, type Point, type TableLimits } from '../lib/map-view';

  interface Props {
    limits: TableLimits;
    /** Pode arrastar o fantasma agora. */
    ghost: boolean;
    /** A máquina se move por um comando desta tela: o mapa é o botão Parar. */
    stop: boolean;
    stopPending: boolean;
    frozen: boolean;
    offset: Point;
    /** Por que não há fantasma, quando há controle mas não há homing. */
    hint: string | null;
    onjog: (p: Point) => void;
    onstop: () => void;
    ongrab: () => void;
  }

  let { limits, ghost, stop, stopPending, frozen, offset, hint, onjog, onstop, ongrab }: Props = $props();

  let svg: SVGSVGElement;
  let view: MapView | null = null;
  let dest = $state<Point | null>(null);

  export function push(mpos: Vec3, at: number): void {
    view?.push({ x: mpos.x, y: mpos.y }, at);
  }

  export function clear(): void {
    view?.clear();
  }

  onMount(() => {
    view = new MapView(svg, limits);
    view.onGhost = (p) => (dest = p);
    view.onRelease = (p) => onjog(p);
    view.onGrab = () => ongrab();
    view.start();
  });

  onDestroy(() => view?.destroy());

  $effect(() => {
    if (!view) return;
    view.enabled = ghost && !stop;
    view.frozen = frozen;
    if (!view.enabled) view.model.cancel();
  });

  $effect(() => {
    view?.setLimits(limits);
  });

  const aspect = $derived((limits.x.max - limits.x.min) / Math.max(1, limits.y.max - limits.y.min));
</script>

<section class="map" class:active={ghost && !stop} aria-label="A mesa vista de cima">
  <svg bind:this={svg} style:aspect-ratio={aspect} role="img" aria-label="Posição na mesa"></svg>
  {#if stop}
    <button class="stop" onclick={onstop} disabled={stopPending} aria-label="Parar o movimento">
      <span>{stopPending ? 'Parando…' : 'Parar'}</span>
    </button>
  {/if}
  <p class="caption">
    {#if dest}
      <strong>{destinationText(dest, offset)}</strong>
    {:else if hint}
      {hint}
    {:else if ghost && !stop}
      Arraste o ponto e solte para ir até lá
    {:else}
      &nbsp;
    {/if}
  </p>
</section>

<style>
  .map { position: relative; display: flex; flex-direction: column; gap: 6px; }
  svg {
    display: block;
    width: 100%;
    border-radius: 18px;
    background: var(--panel);
    touch-action: none;
    overflow: visible;
  }
  .map :global(.grid line) { stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .map :global(.real) { fill: var(--fg); }
  .map :global(.halo) { fill: var(--acc); opacity: 0.16; }
  .map.active :global(.halo) { opacity: 0.22; }
  .map :global(.ghost circle) { fill: none; stroke: var(--acc); stroke-width: 2.5; vector-effect: non-scaling-stroke; }
  .map :global(.path) { stroke: var(--acc); stroke-width: 2; stroke-dasharray: 4 5; vector-effect: non-scaling-stroke; opacity: 0.8; }
  .stop {
    position: absolute;
    inset: 0 0 auto 0;
    height: calc(100% - 26px);
    border: 0;
    border-radius: 18px;
    background: rgba(10, 26, 51, 0.55);
    color: var(--fg);
    font: 700 28px var(--sans);
    cursor: pointer;
    touch-action: manipulation;
    -webkit-backdrop-filter: blur(2px);
    backdrop-filter: blur(2px);
  }
  .stop span { padding: 14px 30px; border-radius: 999px; background: var(--fg); color: var(--moving); }
  .caption { margin: 0; min-height: 20px; font-size: 13px; color: var(--fg-3); text-align: center; }
  .caption strong { font: 600 15px var(--mono); color: var(--acc); }
</style>
