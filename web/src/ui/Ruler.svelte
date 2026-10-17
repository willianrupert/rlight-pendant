<script lang="ts">
  // A régua (ADR-0010) com o seletor de passo. O gesto e o desenho moram em
  // lib/ruler-view.ts; aqui só a casca.
  import { onDestroy, onMount } from 'svelte';
  import type { Axis, AxisLimits, MachineState } from '@rlight/core';
  import type { CommandRequest } from '../lib/connection';
  import type { Clicker } from '../lib/feel';
  import { formatMm } from '../lib/present';
  import { RulerModel, RulerView } from '../lib/ruler-view';
  import { DEFAULT_STEP_INDEX, stepLadder } from '../lib/step-dial';
  import StepDial from './StepDial.svelte';

  interface Props {
    axis: Axis;
    minStep: number;
    send: (req: CommandRequest) => void;
    clicker: Clicker;
    /** A posição real de um eixo agora, para a régua recomeçar nele ao trocar de eixo. */
    positionOf: (a: Axis) => number | null;
  }

  let { axis, minStep, send, clicker, positionOf }: Props = $props();

  const STEP_KEY = 'rlight.step.';
  const steps = $derived(stepLadder(minStep));
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
    return options[DEFAULT_STEP_INDEX]!;
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
    model.setAxis(a, positionOf(a) ?? model.value);
    view?.invalidate();
  });

  /** Chamado a cada estado novo, fora da reatividade: a régua parada segue a máquina. */
  export function update(input: {
    reported: number | null;
    commanded: number | null;
    limits: AxisLimits | null;
    offset: number;
    canGlide: boolean;
    /** Z0 da peça em coordenada de máquina, só na régua do Z. */
    barrier: number | null;
    /** A máquina anda: um toque na régua é o Parar. */
    moving: boolean;
    state: MachineState | null;
    feed: number;
    now: number;
  }): void {
    model.machineMoving = input.moving;
    if (view) {
      view.state = input.state;
      view.feed = input.feed;
    }
    if (input.reported !== null) view?.pushReported(input.reported, input.now);
    model.reported = input.reported;
    model.barrier = input.barrier;
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
    <StepDial {steps} index={Math.max(0, steps.indexOf(step))} {clicker} onchange={(i) => choose(steps[i]!)} />
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
  .ruler {
    display: block;
    width: 100%;
    height: 96px;
    border-radius: 18px;
    background: var(--panel);
    touch-action: none;
    cursor: grab;
  }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); margin: 0; }
</style>
