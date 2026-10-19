<script lang="ts">
  // A tela de Automações. Tudo o que é automático mora aqui, para a tela de
  // controle não ganhar botões: hoje a placa de toque do Z, depois as receitas
  // do Romney (docs/RECEITAS.md). E o som da régua, que saiu do cabeçalho.
  import type { Clicker } from '../lib/feel';
  import { formatDistance, formatDuration, parseThickness, probeLine, type Odometer, type ProbeProgress } from '../lib/automations';
  import HoldButton from './HoldButton.svelte';
  import type { SavedPin } from '../lib/map-view';
  import { formatMm } from '../lib/present';

  interface Props {
    hasProbe: boolean;
    /** A policy deixa medir agora (com controle, em repouso, com homing). */
    canProbe: boolean;
    homed: boolean;
    probe: ProbeProgress | null;
    canStop: boolean;
    sound: boolean;
    /** O hodômetro da máquina, do servidor. */
    odometer: Odometer | null;
    /** Os pontos salvos (o Save X/Y/Z do Romney). */
    points: SavedPin[];
    canSavePoint: boolean;
    canGoToPoint: boolean;
    /** O zero da peça, para mostrar os pontos nas mesmas coordenadas do DRO. */
    offset: { x: number; y: number; z: number };
    onsavepoint: (name: string) => void;
    ongopoint: (p: SavedPin) => void;
    ondeletepoint: (p: SavedPin) => void;
    clicker: Clicker;
    onprobe: (thicknessMm: number) => void;
    onstop: () => void;
    onsound: (on: boolean) => void;
    onclose: () => void;
  }

  let {
    hasProbe,
    canProbe,
    homed,
    probe,
    canStop,
    sound,
    odometer,
    points,
    canSavePoint,
    canGoToPoint,
    offset,
    clicker,
    onprobe,
    onstop,
    onsound,
    onsavepoint,
    ongopoint,
    ondeletepoint,
    onclose,
  }: Props = $props();
  let pointName = $state('');

  const KEY = 'rlight.plateThickness';
  let text = $state(read());
  function read(): string {
    try {
      return localStorage.getItem(KEY) ?? '';
    } catch {
      return '';
    }
  }
  const thickness = $derived(parseThickness(text));
  const running = $derived(probe?.status === 'seeking' || probe?.status === 'measuring');
  const line = $derived(probeLine(probe));

  function measure() {
    if (thickness === null) return;
    try {
      localStorage.setItem(KEY, text.trim());
    } catch {
      /* fica só nesta visita */
    }
    onprobe(thickness);
  }
</script>

<div class="scrim" onclick={onclose} role="presentation"></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label="Automações">
  <header>
    <h2>Automações</h2>
    <button class="close" onclick={onclose}>Fechar</button>
  </header>

  <section>
    <h3>Placa de toque</h3>
    <div class="card">
      <p class="lead">Zerar o Z pela placa</p>
      {#if !hasProbe}
        <p class="muted">Esta máquina não tem apalpador configurado.</p>
      {:else}
        <ol>
          <li>Leve a fresa a poucos milímetros da placa (no máximo 15 mm).</li>
          <li>Ponha a placa sob a fresa e prenda o jacaré nela.</li>
        </ol>
        <label class="row">
          <span>Espessura da placa</span>
          <span class="field">
            <input
              type="text"
              inputmode="decimal"
              placeholder="0,0"
              bind:value={text}
              disabled={running}
              aria-invalid={text.trim() !== '' && thickness === null}
            />
            <span class="unit">mm</span>
          </span>
        </label>
        {#if running}
          <HoldButton label="Parar" tone="danger" disabled={!canStop} onfire={onstop} />
        {:else}
          <HoldButton
            label="Medir"
            hold
            tone="primary"
            disabled={!canProbe || thickness === null}
            onpress={() => clicker.wake()}
            onfire={() => {
              clicker.play('confirm');
              measure();
            }}
          />
        {/if}
        <p class="status" class:fail={probe?.status === 'failed'} class:ok={probe?.status === 'done'} role="status">
          {#if line}{line}{:else if !homed}Faça o homing para usar a placa de toque.{:else if thickness === null}Informe a espessura da placa.{:else}&nbsp;{/if}
        </p>
      {/if}
    </div>
  </section>

  <section>
    <h3>Pontos salvos</h3>
    <div class="card">
      <p class="muted small">Como o "Save X/Y/Z" do Romney: salve onde a máquina está e volte depois. A volta sobe ao topo, vai, e desce os últimos 20 mm devagar.</p>
      <div class="row save">
        <input type="text" class="name" placeholder="Nome (opcional)" maxlength="40" bind:value={pointName} enterkeyhint="done" />
        <HoldButton
          label="Salvar posição"
          tone="primary"
          disabled={!canSavePoint}
          onpress={() => clicker.wake()}
          onfire={() => {
            clicker.play('confirm');
            onsavepoint(pointName);
            pointName = '';
          }}
        />
      </div>
      {#if !homed}<p class="muted small">Faça o homing para salvar e voltar a pontos.</p>{/if}
      {#if points.length}
        <ul class="points">
          {#each points as p (p.id)}
            <li>
              <div class="pinfo">
                <strong>{p.name}</strong>
                <span>X {formatMm(p.x - offset.x)} · Y {formatMm(p.y - offset.y)} · Z {formatMm(p.z - offset.z)}</span>
              </div>
              <button class="go" disabled={!canGoToPoint} onclick={() => ongopoint(p)}>Ir</button>
              <HoldButton label="Apagar" hold tone="quiet" onfire={() => ondeletepoint(p)} />
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>

  {#if odometer}
    <section>
      <h3>Hoje</h3>
      <div class="card">
        <div class="odo">
          <div><small>X</small><strong>{formatDistance(odometer.today.x)}</strong></div>
          <div><small>Y</small><strong>{formatDistance(odometer.today.y)}</strong></div>
          <div><small>Z</small><strong>{formatDistance(odometer.today.z)}</strong></div>
          <div><small>Spindle</small><strong>{formatDuration(odometer.today.spindleMs)}</strong></div>
        </div>
        <p class="muted small">
          Desde que o app começou a contar: X {formatDistance(odometer.total.x)} · Y {formatDistance(odometer.total.y)} · Z {formatDistance(odometer.total.z)} · spindle {formatDuration(odometer.total.spindleMs)}.
        </p>
      </div>
    </section>
  {/if}

  <section>
    <h3>Receitas</h3>
    <div class="card">
      <p class="muted">As receitas do Romney (aplainar, furos, círculos, texto) vão morar aqui.</p>
    </div>
  </section>

  <section>
    <h3>Ajustes</h3>
    <div class="card">
      <label class="row">
        <span>Som da régua</span>
        <!-- O switch nativo: no iPhone, o toque nele tem a háptica do sistema (ADR-0009). -->
        <input type="checkbox" {...{ switch: true }} checked={sound} onchange={(e) => onsound((e.currentTarget as HTMLInputElement).checked)} />
      </label>
    </div>
  </section>
</div>

<style>
  .scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 20; animation: fade 0.25s ease; }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    top: calc(env(safe-area-inset-top) + 24px);
    z-index: 21;
    max-width: 520px;
    margin: 0 auto;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--sheet);
    border-radius: 28px 28px 0 0;
    padding: 14px 18px calc(env(safe-area-inset-bottom) + 24px);
    /* A cor da folha continua até a borda de baixo, sem a faixa escurecida do iPhone. */
    box-shadow: 0 200px 0 0 var(--sheet);
    display: flex;
    flex-direction: column;
    gap: 18px;
    animation: rise 0.42s var(--spring);
  }
  header { display: flex; align-items: center; justify-content: space-between; padding: 0 4px; }
  h2 { margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.01em; }
  .close { border: 0; background: transparent; color: var(--acc); font: 500 17px var(--sans); min-height: 60px; min-width: 60px; cursor: pointer; }
  section { display: flex; flex-direction: column; gap: 6px; }
  h3 { margin: 0 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--fg-3); }
  .card { background: var(--panel); border-radius: 18px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .lead { margin: 0; font-size: 17px; font-weight: 600; }
  .muted { margin: 0; font-size: 15px; line-height: 1.4; color: var(--fg-2); }
  .muted.small { font-size: 13px; color: var(--fg-3); }
  .row.save { gap: 10px; }
  /* Mais específico que o campo numérico da espessura: o nome é texto comum. */
  input[type='text'].name {
    flex: 1;
    width: auto;
    text-align: left;
    min-width: 0;
    border: 1px solid var(--line-2);
    border-radius: 12px;
    background: transparent;
    color: var(--fg);
    font: 500 16px var(--sans);
    padding: 10px 12px;
  }
  .points { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .points li { display: flex; align-items: center; gap: 10px; min-height: 52px; }
  .pinfo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .pinfo strong { font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pinfo span { font: 500 12px var(--mono); color: var(--fg-3); font-variant-numeric: tabular-nums; }
  .go { border: 0; border-radius: 999px; background: var(--acc); color: var(--acc-ink); font: 700 15px var(--sans); min-width: 56px; min-height: 40px; cursor: pointer; }
  .go:disabled { opacity: 0.45; }
  .odo { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  .odo div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .odo small { font-size: 12px; color: var(--fg-3); }
  .odo strong { font: 600 17px var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; font-size: 15px; line-height: 1.4; color: var(--fg-2); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; font-size: 16px; }
  .field { display: flex; align-items: baseline; gap: 6px; }
  input[type='text'] {
    width: 5.5ch;
    border: 1px solid var(--line-2);
    border-radius: 12px;
    background: transparent;
    color: var(--fg);
    font: 600 20px var(--mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
    padding: 8px 10px;
  }
  input[type='text'][aria-invalid='true'] { border-color: var(--zero); }
  .unit { font-size: 14px; color: var(--fg-3); }
  input[type='checkbox'] { width: 51px; height: 31px; accent-color: var(--ok); }
  .status { margin: 0; min-height: 20px; font-size: 14px; line-height: 1.4; color: var(--fg-2); text-align: center; }
  .status.ok { color: var(--ok); }
  .status.fail { color: var(--zero); }
  @keyframes rise { from { transform: translateY(100%); } }
  @keyframes fade { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .sheet { animation: fade 0.2s ease; }
  }
</style>
