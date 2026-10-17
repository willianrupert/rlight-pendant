<script lang="ts">
  // ONDE: a mesa vista de cima (VISION.md). Com homing e o controle, arrasta-se
  // o fantasma e solta-se (vai direto), ou toca-se na mesa e confirma no "Ir".
  // Movendo, o mapa fica limpo e não aceita gestos: o Parar é o da barra.
  import { onDestroy, onMount } from 'svelte';
  import type { AxisLimits, MachineState, Vec3 } from '@rlight/core';
  import { MapView, destinationText, mapPad, type Point, type TableLimits } from '../lib/map-view';
  import HoldButton from './HoldButton.svelte';

  interface Props {
    limits: TableLimits;
    /** Pode arrastar o fantasma agora. */
    ghost: boolean;
    /** A máquina está andando: o mapa só mostra, nenhum gesto vale. */
    moving: boolean;
    frozen: boolean;
    offset: Point;
    /** Sem homing (e sem alarme): o mapa pede o homing, com o botão ali mesmo. */
    needsHoming: boolean;
    homingPending: string | null;
    /** O estado e a velocidade reportados, para mostrar a velocidade real. */
    machineState: MachineState | null;
    feed: number;
    /** Curso do Z e zero da peça (coordenada de máquina), para a régua vertical. */
    zLimits: AxisLimits | null;
    zZero: number | null;
    onjog: (p: Point) => void;
    ongrab: () => void;
    onhome: () => void;
  }

  let { limits, ghost, moving, frozen, offset, needsHoming, homingPending, machineState, feed, zLimits, zZero, onjog, ongrab, onhome }: Props = $props();
  let gauge: HTMLElement;

  let svg: SVGSVGElement;
  let view: MapView | null = null;
  let dest = $state<Point | null>(null);
  let preview = $state<Point | null>(null);
  let pill = $state<{ x: number; y: number; w: number } | null>(null);

  export function push(mpos: Vec3, at: number): void {
    view?.push({ x: mpos.x, y: mpos.y, z: mpos.z }, at);
  }

  export function clear(): void {
    view?.clear();
  }

  onMount(() => {
    view = new MapView(svg, limits);
    view.attachGauge(gauge);
    view.onGhost = (p) => (dest = p);
    view.onRelease = (p) => onjog(p);
    view.onGrab = () => ongrab();
    view.onPreview = (p) => {
      preview = p;
      if (p) {
        ongrab();
        const at = view!.toScreen(p);
        pill = { ...at, w: svg.getBoundingClientRect().width };
      } else pill = null;
    };
    view.start();
  });

  onDestroy(() => view?.destroy());

  $effect(() => {
    if (!view) return;
    view.enabled = ghost && !moving;
    view.frozen = frozen;
    if (!view.enabled) {
      view.model.cancel();
      preview = null;
      pill = null;
    }
  });

  $effect(() => {
    view?.setLimits(limits);
  });

  $effect(() => {
    if (!view) return;
    view.state = machineState;
    view.feed = feed;
  });

  function go() {
    const p = view?.model.go();
    preview = null;
    pill = null;
    if (p) onjog(p);
  }

  $effect(() => {
    if (!view) return;
    view.zLimits = zLimits;
    view.zZero = zZero;
  });

  const aspect = $derived((limits.x.max - limits.x.min + 2 * mapPad(limits)) / Math.max(1, limits.y.max - limits.y.min + 2 * mapPad(limits)));
</script>

<section class="map" class:active={ghost && !moving} aria-label="A mesa vista de cima">
  <div class="row">
    <svg bind:this={svg} style:aspect-ratio={aspect} role="img" aria-label="Posição na mesa"></svg>
    <div class="zgauge" bind:this={gauge} aria-hidden="true"><span class="zlabel">Z</span></div>
  </div>
  {#if pill && preview && !moving}
    <!-- Um toque na mesa só prepara: quem move é o "Ir". -->
    <button
      class="go"
      style:left="{Math.min(pill.w - 70, Math.max(6, pill.x + 18))}px"
      style:top="{Math.max(6, pill.y - 24)}px"
      onclick={go}
      aria-label="Ir até {destinationText(preview, offset)}">Ir</button
    >
  {/if}
  {#if needsHoming && !moving}
    <div class="homing">
      <p>Faça o homing para mover pelo mapa</p>
      <HoldButton label="Homing" hold tone="primary" pending={homingPending} onfire={onhome} />
    </div>
  {:else if !moving && (dest || preview || ghost)}
    <p class="caption" class:dest={!!(dest || preview)}>
      <span>
        {#if dest || preview}
          {destinationText((dest ?? preview)!, offset)}
        {:else}
          Arraste o ponto, ou toque na mesa
        {/if}
      </span>
    </p>
  {/if}
</section>

<style>
  .map { position: relative; }
  .row { display: flex; gap: 8px; align-items: stretch; }
  svg {
    display: block;
    flex: 1;
    min-width: 0;
    width: 100%;
    border-radius: 18px;
    background: var(--panel);
    touch-action: none;
  }
  /* A altura, sem 3D: uma régua vertical fina com a ferramenta e o zero da peça. */
  .zgauge { position: relative; width: 26px; border-radius: 13px; background: var(--panel); overflow: hidden; }
  .zlabel { position: absolute; bottom: 4px; left: 0; right: 0; text-align: center; font: 600 10px var(--sans); color: var(--fg-3); }
  .zgauge :global(.ztool) {
    position: absolute; left: 4px; right: 4px; top: 8px; height: 4px; border-radius: 2px; background: var(--fg);
    will-change: transform;
  }
  .zgauge :global(.zzero) { position: absolute; left: 0; right: 0; top: 9px; height: 2px; background: var(--zero); opacity: 0.85; }
  .zgauge:global(.at-zero) :global(.ztool) { background: var(--zero); }
  .map :global(.zring) { fill: none; stroke: var(--zero); stroke-width: 2; vector-effect: non-scaling-stroke; }
  .map :global(.bed) { fill: rgba(255, 255, 255, 0.025); stroke: var(--line-2); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .map :global(.grid line) { stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .map :global(.real) { fill: var(--fg); }
  .map :global(.halo) { fill: var(--acc); opacity: 0.16; }
  .map.active :global(.halo) { opacity: 0.22; }
  .map :global(.ghost circle) { fill: none; stroke: var(--acc); stroke-width: 2.5; vector-effect: non-scaling-stroke; }
  .map :global(.path) { stroke: var(--acc); stroke-width: 2; stroke-dasharray: 4 5; vector-effect: non-scaling-stroke; opacity: 0.8; }
  /* A legenda mora dentro do mapa, embaixo: não empurra a tela. */
  .caption {
    position: absolute; left: 0; right: 34px; bottom: 18px; margin: 0; pointer-events: none;
    font-size: 12px; color: var(--fg-3); text-align: center;
  }
  /* Uma pílula da cor do mapa: a frase fica afastada da borda e não briga com as linhas da grade. */
  .caption span { display: inline-block; padding: 3px 10px; border-radius: 999px; background: rgba(13, 15, 18, 0.55); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
  .map:global(.point-low) .caption { bottom: auto; top: 18px; }
  .caption.dest { font: 600 15px var(--mono); color: var(--acc); }
  .go {
    position: absolute;
    min-width: 64px;
    height: 44px;
    padding: 0 18px;
    border: 0;
    border-radius: 999px;
    background: var(--acc);
    color: var(--acc-ink);
    font: 700 17px var(--sans);
    cursor: pointer;
    touch-action: manipulation;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
    animation: pop 0.32s var(--spring);
  }
  .homing {
    position: absolute;
    left: 0;
    right: 34px;
    top: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 18px;
    background: rgba(13, 15, 18, 0.55);
  }
  .homing p { margin: 0; font-size: 14px; color: var(--fg-2); }
  .homing :global(button) { min-width: 140px; }
  .map :global(.trail) { stroke: var(--fg); stroke-width: 3; stroke-linecap: round; opacity: 0.28; vector-effect: non-scaling-stroke; }
  .map :global(.speed) {
    fill: var(--fg); font-family: var(--mono); font-weight: 600; font-variant-numeric: tabular-nums;
    opacity: 0; transition: opacity 0.3s;
  }
  .map :global(.speed.on) { opacity: 0.9; }
  @keyframes pop { from { transform: scale(0.6); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .go { animation: none; }
    .map :global(.speed) { transition: none; }
  }
</style>
