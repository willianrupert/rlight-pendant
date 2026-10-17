<script lang="ts">
  // ONDE: a mesa vista de cima (VISION.md). Com homing e o controle, arrasta-se
  // o fantasma e solta-se; movendo, o mapa inteiro vira Parar.
  import { onDestroy, onMount } from 'svelte';
  import type { Vec3 } from '@rlight/core';
  import { MapView, destinationText, mapPad, type Point, type TableLimits } from '../lib/map-view';

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

  const aspect = $derived((limits.x.max - limits.x.min + 2 * mapPad(limits)) / Math.max(1, limits.y.max - limits.y.min + 2 * mapPad(limits)));
</script>

<section class="map" class:active={ghost && !stop} aria-label="A mesa vista de cima">
  <svg bind:this={svg} style:aspect-ratio={aspect} role="img" aria-label="Posição na mesa"></svg>
  {#if stop}
    <button class="stop" onclick={onstop} disabled={stopPending} aria-label="Parar o movimento">
      <span>{stopPending ? 'Parando…' : 'Parar'}</span>
    </button>
  {/if}
  {#if !stop && (dest || hint || ghost)}
    <p class="caption" class:dest={!!dest}>
      {#if dest}
        {destinationText(dest, offset)}
      {:else if hint}
        {hint}
      {:else}
        Arraste o ponto e solte para ir até lá
      {/if}
    </p>
  {/if}
</section>

<style>
  .map { position: relative; }
  svg {
    display: block;
    width: 100%;
    border-radius: 18px;
    background: var(--panel);
    touch-action: none;
  }
  .map :global(.bed) { fill: rgba(255, 255, 255, 0.025); stroke: var(--line-2); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .map :global(.grid line) { stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .map :global(.real) { fill: var(--fg); }
  .map :global(.halo) { fill: var(--acc); opacity: 0.16; }
  .map.active :global(.halo) { opacity: 0.22; }
  .map :global(.ghost circle) { fill: none; stroke: var(--acc); stroke-width: 2.5; vector-effect: non-scaling-stroke; }
  .map :global(.path) { stroke: var(--acc); stroke-width: 2; stroke-dasharray: 4 5; vector-effect: non-scaling-stroke; opacity: 0.8; }
  .stop {
    position: absolute;
    inset: 0 0 auto 0;
    height: 100%;
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
  /* A legenda mora dentro do mapa, embaixo: não empurra a tela. */
  .caption {
    position: absolute; left: 0; right: 0; bottom: 8px; margin: 0; pointer-events: none;
    font-size: 12px; color: var(--fg-3); text-align: center;
  }
  .caption.dest { font: 600 15px var(--mono); color: var(--acc); }
</style>
