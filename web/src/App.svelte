<script lang="ts">
  // v0 · Os olhos (PRODUCT.md): só mostra. Nenhum comando sai desta tela.
  import { onDestroy, onMount } from 'svelte';
  import type { Axis, MachineProfile } from '@rlight/core';
  import { Connection, serverUrl, type ServerState } from './lib/connection';
  import { Telemetry } from './lib/dro';
  import { formatFeed, formatRpm, linkLine, presentState } from './lib/present';

  const conn = new Connection(serverUrl());
  const telemetry = new Telemetry();
  const axes: Axis[] = ['x', 'y', 'z'];
  const roots: Partial<Record<Axis, HTMLElement>> = {};

  let st = $state<ServerState | null>(null);
  let profile = $state<MachineProfile | null>(null);
  let now = $state(performance.now());
  let showChain = $state(false);

  const machine = $derived(st?.machine ?? null);
  const link = $derived(conn.link(now));
  const live = $derived(link.mode === 'live');
  const usingWork = $derived(!!machine?.wco);
  const pres = $derived(presentState({ state: machine?.state ?? null, homed: st?.homed ?? false, alarmCode: conn.alarmCode }));
  const line = $derived(linkLine(link));
  const axisNames = $derived(axes.filter((a) => !profile || profile.axes[a]));
  const ov = $derived(machine?.overrides ?? null);

  let tick: ReturnType<typeof setInterval>;

  onMount(() => {
    for (const a of axes) if (roots[a]) telemetry.attach(a, roots[a]!);
    conn.onState = (s, at) => {
      st = s;
      const m = s.machine;
      const pos = m?.wco ? m.wpos : m?.mpos;
      if (pos) telemetry.push(pos, at);
    };
    conn.onProfile = (p) => (profile = p);
    conn.start();
    telemetry.start();
    tick = setInterval(() => (now = performance.now()), 250);
  });

  onDestroy(() => {
    clearInterval(tick);
    conn.stop();
    telemetry.stop();
  });

  $effect(() => {
    document.body.dataset.tone = live ? pres.tone : 'idle';
    telemetry.freeze(!live);
  });
</script>

<main class:stale={!live}>
  <header>
    <span class="name">{profile?.name ?? 'RLight'}</span>
    <h1>{live || !machine ? pres.label : 'Sem sinal'}</h1>
    {#if pres.detail && live}<p class="detail">{pres.detail}</p>{/if}
  </header>

  <section class="dro" aria-label="Posição">
    {#each axes as a (a)}
      <div class="axis" class:hidden={!axisNames.includes(a)}>
        <span class="letter">{a.toUpperCase()}</span>
        <span class="value" bind:this={roots[a]}></span>
        <span class="unit">mm</span>
      </div>
    {/each}
    <p class="caption">{usingWork ? 'Coordenadas da peça' : 'Coordenadas da máquina'}</p>
  </section>

  <section class="meters">
    <div class="meter">
      <small>Avanço</small>
      <strong>{machine ? formatFeed(machine.feed) : '–'}<span>mm/min</span></strong>
      {#if ov && ov.feed !== 100}<em>{ov.feed} %</em>{/if}
    </div>
    <div class="meter">
      <small>Spindle</small>
      {#if machine && machine.spindle > 0}
        <strong>{formatRpm(machine.spindle)}<span>rpm</span></strong>
      {:else}
        <strong class="off">Parado</strong>
      {/if}
      {#if ov && ov.spindle !== 100}<em>{ov.spindle} %</em>{/if}
    </div>
  </section>

  <footer>
    {#if line}
      <button class="link" class:back={line === 'De volta'} onclick={() => (showChain = !showChain)}>{line}</button>
      {#if showChain && !live}
        <p class="chain">
          <span>Seu celular ●</span><span>─</span>
          <span class:off={link.failedHop === 'server'}>Servidor {link.failedHop === 'server' ? '○' : '●'}</span><span>─</span>
          <span class:off={link.failedHop !== null}>Máquina {link.failedHop !== null ? '○' : '●'}</span>
        </p>
      {/if}
    {/if}
    <p class="note">Somente leitura · v0</p>
  </footer>
</main>

<style>
  main {
    min-height: 100dvh;
    max-width: 520px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 28px;
    padding: calc(env(safe-area-inset-top) + 20px) calc(env(safe-area-inset-right) + 22px)
      calc(env(safe-area-inset-bottom) + 18px) calc(env(safe-area-inset-left) + 22px);
  }
  header { display: flex; flex-direction: column; gap: 4px; }
  .name { font-size: 13px; color: var(--fg-3); letter-spacing: 0.02em; }
  h1 { margin: 0; font-size: 34px; font-weight: 700; letter-spacing: -0.02em; }
  .detail { margin: 6px 0 0; font-size: 16px; line-height: 1.4; color: var(--fg-2); max-width: 32ch; }

  .dro { display: flex; flex-direction: column; gap: 6px; }
  .axis { display: grid; grid-template-columns: 28px 1fr auto; align-items: baseline; gap: 8px; }
  .axis.hidden { display: none; }
  .letter { font-size: 17px; font-weight: 600; color: var(--fg-3); }
  .value { font-size: clamp(46px, 15.5vw, 74px); justify-self: end; transition: opacity 0.4s; }
  .unit { font-size: 14px; color: var(--fg-3); }
  .caption { margin: 4px 0 0; font-size: 12px; color: var(--fg-3); text-align: right; }
  main.stale .value { opacity: 0.35; }

  .meters { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .meter { background: var(--panel); border-radius: 18px; padding: 14px 16px; display: flex; flex-direction: column; gap: 2px; transition: opacity 0.4s; }
  main.stale .meter { opacity: 0.35; }
  .meter small { font-size: 12px; color: var(--fg-3); }
  .meter strong { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 24px; font-weight: 600; }
  .meter strong span { font-family: var(--sans); font-size: 12px; font-weight: 500; color: var(--fg-3); margin-left: 6px; }
  .meter strong.off { font-family: var(--sans); color: var(--fg-2); font-size: 20px; }
  .meter em { font-style: normal; font-size: 12px; color: var(--acc); }

  footer { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 8px; min-height: 44px; }
  .link {
    border: 0; background: var(--panel); color: var(--fg-2); font: 500 14px var(--sans);
    padding: 10px 16px; border-radius: 999px; min-height: 44px; cursor: pointer;
  }
  .link.back { color: var(--ok); }
  .chain { margin: 0; display: flex; gap: 6px; font-size: 12px; color: var(--fg-2); }
  .chain .off { color: var(--fg-3); }
  .note { margin: 0; font-size: 11px; color: var(--fg-3); }
</style>
