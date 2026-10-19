<script lang="ts">
  // A calibração guiada da rotação (lib/calibration.ts). O app liga o spindle em
  // algumas rotações; quem opera digita a frequência que o inversor mostra; no fim,
  // sai o speed_map novo para colar no config.yaml. O app não muda a configuração
  // da placa sozinho: entrega a linha pronta.
  import type { SpindleProfile } from '@rlight/core';
  import type { Clicker } from '../lib/feel';
  import { calibrationSteps, fitSpeedMap, formatSpeedMap, type Reading } from '../lib/calibration';
  import { formatRpm } from '../lib/present';
  import HoldButton from './HoldButton.svelte';

  interface Props {
    spindle: SpindleProfile;
    canStart: boolean;
    canAdjust: boolean;
    canStop: boolean;
    clicker: Clicker;
    onstart: (rpm: number) => void;
    onspeed: (rpm: number) => void;
    onstop: () => void;
  }

  let { spindle, canStart, canAdjust, canStop, clicker, onstart, onspeed, onstop }: Props = $props();

  const steps = $derived(calibrationSteps(spindle));
  let phase = $state<'idle' | 'running' | 'done'>('idle');
  let step = $state(0);
  let readings = $state<Reading[]>([]);
  let hzText = $state('');
  // Motor de 2 polos: 60 rpm por Hz (18.000 rpm a 300 Hz).
  let ratioText = $state('60');

  const hz = $derived(readNumber(hzText, 1_000));
  const ratio = $derived(readNumber(ratioText, 1_000) ?? 60);
  const map = $derived(fitSpeedMap(spindle.speedMap, readings, ratio));
  const line = $derived(formatSpeedMap(map));
  let copied = $state(false);

  /** Um número digitado, com vírgula ou ponto; zero ou vazio não vale. */
  function readNumber(text: string, max: number): number | null {
    const v = Number(text.trim().replace(',', '.'));
    return text.trim() && Number.isFinite(v) && v > 0 && v <= max ? v : null;
  }

  function begin() {
    readings = [];
    step = 0;
    hzText = '';
    copied = false;
    phase = 'running';
    onstart(steps[0]!);
  }

  function next(record: boolean) {
    if (record && hz !== null) readings = [...readings, { commandedRpm: steps[step]!, hz }];
    hzText = '';
    if (step + 1 < steps.length) {
      step += 1;
      onspeed(steps[step]!);
    } else finish();
  }

  function finish() {
    onstop();
    phase = 'done';
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(line);
      copied = true;
    } catch {
      copied = false;
    }
  }
</script>

<div class="card">
  <p class="lead">Calibrar a rotação</p>
  {#if phase === 'idle'}
    <p class="muted">
      O app liga o spindle em {steps.length} rotações, de {formatRpm(steps[0]!)} a {formatRpm(steps.at(-1)!)} rpm. Em cada
      uma, espere o inversor estabilizar e digite a frequência que ele mostra. No fim, sai o speed_map certo.
    </p>
    <label class="row">
      <span>rpm por Hz do motor</span>
      <span class="field"><input type="text" inputmode="decimal" bind:value={ratioText} /></span>
    </label>
    <p class="muted small">Motor de 2 polos: 60 (18.000 rpm a 300 Hz). Fresa sem carga e mesa livre.</p>
    <HoldButton
      label="Começar"
      hold
      tone="primary"
      disabled={!canStart}
      onpress={() => clicker.wake()}
      onfire={() => {
        clicker.play('confirm');
        begin();
      }}
    />
  {:else if phase === 'running'}
    <p class="stepline">Passo {step + 1} de {steps.length} · <strong>{formatRpm(steps[step]!)} rpm</strong> pedidos</p>
    <p class="muted small">Espere a frequência parar de mudar no display do inversor e digite-a.</p>
    <label class="row">
      <span>Frequência no inversor</span>
      <span class="field">
        <input type="text" inputmode="decimal" placeholder="0,0" bind:value={hzText} />
        <span class="unit">Hz</span>
      </span>
    </label>
    <div class="actions">
      <button class="quiet" disabled={!canAdjust && step + 1 < steps.length} onclick={() => next(false)}>Pular</button>
      <button class="primary" disabled={hz === null || (!canAdjust && step + 1 < steps.length)} onclick={() => next(true)}>
        {step + 1 < steps.length ? 'Anotar e seguir' : 'Anotar e terminar'}
      </button>
    </div>
    <HoldButton label="Parar" tone="danger" disabled={!canStop} onfire={finish} />
  {:else}
    {#if readings.length}
      <div class="results" role="table" aria-label="Rotação pedida e real">
        <span class="head">Pedido</span><span class="head">Real</span><span class="head">Erro</span>
        {#each readings as r}
          {@const actual = Math.round(r.hz * ratio)}
          {@const off = Math.abs(actual - r.commandedRpm) / r.commandedRpm > 0.05}
          <span>{formatRpm(r.commandedRpm)}</span>
          <span class:off>{formatRpm(actual)} rpm</span>
          <span class:off>{actual >= r.commandedRpm ? '+' : '−'}{Math.round((Math.abs(actual - r.commandedRpm) / r.commandedRpm) * 100)} %</span>
        {/each}
      </div>
      <p class="muted small">A linha nova, para o bloco do spindle no config.yaml da placa:</p>
      <code>{line}</code>
      <div class="actions">
        <button class="quiet" onclick={() => (phase = 'idle')}>Refazer</button>
        <button class="primary" onclick={copy}>{copied ? 'Copiada' : 'Copiar a linha'}</button>
      </div>
    {:else}
      <p class="muted">Nada foi medido. O spindle foi desligado.</p>
      <button class="quiet" onclick={() => (phase = 'idle')}>Recomeçar</button>
    {/if}
  {/if}
</div>

<style>
  .card { background: var(--panel); border-radius: 18px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .lead { margin: 0; font-size: 17px; font-weight: 600; }
  .muted { margin: 0; font-size: 15px; line-height: 1.4; color: var(--fg-2); }
  .muted.small { font-size: 13px; color: var(--fg-3); }
  .stepline { margin: 0; font-size: 16px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; font-size: 16px; }
  .field { display: flex; align-items: baseline; gap: 6px; }
  input {
    width: 6ch;
    border: 1px solid var(--line-2);
    border-radius: 12px;
    background: transparent;
    color: var(--fg);
    font: 600 20px var(--mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
    padding: 8px 10px;
  }
  .unit { font-size: 14px; color: var(--fg-3); }
  .actions { display: flex; gap: 10px; justify-content: flex-end; }
  .actions button { border: 0; border-radius: 14px; min-height: 48px; padding: 0 16px; font: 600 16px var(--sans); cursor: pointer; }
  .actions .primary { background: var(--acc); color: var(--acc-ink); }
  .actions .quiet, button.quiet { background: transparent; color: var(--fg-2); border: 0; font: 600 16px var(--sans); min-height: 44px; cursor: pointer; }
  .actions button:disabled { opacity: 0.45; }
  .results { display: grid; grid-template-columns: auto 1fr auto; gap: 6px 14px; font: 500 13px var(--mono); font-variant-numeric: tabular-nums; color: var(--fg-2); white-space: nowrap; }
  .results span:nth-child(3n + 2) { text-align: right; }
  .results span:nth-child(3n) { text-align: right; }
  .results .head { font: 600 11px var(--sans); text-transform: uppercase; letter-spacing: 0.08em; color: var(--fg-3); }
  .results .off { color: var(--zero); }
  code { display: block; padding: 10px 12px; border-radius: 12px; background: var(--panel-2); font: 500 12px var(--mono); color: var(--fg); overflow-x: auto; white-space: nowrap; }
</style>
