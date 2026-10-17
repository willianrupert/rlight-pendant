<script lang="ts">
  // v0 · Os olhos e v1 · As mãos (PRODUCT.md). Sem o controle, a tela só mostra.
  // Com o controle, aparecem o mapa, a régua e as ações que o estado permite
  // (a policy do core decide, a mesma do servidor). Sem sinal, os controles saem.
  import { onDestroy, onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { allowed, type Axis, type Command, type MachineProfile, type MachineState } from '@rlight/core';
  import { Connection, serverUrl, type CommandName, type CommandRequest, type ServerState } from './lib/connection';
  import { PENDING_LABELS, PendingTracker, UNDO_WINDOW_MS, UndoWindow, barSlots, canTakeControl, controlsVisible, type Slot } from './lib/control';
  import { Telemetry } from './lib/dro';
  import { Clicker, prefersReducedMotion } from './lib/feel';
  import { HOLD_MS, holdProgress, idleHold, pressHold, type Hold } from './lib/hold';
  import type { TableLimits } from './lib/map-view';
  import { Presence } from './lib/presence';
  import { formatFeed, formatRpm, linkLine, presentState } from './lib/present';
  import HoldButton from './ui/HoldButton.svelte';
  import Ruler from './ui/Ruler.svelte';
  import SpindleSheet from './ui/SpindleSheet.svelte';
  import TableMap from './ui/TableMap.svelte';

  const conn = new Connection(serverUrl());
  const telemetry = new Telemetry();
  const clicker = new Clicker();
  const tracker = new PendingTracker();
  const undo = new UndoWindow();
  const presence = new Presence();
  const fadeMs = prefersReducedMotion() ? 0 : 180;
  const axes: Axis[] = ['x', 'y', 'z'];
  const roots: Partial<Record<Axis, HTMLElement>> = {};
  const rows: Partial<Record<Axis, HTMLElement>> = {};
  const TRACKED = new Set<CommandName>(['unlock', 'home', 'feedHold', 'resume', 'softReset', 'cancelJog', 'spindleOn', 'spindleOff']);
  const MOVES = new Set<CommandName>(['nudge', 'jogAxisTo', 'jogTo']);

  let st = $state<ServerState | null>(null);
  let profile = $state<MachineProfile | null>(null);
  let limits = $state(conn.limits);
  let now = $state(performance.now());
  let showChain = $state(false);
  let pendingRev = $state(0);
  let notice = $state<{ text: string; until: number } | null>(null);
  let axis = $state<Axis>('x');
  let sheet = $state(false);
  let sound = $state(clicker.sound);
  let ruler: ReturnType<typeof Ruler> | null = $state(null);
  let map: ReturnType<typeof TableMap> | null = $state(null);
  /** O estado que a tela mostra: o real, com histerese entre repouso e movimento. */
  let shown = $state<MachineState | null>(null);
  /** Um movimento pelo mapa em andamento: só ele transforma o mapa em Parar. */
  let mapMoveAt = $state<number | null>(null);

  const machine = $derived(st?.machine ?? null);
  const link = $derived(conn.link(now));
  const live = $derived(link.mode === 'live');
  const inControl = $derived(st?.control.inControl ?? false);
  const homed = $derived(st?.homed ?? false);
  const usingWork = $derived(!!machine?.wco);
  const pres = $derived(presentState({ state: shown, homed, alarmCode: conn.alarmCode }));
  const line = $derived(linkLine(link));
  const axisNames = $derived(axes.filter((a) => !profile || profile.axes[a]));
  const ov = $derived(machine?.overrides ?? null);

  const hands = $derived(controlsVisible({ live, inControl, hasMachine: !!machine }));
  const offerControl = $derived(canTakeControl({ live, inControl, hasMachine: !!machine }));
  const otherControls = $derived(!inControl && (st?.control.controlled ?? false));
  const ctx = $derived({ link: link.mode, inControl, homed, canHome: profile?.canHome ?? true });
  const may = (c: Command) => !!machine && allowed(c, machine.state, ctx).ok;
  // O que aparece segue o estado mostrado, para a tela não piscar a cada nudge.
  const shows = (c: Command) => !!shown && allowed(c, shown, ctx).ok;

  const table = $derived<TableLimits | null>(limits.x && limits.y ? { x: limits.x, y: limits.y } : null);
  const showMap = $derived(hands && !!table && !!shown && ['Idle', 'Jog'].includes(shown));
  const ghost = $derived(hands && shows('jogTo') && shown === 'Idle');
  // O Parar grande do mapa é só para o movimento que o mapa mandou; na régua, a régua é o Parar.
  const mapStop = $derived(hands && mapMoveAt !== null && machine?.state === 'Jog');
  const showRuler = $derived(hands && shows('nudge') && axisNames.includes(axis));
  const canZero = $derived(hands && shows('zero'));
  const slots = $derived<[Slot, Slot, Slot]>(
    hands && shown ? barSlots(shown, { ...ctx, hasSpindle: !!profile?.spindle }) : [null, null, null],
  );
  const slotKey = (x: Slot) => (x === null ? 'empty' : x.kind === 'action' ? x.command : x.kind);
  const pending = (c: CommandName) => {
    void pendingRev;
    return tracker.has(c) ? (PENDING_LABELS[c] ?? 'Enviando…') : null;
  };
  const spindlePending = $derived.by(() => {
    void pendingRev;
    return tracker.has('spindleOn') ? 'Ligando…' : tracker.has('spindleOff') ? 'Desligando…' : null;
  });
  const undoLabel = $derived(undo.active(now));
  const offset = $derived({ x: machine?.wco?.x ?? 0, y: machine?.wco?.y ?? 0 });

  function flash(text: string, ms = 3_500) {
    notice = { text, until: performance.now() + ms };
  }

  function send(req: CommandRequest) {
    const id = conn.command(req);
    if (!id) {
      flash('Sem sinal do servidor');
      ruler?.abort();
      return;
    }
    if (TRACKED.has(req.command)) {
      tracker.sent(id, req.command, performance.now(), machine?.state ?? null, st?.homed ?? false);
      pendingRev++;
    }
  }

  function zeroLabel(target: Axis | 'all') {
    return target === 'all' ? 'Todos os eixos zerados' : `${target.toUpperCase()} zerado`;
  }
  let lastZero: Axis | 'all' = 'x';
  function zero(target: Axis | 'all') {
    lastZero = target;
    clicker.play('confirm');
    send({ command: 'zero', axis: target });
  }

  function syncRuler(at: number) {
    const m = st?.machine;
    if (!ruler || !m?.mpos) return;
    ruler.update({
      reported: m.mpos[axis],
      // Parada, a máquina está onde diz; movendo, a régua segue o alvo comandado.
      commanded: m.state === 'Idle' ? null : (st?.commanded[axis] ?? null),
      moving: m.state === 'Jog',
      state: m.state,
      feed: m.feed,
      limits: conn.limits[axis] ?? null,
      offset: m.wco?.[axis] ?? 0,
      canGlide: st?.homed ?? false,
      // A superfície da peça só existe com um zero de peça definido.
      barrier: axis === 'z' && m.wco ? m.wco.z : null,
      now: at,
    });
  }

  // Tocar no número escolhe o eixo; segurar zera (DESIGN.md: manipulação direta).
  let zh: Hold = idleHold();
  let zAxis: Axis | null = null;
  let zRaf = 0;
  let zFired = false;
  function rowDown(a: Axis, e: PointerEvent) {
    if (!hands) return;
    clicker.wake();
    zAxis = a;
    zFired = false;
    if (!canZero) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* o ponteiro já saiu */
    }
    zh = pressHold(zh, performance.now());
    const loop = (t: number) => {
      const r = holdProgress(zh, t, HOLD_MS);
      zh = r.next;
      // O progresso só aparece depois de um instante: um toque não pisca nada.
      rows[a]?.style.setProperty('--z', String(Math.max(0, (r.progress - 0.2) / 0.8)));
      if (r.fire) {
        zFired = true;
        rowEnd(a);
        zero(a);
        return;
      }
      zRaf = requestAnimationFrame(loop);
    };
    zRaf = requestAnimationFrame(loop);
  }
  function rowUp(a: Axis) {
    if (zAxis === a && !zFired) {
      const started = zh.startedAt;
      const quick = started === null || performance.now() - started < 350;
      if (quick && axis !== a) {
        axis = a;
        queueMicrotask(() => syncRuler(performance.now()));
      }
    }
    rowEnd(a);
  }
  function rowEnd(a: Axis) {
    cancelAnimationFrame(zRaf);
    zh = idleHold();
    zAxis = null;
    rows[a]?.style.setProperty('--z', '0');
  }

  let tick: ReturnType<typeof setInterval>;

  // Nas superfícies de gesto, segurar nunca abre menu nem começa seleção.
  const GESTURE = '.map, .ruler-box, .dro, .dial, .bar, .sheet, .toast';
  function noSelect(e: Event) {
    if ((e.target as Element | null)?.closest?.(GESTURE)) e.preventDefault();
  }

  onMount(() => {
    document.addEventListener('contextmenu', noSelect);
    document.addEventListener('selectstart', noSelect);
    for (const a of axes) if (roots[a]) telemetry.attach(a, roots[a]!);
    conn.onState = (s, at) => {
      st = s;
      const m = s.machine;
      shown = presence.update(m?.state ?? null, at);
      // O movimento do mapa acabou quando a máquina para (ou nunca chegou a andar).
      if (mapMoveAt !== null && m?.state !== 'Jog' && at - mapMoveAt > 1_000) mapMoveAt = null;
      const pos = m?.wco ? m.wpos : m?.mpos;
      if (pos) telemetry.push(pos, at);
      if (m?.mpos) map?.push(m.mpos, at);
      if (m && tracker.items.length) {
        for (const o of tracker.state(m, s.homed)) if (o.kind === 'failed') flash(o.reason);
        pendingRev++;
      }
      syncRuler(at);
    };
    conn.onProfile = (p) => {
      profile = p;
      limits = conn.limits;
    };
    conn.onControl = (has, reason) => {
      if (!has) {
        ruler?.abort();
        sheet = false;
        tracker.clear();
        pendingRev++;
        if (reason) flash(reason, 6_000);
      }
    };
    conn.onResult = (id, command, result) => {
      const outcome = tracker.result(id, result);
      if (outcome) pendingRev++;
      if (!result.ok) {
        flash(result.reason);
        if (command === 'jogTo') mapMoveAt = null;
        if (MOVES.has(command)) ruler?.abort();
        return;
      }
      if (result.hitLimit) flash('No limite do curso', 2_000);
      if (command === 'zero') {
        undo.open(zeroLabel(lastZero), performance.now());
        now = performance.now();
      } else if (command === 'undoZero') {
        flash('Zero desfeito', 2_000);
      }
    };
    conn.onClose = () => {
      pendingRev++;
      ruler?.abort();
      map?.clear();
    };
    conn.start();
    telemetry.start();
    tick = setInterval(() => {
      now = performance.now();
      shown = presence.update(st?.machine?.state ?? null, now);
      if (notice && now > notice.until) notice = null;
      if (tracker.items.length) {
        for (const o of tracker.expire(now)) flash(o.reason);
        pendingRev++;
      }
    }, 250);
  });

  onDestroy(() => {
    document.removeEventListener('contextmenu', noSelect);
    document.removeEventListener('selectstart', noSelect);
    clearInterval(tick);
    conn.stop();
    telemetry.stop();
  });

  $effect(() => {
    const tone = live ? pres.tone : 'idle';
    document.documentElement.dataset.tone = tone;
    // A barra de status acompanha o estado quando o tema dela é usado.
    const color = getComputedStyle(document.documentElement).getPropertyValue(`--${tone}`).trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color || '#0d0f12');
    telemetry.freeze(!live);
  });

  // Sem sinal ou sem controle: nada pendente vai para a placa depois (ADR-0007).
  $effect(() => {
    if (!hands) {
      ruler?.abort();
      sheet = false;
    }
  });

  $effect(() => {
    if (ruler) syncRuler(performance.now());
  });
</script>

<main class:stale={!live} class:hands>
  <header>
    <div class="title">
      <span class="name">{profile?.name ?? 'RLight'}</span>
      <h1>{live || !machine ? pres.label : 'Sem sinal'}</h1>
    </div>
    {#if hands}
      <div class="quiet-row">
        <button class="quiet" aria-pressed={sound} onclick={() => (sound = clicker.sound = !sound)}>{sound ? 'Som' : 'Mudo'}</button>
        <button class="quiet" onclick={() => conn.releaseControl()}>Só assistir</button>
      </div>
    {/if}
    {#if pres.detail && live}<p class="detail">{pres.detail}</p>{/if}
  </header>

  {#if notice}
    <p class="notice" role="status">{notice.text}</p>
  {/if}

  {#if showMap && table}
    <TableMap
      bind:this={map}
      limits={table}
      {ghost}
      stop={mapStop}
      stopPending={!!pending('cancelJog')}
      frozen={!live}
      {offset}
      needsHoming={hands && !homed && shown === 'Idle' && shows('home')}
      homingPending={pending('home')}
      state={machine?.state ?? null}
      feed={machine?.feed ?? 0}
      onhome={() => {
        clicker.play('confirm');
        send({ command: 'home' });
      }}
      zLimits={limits.z ?? null}
      zZero={machine?.wco ? machine.wco.z : null}
      onjog={(p) => {
        clicker.play('confirm');
        mapMoveAt = performance.now();
        send({ command: 'jogTo', x: p.x, y: p.y });
      }}
      onstop={() => send({ command: 'cancelJog' })}
      ongrab={() => clicker.wake()}
    />
  {/if}

  <section class="dro" aria-label="Posição">
    {#each axes as a (a)}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="axis"
        class:hidden={!axisNames.includes(a)}
        class:selected={showRuler && axis === a}
        class:touchable={hands}
        bind:this={rows[a]}
        role={hands ? 'button' : undefined}
        tabindex={hands ? 0 : undefined}
        aria-label={hands ? `${a.toUpperCase()}: tocar escolhe a régua${canZero ? ', segurar zera' : ''}` : undefined}
        onpointerdown={(e) => rowDown(a, e)}
        onpointerup={() => rowUp(a)}
        onpointercancel={() => rowEnd(a)}
        onkeydown={(e) => {
          if (hands && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            axis = a;
          }
        }}
        oncontextmenu={(e) => e.preventDefault()}
      >
        <span class="letter">{a.toUpperCase()}</span>
        <span class="value" bind:this={roots[a]}></span>
        <span class="unit">mm</span>
        <span class="zbar" aria-hidden="true"></span>
      </div>
    {/each}
    <p class="caption">
      {#if canZero}Segure um eixo para zerar · {/if}{usingWork ? 'Coordenadas da peça' : 'Coordenadas da máquina'}
    </p>
  </section>

  {#if showRuler && profile}
    <Ruler bind:this={ruler} {axis} minStep={profile.axes[axis]?.minStepMm ?? 0.01} {send} {clicker} />
  {/if}

  {#if !hands}
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
  {/if}

  {#if hands}
    <!-- Três lugares fixos: o conteúdo troca dentro do lugar, nada se mexe. -->
    <section class="bar" aria-label="Ações">
      {#each slots as slot, i (i)}
        <div class="slot">
          {#key slotKey(slot)}
            <div class="cell" in:fade={{ duration: fadeMs }} out:fade={{ duration: fadeMs }}>
              {#if slot?.kind === 'spindle'}
                <button class="chip" class:on={!!machine && machine.spindle > 0} disabled={!(may('spindleOn') || may('spindleOff') || may('spindleSpeed'))} onclick={() => (sheet = true)} aria-label="Spindle">
                  <small>Spindle{#if ov && ov.spindle !== 100} · {ov.spindle} %{/if}</small>
                  <span>{spindlePending ?? (machine && machine.spindle > 0 ? `${formatRpm(machine.spindle)} rpm` : 'Parado')}</span>
                </button>
              {:else if slot?.kind === 'zeroAll'}
                <HoldButton label="Zerar todos" hold tone="quiet" onfire={() => zero('all')} />
              {:else if slot?.kind === 'action'}
                {@const a = slot}
                <HoldButton
                  label={a.label}
                  hold={a.hold}
                  tone={a.tone}
                  pending={pending(a.command)}
                  onpress={() => clicker.wake()}
                  onfire={() => {
                    if (a.hold) clicker.play('confirm');
                    send({ command: a.command });
                  }}
                />
              {/if}
            </div>
          {/key}
        </div>
      {/each}
    </section>
  {/if}

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
    {#if offerControl}
      {#if otherControls}<p class="note">Outra tela está no controle</p>{/if}
      <button class="take" onclick={() => conn.takeControl() || flash('Sem sinal do servidor')}>Assumir o controle</button>
    {/if}
  </footer>
</main>

{#if undoLabel && hands}
  <div class="toast" role="status">
    <span>{undoLabel}</span>
    <button
      onclick={() => {
        if (undo.take(performance.now())) send({ command: 'undoZero' });
        now = performance.now();
      }}>Desfazer</button
    >
    <i style:transform="scaleX({undo.remainingMs(now) / UNDO_WINDOW_MS})" aria-hidden="true"></i>
  </div>
{/if}

{#if sheet && hands && profile?.spindle && machine}
  <SpindleSheet
    spindle={profile.spindle}
    reported={machine.spindle}
    canStart={may('spindleOn')}
    canStop={may('spindleOff')}
    canAdjust={may('spindleSpeed')}
    pending={spindlePending}
    {clicker}
    onstart={(rpm) => send({ command: 'spindleOn', rpm })}
    onstop={() => send({ command: 'spindleOff' })}
    onadjust={(rpm) => send({ command: 'spindleSpeed', rpm })}
    onclose={() => (sheet = false)}
  />
{/if}

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
  main.hands { gap: 14px; padding-top: calc(env(safe-area-inset-top) + 14px); padding-left: calc(env(safe-area-inset-left) + 16px); padding-right: calc(env(safe-area-inset-right) + 16px); }
  header { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 4px; }
  .title { display: flex; flex-direction: column; gap: 4px; flex: 1; }
  .detail { flex-basis: 100%; }
  .name { font-size: 13px; color: var(--fg-3); letter-spacing: 0.02em; }
  h1 { margin: 0; font-size: 34px; font-weight: 700; letter-spacing: -0.02em; }
  main.hands h1 { font-size: 28px; }
  .detail { margin: 6px 0 0; font-size: 16px; line-height: 1.4; color: var(--fg-2); max-width: 32ch; }

  /* Flutua sobre a tela: um aviso nunca empurra o que está sob o dedo. */
  .notice {
    position: fixed;
    top: calc(env(safe-area-inset-top) + 10px);
    left: 50%;
    transform: translateX(-50%);
    width: min(488px, calc(100vw - 32px));
    z-index: 15;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    background: var(--sheet) !important;
    margin: 0;
    padding: 12px 16px;
    border-radius: 14px;
    background: var(--panel-2);
    color: var(--fg);
    font-size: 15px;
    animation: drop 0.35s var(--spring);
  }

  .dro { display: flex; flex-direction: column; gap: 6px; }
  main.hands .dro { gap: 2px; }
  .axis { position: relative; display: grid; grid-template-columns: 28px 1fr auto; align-items: baseline; gap: 8px; border-radius: 14px; }
  .axis.hidden { display: none; }
  .axis.touchable { cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; padding: 0 10px 0 6px; min-height: 60px; align-items: center; }
  .axis.selected { background: var(--panel); }
  .axis.selected .letter { color: var(--acc); }
  .zbar {
    --z: 0;
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 4px;
    height: 3px;
    border-radius: 2px;
    background: var(--acc);
    transform-origin: left;
    transform: scaleX(var(--z));
  }
  .axis { --z: 0; }
  .letter { font-size: 17px; font-weight: 600; color: var(--fg-3); }
  .value { font-size: clamp(46px, 15.5vw, 74px); justify-self: end; transition: opacity 0.4s; }
  main.hands .value { font-size: clamp(34px, 11vw, 52px); }
  .unit { font-size: 14px; color: var(--fg-3); }
  .caption { margin: 4px 0 0; font-size: 12px; color: var(--fg-3); text-align: right; }
  main.stale .value { opacity: 0.35; }

  .meters { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .meter { background: var(--panel); border-radius: 18px; padding: 14px 16px; display: flex; flex-direction: column; gap: 2px; transition: opacity 0.4s; border: 0; color: inherit; text-align: left; font: inherit; }
  main.stale .meter { opacity: 0.35; }
  .meter small { font-size: 12px; color: var(--fg-3); }
  .meter strong { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 24px; font-weight: 600; }
  .meter strong span { font-family: var(--sans); font-size: 12px; font-weight: 500; color: var(--fg-3); margin-left: 6px; }
  .meter strong.off { font-family: var(--sans); color: var(--fg-2); font-size: 20px; }
  .meter em { font-style: normal; font-size: 12px; color: var(--acc); }
  .chip {
    border: 0; border-radius: 18px; background: var(--panel); color: var(--fg); min-height: 60px; padding: 0 14px;
    display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 1px; cursor: pointer;
    font: 600 16px var(--sans); touch-action: manipulation; text-align: left;
  }
  .chip small { font-size: 11px; font-weight: 500; color: var(--fg-3); }
  .chip.on span { color: var(--acc); font-family: var(--mono); }
  .chip:disabled { cursor: default; }

  .bar { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; height: 60px; }
  .slot { display: grid; min-width: 0; }
  .cell { grid-area: 1 / 1; display: grid; min-width: 0; }
  .cell > :global(button) { width: 100%; height: 60px; min-width: 0; padding: 0 8px; font-size: 16px; }

  footer { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 8px; min-height: 44px; }
  main.hands footer { min-height: 0; }
  main.hands footer:empty { display: none; }
  .link {
    border: 0; background: var(--panel); color: var(--fg-2); font: 500 14px var(--sans);
    padding: 10px 16px; border-radius: 999px; min-height: 44px; cursor: pointer;
  }
  .link.back { color: var(--ok); }
  .chain { margin: 0; display: flex; gap: 6px; font-size: 12px; color: var(--fg-2); }
  .chain .off { color: var(--fg-3); }
  .note { margin: 0; font-size: 12px; color: var(--fg-3); }
  .take {
    border: 1px solid var(--line); background: transparent; color: var(--fg-2); font: 500 15px var(--sans);
    padding: 0 22px; min-height: 60px; border-radius: 999px; cursor: pointer; touch-action: manipulation;
  }
  .quiet-row { display: flex; gap: 6px; }
  .quiet { border: 0; background: transparent; color: var(--fg-3); font: 500 14px var(--sans); min-height: 44px; padding: 0 10px; cursor: pointer; }

  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(env(safe-area-inset-bottom) + 16px);
    transform: translateX(-50%);
    width: min(488px, calc(100vw - 32px));
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 6px 4px 18px;
    border-radius: 20px;
    background: var(--sheet);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    animation: rise 0.4s var(--spring);
  }
  .toast span { flex: 1; font-size: 15px; }
  .toast button { border: 0; background: transparent; color: var(--acc); font: 600 17px var(--sans); min-height: 60px; min-width: 60px; padding: 0 14px; cursor: pointer; }
  .toast i { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--acc); opacity: 0.5; transform-origin: left; transition: transform 0.25s linear; }
  @keyframes rise { from { transform: translate(-50%, 120%); } }
  @keyframes drop { from { transform: translate(-50%, -8px); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .notice, .toast { animation: none; }
    .toast i { transition: none; }
  }
</style>
