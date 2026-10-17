<script lang="ts">
  // A régua (ADR-0010) com as três pílulas de passo. O gesto e o desenho moram
  // em lib/ruler-view.ts; aqui só a casca e as pílulas.
  import { onDestroy, onMount } from 'svelte';
  import { stepOptions, type Axis, type AxisLimits } from '@rlight/core';
  import type { CommandRequest } from '../lib/connection';
  import type { Clicker } from '../lib/feel';
  import { formatMm } from '../lib/present';
  import { RulerModel, RulerView } from '../lib/ruler-view';

  interface Props {
    axis: Axis;
    minStep: number;
    send: (req: CommandRequest) => void;
    clicker: Clicker;
  }

  let { axis, minStep, send, clicker }: Props = $props();

  const STEP_KEY = 'rlight.step.';
  const steps = $derived(stepOptions(minStep));
  let step = $state(0.1);
  let canvas: HTMLCanvasElement;
  let view: RulerView | null = null;
  let destination = $state<string | null>(null);

  const model = new RulerModel('x', 0.1, {
    send: (r) => send(r),
    click: (k) => clicker.play(k),
  });

  function savedStep(a: Axis, options: number[]): number {
    try {
      const v = Number(localStorage.getItem(STEP_KEY + a));
      if (options.includes(v)) return v;
    } catch {
      /* sem armazenamento */
    }
    return options[1]!;
  }

  function choose(s: number) {
    step = s;
    try {
      localStorage.setItem(STEP_KEY + axis, String(s));
    } catch {
      /* fica só nesta visita */
    }
    model.setStep(s);
    view?.invalidate();
  }

  // Trocar de eixo: a régua recomeça na posição dele, com o passo lembrado.
  let shownAxis: Axis | null = null;
  $effect(() => {
    const a = axis;
    const opts = steps;
    if (a === shownAxis) return;
    shownAxis = a;
    step = savedStep(a, opts);
    model.step = step;
    model.setAxis(a, model.reported ?? model.value);
    view?.invalidate();
  });

  /** Chamado a cada estado novo, fora da reatividade: a régua parada segue a máquina. */
  export function update(input: {
    reported: number | null;
    commanded: number | null;
    limits: AxisLimits | null;
    offset: number;
    canGlide: boolean;
    now: number;
  }): void {
    model.reported = input.reported;
    model.limits = input.limits;
    model.canGlide = input.canGlide;
    const target = input.commanded ?? input.reported;
    if (target !== null) model.sync(target, input.now);
    if (view) {
      if (view.offset !== input.offset) view.invalidate();
      view.offset = input.offset;
      view.invalidate();
    }
  }

  export function abort(): void {
    model.abort();
    view?.invalidate();
  }

  onMount(() => {
    view = new RulerView(canvas, model);
    let last: string | null = null;
    view.onFrame = (m) => {
      const d = m.destination;
      const text = d === null ? null : formatMm(d - (view?.offset ?? 0));
      // Só toca o DOM quando o destino muda de verdade (uma vez por gesto).
      if (text !== last) destination = last = text;
    };
    canvas.addEventListener('pointerdown', () => clicker.wake());
    view.start();
  });

  onDestroy(() => view?.destroy());
</script>

<section class="ruler-box" aria-label="Régua de ajuste fino do {axis.toUpperCase()}">
  <div class="top">
    <span class="axis">{axis.toUpperCase()}</span>
    <div class="pills" role="radiogroup" aria-label="Passo">
      {#each steps as s (s)}
        <button role="radio" aria-checked={s === step} class:on={s === step} onclick={() => choose(s)}>
          {String(s).replace('.', ',')}
        </button>
      {/each}
    </div>
    <span class="unit">mm por traço</span>
  </div>
  <canvas bind:this={canvas} class="ruler" aria-hidden="true"></canvas>
  <p class="sr" aria-live="polite">{destination ? `Indo para ${destination}` : ''}</p>
</section>

<style>
  .ruler-box { display: flex; flex-direction: column; gap: 8px; }
  .top { display: flex; align-items: center; gap: 10px; }
  .axis { font: 700 17px var(--sans); color: var(--acc); width: 22px; }
  .unit { font-size: 11px; color: var(--fg-3); margin-left: auto; }
  .pills { display: flex; background: var(--panel); border-radius: 14px; padding: 3px; gap: 3px; }
  .pills button {
    border: 0;
    background: transparent;
    color: var(--fg-2);
    font: 600 15px var(--mono);
    min-width: 60px;
    min-height: 44px;
    border-radius: 11px;
    cursor: pointer;
    touch-action: manipulation;
  }
  .pills button.on { background: var(--line-2); color: var(--fg); }
  .ruler {
    display: block;
    width: 100%;
    height: 104px;
    border-radius: 18px;
    background: var(--panel);
    touch-action: none;
    cursor: grab;
  }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); margin: 0; }
</style>
