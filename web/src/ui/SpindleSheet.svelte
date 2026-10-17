<script lang="ts">
  // A folha do spindle (VISION.md): um mostrador grande. Gira-se para escolher a
  // rotação; segura-se para ligar. O anel enche na confirmação e continua no
  // spin-up, que é a estimativa do perfil, dita como estimativa.
  import { onDestroy } from 'svelte';
  import type { SpindleProfile } from '@rlight/core';
  import type { Clicker } from '../lib/feel';
  import { HOLD_MS, holdProgress, idleHold, pressHold } from '../lib/hold';
  import { formatRpm } from '../lib/present';
  import { DIAL_SWEEP_DEG, angleFromRpm, dialAngle, ringFill, rpmFromAngle, snapRpm, thousandsCrossed } from '../lib/spindle';

  interface Props {
    spindle: SpindleProfile;
    /** Rotação reportada pela placa agora. */
    reported: number;
    canStart: boolean;
    canStop: boolean;
    canAdjust: boolean;
    pending: string | null;
    clicker: Clicker;
    onstart: (rpm: number) => void;
    onstop: () => void;
    onadjust: (rpm: number) => void;
    onclose: () => void;
  }

  let { spindle, reported, canStart, canStop, canAdjust, pending, clicker, onstart, onstop, onadjust, onclose }: Props = $props();

  const range = $derived({ min: spindle.minRpm, max: spindle.maxRpm > spindle.minRpm ? spindle.maxRpm : 24_000 });
  const running = $derived(reported > 0);
  let rpm = $state(12_000);
  let initialized = false;
  $effect(() => {
    if (initialized) return;
    initialized = true;
    rpm = snapRpm(reported > 0 ? reported : 12_000, range);
  });

  // Mostrador
  let dial: SVGSVGElement;
  let turning = $state(false);
  function dialPoint(e: PointerEvent): number {
    const r = dial.getBoundingClientRect();
    return dialAngle(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  }
  function turnDown(e: PointerEvent) {
    clicker.wake();
    turning = true;
    try {
      dial.setPointerCapture(e.pointerId);
    } catch {
      /* o ponteiro já saiu */
    }
    turnMove(e);
  }
  function turnMove(e: PointerEvent) {
    if (!turning) return;
    const next = rpmFromAngle(dialPoint(e), range);
    if (thousandsCrossed(rpm, next) > 0) clicker.play(next % 5000 < 1000 ? 'major' : 'minor');
    rpm = next;
  }
  function turnUp() {
    if (!turning) return;
    turning = false;
    rpm = snapRpm(rpm, range);
    if (running && canAdjust) onadjust(rpm);
  }

  // Segurar para ligar
  let h = idleHold();
  let raf = 0;
  let holdP = $state(0);
  let spinupAt = $state<number | null>(null);
  let now = $state(performance.now());
  function holdDown(e: PointerEvent) {
    if (!canStart || pending) return;
    clicker.wake();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* o ponteiro já saiu */
    }
    h = pressHold(h, performance.now());
    const loop = (t: number) => {
      const r = holdProgress(h, t, HOLD_MS);
      h = r.next;
      holdP = r.progress;
      if (r.fire) {
        clicker.play('confirm');
        spinupAt = t;
        onstart(rpm);
        tickSpinup();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }
  function holdUp() {
    if (spinupAt !== null) return;
    cancelAnimationFrame(raf);
    h = idleHold();
    holdP = 0;
  }
  function tickSpinup() {
    const loop = (t: number) => {
      now = t;
      if (spinupAt !== null && t - spinupAt < spindle.spinupMs + 100) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }
  // Um pedido que falhou (ou a placa que não confirmou) zera o anel: nada fica otimista.
  $effect(() => {
    if (!pending && !running && spinupAt !== null && now - spinupAt > 600) {
      spinupAt = null;
      holdP = 0;
      h = idleHold();
    }
  });
  $effect(() => {
    if (!running && !pending && spinupAt === null) holdP = 0;
  });
  onDestroy(() => cancelAnimationFrame(raf));

  const ring = $derived(ringFill({ holdProgress: holdP, spinupStartedAt: spinupAt, now, spinupMs: spindle.spinupMs, running }));
  const spinningUp = $derived(ring.phase === 'spinup');

  // Geometria do arco: 270°, começando embaixo à esquerda.
  const R = 120;
  const C = 150;
  function arc(fromDeg: number, toDeg: number): string {
    const p = (d: number) => {
      const a = ((d - 135 - 90) * Math.PI) / 180;
      return `${C + R * Math.cos(a)} ${C + R * Math.sin(a)}`;
    };
    const large = toDeg - fromDeg > 180 ? 1 : 0;
    return `M ${p(fromDeg)} A ${R} ${R} 0 ${large} 1 ${p(Math.max(fromDeg + 0.01, toDeg))}`;
  }
  const knob = $derived.by(() => {
    const a = ((angleFromRpm(rpm, range) - 135 - 90) * Math.PI) / 180;
    return { x: C + R * Math.cos(a), y: C + R * Math.sin(a) };
  });
  const ticks = $derived.by(() => {
    const out: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
    for (let v = Math.ceil(range.min / 1000) * 1000; v <= range.max; v += 1000) {
      const a = ((angleFromRpm(v, range) - 135 - 90) * Math.PI) / 180;
      const major = v % 5000 === 0;
      const r1 = R - 14;
      const r2 = R - (major ? 26 : 21);
      out.push({ x1: C + r1 * Math.cos(a), y1: C + r1 * Math.sin(a), x2: C + r2 * Math.cos(a), y2: C + r2 * Math.sin(a), major });
    }
    return out;
  });
</script>

<div class="scrim" onclick={onclose} role="presentation"></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label="Spindle">
  <header>
    <h2>Spindle</h2>
    <button class="close" onclick={onclose}>Fechar</button>
  </header>

  <svg
    bind:this={dial}
    class="dial"
    viewBox="0 0 300 300"
    role="slider"
    tabindex="0"
    aria-label="Rotação"
    aria-valuemin={range.min}
    aria-valuemax={range.max}
    aria-valuenow={rpm}
    aria-valuetext="{formatRpm(rpm)} rpm"
    onpointerdown={turnDown}
    onpointermove={turnMove}
    onpointerup={turnUp}
    onpointercancel={turnUp}
    onkeydown={(e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') rpm = Math.min(range.max, rpm + 1000);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') rpm = Math.max(range.min, rpm - 1000);
      else return;
      e.preventDefault();
      if (running && canAdjust) onadjust(rpm);
    }}
  >
    <path class="track" d={arc(0, DIAL_SWEEP_DEG)} />
    {#if ring.fill > 0}<path class="ring" class:spin={spinningUp} d={arc(0, DIAL_SWEEP_DEG * ring.fill)} />{/if}
    {#each ticks as t}<line class="tick" class:major={t.major} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />{/each}
    <circle class="knob" cx={knob.x} cy={knob.y} r="15" />
    <text x="150" y="150" class="rpm">{formatRpm(rpm)}</text>
    <text x="150" y="178" class="unit">rpm</text>
    <text x="150" y="212" class="now">
      {#if spinningUp}Acelerando · estimativa{:else if running}Girando a {formatRpm(reported)}{:else}Parado{/if}
    </text>
  </svg>

  <div class="actions">
    {#if running || (spinupAt !== null && pending)}
      <button class="big" onclick={onstop} disabled={!canStop || pending === 'Desligando…'}>
        {pending === 'Desligando…' ? 'Desligando…' : 'Desligar'}
      </button>
    {:else}
      <button
        class="big on"
        style:--p={ring.phase === 'confirming' ? holdP : 0}
        disabled={!canStart || !!pending}
        onpointerdown={holdDown}
        onpointerup={holdUp}
        onpointercancel={holdUp}
        oncontextmenu={(e) => e.preventDefault()}
        aria-label="Ligar a {formatRpm(rpm)} rpm, segure para confirmar"
      >
        <span class="fill" aria-hidden="true"></span>
        <span class="t">{pending ?? `Segure para ligar`}</span>
      </button>
    {/if}
  </div>
  {#if spindle.spinupMs > 0}
    <p class="note">O anel continua durante a aceleração do inversor: {Math.round(spindle.spinupMs / 100) / 10} s, pelo perfil da máquina.</p>
  {/if}
</div>

<style>
  .scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 20; animation: fade 0.25s ease; }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 21;
    max-width: 520px;
    margin: 0 auto;
    background: var(--sheet);
    border-radius: 28px 28px 0 0;
    padding: 14px 22px calc(env(safe-area-inset-bottom) + 18px);
    display: flex;
    flex-direction: column;
    gap: 6px;
    animation: rise 0.42s var(--spring);
  }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: 0; font-size: 22px; }
  .close { border: 0; background: transparent; color: var(--acc); font: 500 17px var(--sans); min-height: 60px; min-width: 60px; cursor: pointer; }
  .dial { width: min(300px, 82vw); align-self: center; touch-action: none; user-select: none; -webkit-user-select: none; cursor: grab; }
  .track { fill: none; stroke: var(--line); stroke-width: 18; stroke-linecap: round; }
  .ring { fill: none; stroke: var(--acc); stroke-width: 18; stroke-linecap: round; }
  .ring.spin { animation: breathe 1.2s ease-in-out infinite; }
  .tick { stroke: var(--fg-3); stroke-width: 2; }
  .tick.major { stroke: var(--fg-2); stroke-width: 3; }
  .knob { fill: var(--fg); }
  .rpm { font: 600 44px var(--mono); fill: var(--fg); text-anchor: middle; dominant-baseline: middle; font-variant-numeric: tabular-nums; }
  .unit { font: 500 15px var(--sans); fill: var(--fg-3); text-anchor: middle; }
  .now { font: 500 14px var(--sans); fill: var(--fg-2); text-anchor: middle; }
  .actions { display: flex; }
  .big {
    --p: 0;
    position: relative;
    overflow: hidden;
    flex: 1;
    min-height: 64px;
    border: 0;
    border-radius: 20px;
    background: var(--panel-2);
    color: var(--fg);
    font: 600 18px var(--sans);
    cursor: pointer;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .big.on { background: var(--acc); color: var(--acc-ink); }
  .big:disabled { opacity: 0.45; }
  .big .fill { position: absolute; inset: 0; background: currentColor; opacity: 0.2; transform-origin: left; transform: scaleX(var(--p)); }
  .big .t { position: relative; }
  .note { margin: 4px 0 0; font-size: 12px; color: var(--fg-3); text-align: center; }
  @keyframes rise { from { transform: translateY(100%); } }
  @keyframes fade { from { opacity: 0; } }
  @keyframes breathe { 50% { opacity: 0.6; } }
  @media (prefers-reduced-motion: reduce) {
    .sheet { animation: fade 0.2s ease; }
    .ring.spin { animation: none; }
  }
</style>
