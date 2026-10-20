<script lang="ts">
  // Um trabalho (v2): o percurso na mesa, o que ele pede da máquina e o que
  // fica entre ele e o corte. Contornar no ar já funciona; cortar vai rodar do
  // cartão SD da placa (ADR-0006), que ainda não está instalado.
  import type { MachineLimits, Vec3 } from '@rlight/core';
  import type { Clicker } from '../lib/feel';
  import { blockedBy, holePoints, jobFacts, previewFrame, problemText, svgPoints, type JobDetail } from '../lib/jobs';
  import HoldButton from './HoldButton.svelte';

  interface Props {
    job: JobDetail;
    limits: MachineLimits;
    /** Onde a máquina está, em coordenadas de máquina (para o ponto na mesa). */
    mpos: Vec3 | null;
    /** A policy deixa contornar agora (controle, sinal, homing, em repouso). */
    canFrame: boolean;
    /** A placa tem leitor de cartão configurado. */
    hasSd: boolean;
    clicker: Clicker;
    onframe: () => void;
    ondelete: () => void;
    onclose: () => void;
  }

  let { job, limits, mpos, canFrame, hasSd, clicker, onframe, ondelete, onclose }: Props = $props();

  const facts = $derived(jobFacts(job));
  const blocked = $derived(blockedBy(job));
  const warnings = $derived(job.problems.filter((p) => p.severity === 'warning'));
  const frame = $derived(previewFrame(job, limits, mpos));
  const pad = $derived(frame ? Math.max(frame.width, frame.height) * 0.02 : 0);
  const box = $derived(frame && job.bounds.work ? job.bounds.work : null);
</script>

<div class="scrim" onclick={onclose} role="presentation"></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label={job.name}>
  <header>
    <h2>{job.name}</h2>
    <button class="close" onclick={onclose}>Fechar</button>
  </header>

  {#if frame}
    <div class="preview">
      <svg
        viewBox="{frame.minX - pad} {-(frame.minY + frame.height) - pad} {frame.width + 2 * pad} {frame.height + 2 * pad}"
        style:aspect-ratio="{frame.width + 2 * pad} / {frame.height + 2 * pad}"
        role="img"
        aria-label="O percurso do trabalho na mesa"
      >
        {#if frame.onTable}
          <rect class="bed" x={limits.x!.min} y={-limits.y!.max} width={limits.x!.max - limits.x!.min} height={limits.y!.max - limits.y!.min} />
        {/if}
        {#if box}
          <rect
            class="box"
            x={box.min.x + frame.offset.x}
            y={-(box.max.y + frame.offset.y)}
            width={box.max.x - box.min.x}
            height={box.max.y - box.min.y}
          />
        {/if}
        {#each job.preview.rapids as l}
          <polyline class="rapid" points={svgPoints(l, frame.offset)} />
        {/each}
        {#each job.preview.cuts as l}
          <polyline class="cut" points={svgPoints(l, frame.offset)} />
        {/each}
        {#each holePoints(job.preview.holes, frame.offset) as h}
          <circle class="hole" cx={h.x} cy={h.y} r={pad * 0.5} />
        {/each}
        {#if frame.onTable}
          <!-- O zero da peça, em âmbar como no resto do app. -->
          <g class="zero">
            <line x1={frame.offset.x - pad * 1.6} y1={-frame.offset.y} x2={frame.offset.x + pad * 1.6} y2={-frame.offset.y} />
            <line x1={frame.offset.x} y1={-frame.offset.y - pad * 1.6} x2={frame.offset.x} y2={-frame.offset.y + pad * 1.6} />
          </g>
        {/if}
        {#if frame.onTable && mpos}
          <circle class="here" cx={mpos.x} cy={-mpos.y} r={pad * 0.8} />
        {/if}
      </svg>
    </div>
    {#if !frame.onTable}
      <p class="muted small center">
        {job.homed ? 'Esperando o zero da peça para pôr o trabalho na mesa.' : 'Faça o homing para ver o trabalho no lugar dele na mesa.'}
      </p>
    {/if}
  {:else}
    <p class="muted">Este arquivo não move a máquina.</p>
  {/if}

  <div class="facts">
    {#if facts.size}<div><small>Tamanho</small><strong>{facts.size}</strong></div>{/if}
    <div><small>Profundidade</small><strong>{facts.depth}</strong></div>
    <div><small>Tempo estimado</small><strong>{facts.time}</strong></div>
    {#if facts.tools}<div><small>Ferramentas</small><strong>{facts.tools}</strong></div>{/if}
    {#if facts.rpm}<div><small>Rotação</small><strong>{facts.rpm}</strong></div>{/if}
  </div>

  {#if blocked || warnings.length}
    <ul class="problems">
      {#if blocked}<li class="block">{blocked}</li>{/if}
      {#each warnings as w}<li>{problemText(w)}</li>{/each}
    </ul>
  {/if}

  <div class="actions">
    <HoldButton
      label="Contornar no ar"
      hold
      disabled={!canFrame || !!blocked || !job.bounds.machine}
      onpress={() => clicker.wake()}
      onfire={() => {
        clicker.play('confirm');
        onframe();
      }}
    />
    <p class="muted small">A fresa sobe 10 mm acima da peça e percorre o retângulo do trabalho, para conferir o enquadramento no material.</p>
    <button class="cut-button" disabled>Cortar</button>
    <p class="muted small">
      {hasSd
        ? 'O corte roda do cartão microSD da placa, que ainda não foi instalado. Com o cartão, este botão se acende.'
        : 'O corte roda do cartão SD da placa, e esta máquina não tem leitor de cartão configurado.'}
    </p>
  </div>

  <div class="foot">
    <HoldButton label="Apagar trabalho" hold tone="quiet" onfire={ondelete} />
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 30; animation: fade 0.25s ease; }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    top: calc(env(safe-area-inset-top) + 36px);
    z-index: 31;
    max-width: 520px;
    margin: 0 auto;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--sheet);
    border-radius: 28px 28px 0 0;
    padding: 14px 18px calc(env(safe-area-inset-bottom) + 24px);
    box-shadow: 0 200px 0 0 var(--sheet);
    display: flex;
    flex-direction: column;
    gap: 16px;
    animation: rise 0.42s var(--spring);
  }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 4px; }
  h2 { margin: 0; font-size: 22px; font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .close { border: 0; background: transparent; color: var(--acc); font: 500 17px var(--sans); min-height: 60px; min-width: 60px; cursor: pointer; flex: none; }
  .preview { background: var(--panel); border-radius: 18px; padding: 10px; }
  svg { display: block; width: 100%; max-height: 46vh; overflow: hidden; border-radius: 10px; }
  .bed { fill: rgba(255, 255, 255, 0.025); stroke: var(--line-2); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .box { fill: none; stroke: var(--fg-3); stroke-width: 1; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; }
  .rapid { fill: none; stroke: var(--fg-3); stroke-width: 1; stroke-dasharray: 2 4; vector-effect: non-scaling-stroke; opacity: 0.7; }
  .cut { fill: none; stroke: var(--acc); stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  .hole { fill: var(--acc); }
  .zero line { stroke: var(--zero); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
  .here { fill: var(--fg); }
  .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; background: var(--panel); border-radius: 18px; padding: 16px; }
  .facts div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .facts small { font-size: 12px; color: var(--fg-3); }
  .facts strong { font: 600 17px var(--mono); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .problems { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
  .problems li { font-size: 14px; line-height: 1.4; color: var(--fg-2); background: var(--panel); border-radius: 14px; padding: 10px 12px; }
  .problems li.block { color: var(--zero); }
  .actions { display: flex; flex-direction: column; gap: 8px; }
  .cut-button { border: 0; border-radius: 16px; min-height: 56px; background: var(--acc); color: var(--acc-ink); font: 700 17px var(--sans); margin-top: 8px; }
  .cut-button:disabled { opacity: 0.35; }
  .muted { margin: 0; font-size: 15px; line-height: 1.4; color: var(--fg-2); }
  .muted.small { font-size: 13px; color: var(--fg-3); }
  .center { text-align: center; }
  .foot { display: flex; justify-content: center; }
  @keyframes rise { from { transform: translateY(100%); } }
  @keyframes fade { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .sheet { animation: fade 0.2s ease; }
  }
</style>
