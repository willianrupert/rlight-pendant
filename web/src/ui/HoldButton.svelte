<script lang="ts">
  // Um botão. Os perigosos se confirmam segurando (ADR-0005): o progresso enche
  // o botão por dentro, e soltar antes cancela. O progresso anda fora do Svelte.
  import { HOLD_MS, holdProgress, idleHold, pressHold } from '../lib/hold';

  interface Props {
    label: string;
    hold?: boolean;
    holdMs?: number;
    tone?: 'normal' | 'primary' | 'danger' | 'quiet';
    /** Texto enquanto o comando espera a máquina confirmar. */
    pending?: string | null;
    disabled?: boolean;
    onfire: () => void;
    onpress?: () => void;
  }

  let { label, hold = false, holdMs = HOLD_MS, tone = 'normal', pending = null, disabled = false, onfire, onpress }: Props = $props();

  let el: HTMLButtonElement;
  let h = idleHold();
  let raf = 0;
  let holding = $state(false);

  function set(p: number) {
    el?.style.setProperty('--p', String(p));
  }

  function begin() {
    if (disabled || pending) return;
    onpress?.();
    if (!hold) return;
    h = pressHold(h, performance.now());
    holding = true;
    const loop = (now: number) => {
      const r = holdProgress(h, now, holdMs);
      h = r.next;
      set(r.progress);
      if (r.fire) {
        end();
        onfire();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  function end() {
    cancelAnimationFrame(raf);
    h = idleHold();
    holding = false;
    set(0);
  }

  function down(e: PointerEvent) {
    if (hold) {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* o ponteiro já saiu */
      }
    }
    begin();
  }

  function click() {
    if (!hold && !disabled && !pending) onfire();
  }

  function key(e: KeyboardEvent, isDown: boolean) {
    if (!hold || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    if (isDown && !e.repeat) begin();
    else if (!isDown) end();
  }
</script>

<button
  bind:this={el}
  class="b {tone}"
  class:holding
  class:pending={!!pending}
  disabled={disabled}
  aria-busy={!!pending}
  aria-label={hold ? `${label}, segure para confirmar` : label}
  onpointerdown={down}
  onpointerup={end}
  onpointercancel={end}
  onpointerleave={() => hold && holding && end()}
  onclick={click}
  onkeydown={(e) => key(e, true)}
  onkeyup={(e) => key(e, false)}
  oncontextmenu={(e) => e.preventDefault()}
>
  <span class="fill" aria-hidden="true"></span>
  <span class="text">{pending ?? label}</span>
  {#if hold && !pending}<small>{holding ? 'Segure…' : 'Segure'}</small>{/if}
</button>

<style>
  .b {
    --p: 0;
    position: relative;
    overflow: hidden;
    min-height: 60px;
    min-width: 60px;
    padding: 0 20px;
    border: 0;
    border-radius: 18px;
    background: var(--panel-2);
    color: var(--fg);
    font: 600 17px var(--sans);
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    transition: transform 0.18s var(--spring), opacity 0.3s;
  }
  .b:active:not(:disabled) { transform: scale(0.97); }
  .b:disabled { opacity: 0.4; cursor: default; }
  .b.primary { background: var(--acc); color: var(--acc-ink); }
  .b.danger { color: var(--danger); }
  .b.quiet { background: transparent; color: var(--fg-2); font-weight: 500; }
  .b.pending { opacity: 0.7; }
  .b.pending .text { animation: breathe 1.4s ease-in-out infinite; }
  .fill {
    position: absolute;
    inset: 0;
    background: currentColor;
    opacity: 0.18;
    transform-origin: left center;
    transform: scaleX(var(--p));
  }
  .text, small { position: relative; }
  small { font-size: 11px; font-weight: 500; opacity: 0.6; }
  @keyframes breathe { 50% { opacity: 0.5; } }
  @media (prefers-reduced-motion: reduce) {
    .b { transition: opacity 0.3s; }
    .b:active:not(:disabled) { transform: none; }
    .b.pending .text { animation: none; }
  }
</style>
