<script lang="ts">
  // O passo da régua num mostrador horizontal: três valores à vista, o escolhido
  // no meio. Desliza-se com o polegar ou toca-se no vizinho; assenta com a mola
  // do seletor do iOS e um clique suave.
  import type { Clicker } from '../lib/feel';
  import { dragPosition, formatStep, itemLook, settleIndex } from '../lib/step-dial';

  interface Props {
    steps: number[];
    index: number;
    clicker: Clicker;
    onchange: (index: number) => void;
  }

  let { steps, index, clicker, onchange }: Props = $props();

  const CELL = 74;
  let el: HTMLDivElement;
  let drag = $state<{ x: number; from: number; px: number; moved: boolean } | null>(null);
  let lastTick = -1;

  const pos = $derived(drag ? dragPosition(drag.from, drag.px, CELL, steps.length) : index);

  function down(e: PointerEvent) {
    clicker.wake();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* o ponteiro já saiu */
    }
    drag = { x: e.clientX, from: index, px: 0, moved: false };
    lastTick = index;
  }

  function move(e: PointerEvent) {
    if (!drag) return;
    const px = e.clientX - drag.x;
    drag = { ...drag, px, moved: drag.moved || Math.abs(px) > 6 };
    const near = Math.min(steps.length - 1, Math.max(0, Math.round(pos)));
    if (near !== lastTick) {
      lastTick = near;
      clicker.play('minor');
    }
  }

  function up(e: PointerEvent) {
    if (!drag) return;
    const d = drag;
    drag = null;
    let next = settleIndex(d.from, d.px, CELL, steps.length);
    if (!d.moved) {
      // Um toque no vizinho escolhe o vizinho.
      const r = el.getBoundingClientRect();
      const offset = (e.clientX - (r.left + r.width / 2)) / CELL;
      next = Math.min(steps.length - 1, Math.max(0, Math.round(d.from + offset)));
    }
    if (next !== index) {
      // Arrastando, o clique já tocou ao atravessar cada valor.
      if (!d.moved) clicker.play('minor');
      onchange(next);
    }
  }

  function key(e: KeyboardEvent) {
    const next = e.key === 'ArrowRight' ? index + 1 : e.key === 'ArrowLeft' ? index - 1 : null;
    if (next === null || next < 0 || next >= steps.length) return;
    e.preventDefault();
    clicker.play('minor');
    onchange(next);
  }
</script>

<div
  bind:this={el}
  class="dial"
  class:dragging={!!drag}
  role="slider"
  tabindex="0"
  aria-label="Passo da régua"
  aria-valuemin={0}
  aria-valuemax={steps.length - 1}
  aria-valuenow={index}
  aria-valuetext="{formatStep(steps[index] ?? 0)} milímetro por traço"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onkeydown={key}
>
  {#each steps as s, i (s)}
    {@const look = itemLook(i - pos)}
    <span
      class="item"
      class:on={i === index && !drag}
      style:transform="translateX({(i - pos) * CELL}px) scale({look.scale})"
      style:opacity={look.opacity}
    >
      {formatStep(s)}
    </span>
  {/each}
</div>

<style>
  .dial {
    position: relative;
    width: 222px;
    height: 48px;
    border-radius: 14px;
    background: var(--panel);
    overflow: hidden;
    isolation: isolate;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    cursor: grab;
    /* As pontas se apagam, como num tambor. */
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent);
    mask-image: linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent);
  }
  .item {
    position: absolute;
    left: calc(50% - 37px);
    top: 0;
    width: 74px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    font: 600 17px var(--mono);
    font-variant-numeric: tabular-nums;
    color: var(--fg-2);
    transition: transform 0.42s var(--spring), opacity 0.3s, color 0.2s;
    will-change: transform;
  }
  .item.on { color: var(--fg); }
  .dial.dragging .item { transition: none; }
  .dial::after {
    content: '';
    position: absolute;
    left: calc(50% - 30px);
    right: calc(50% - 30px);
    top: 6px;
    bottom: 6px;
    border-radius: 10px;
    background: var(--line-2);
    z-index: -1;
  }
  @media (prefers-reduced-motion: reduce) {
    .item { transition: opacity 0.2s, color 0.2s; }
  }
</style>
