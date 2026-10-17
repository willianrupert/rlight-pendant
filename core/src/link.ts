// Estado da conexão (ADR-0007). A máquina segue a vida dela; aqui só se calcula
// o que sabemos dela e há quanto tempo sabemos.

export type LinkMode = 'live' | 'no-signal';

export interface LinkConfig {
  /** Sem relatório por mais que isto, a tela passa a "sem sinal". */
  staleAfterMs: number;
  /** Quanto tempo o aviso "de volta" fica na tela depois de uma queda. */
  backNoticeMs: number;
}

// 2,5 s: medido no spike S1 (2026-10-17). O Wi-Fi da placa perde um pacote de vez
// em quando e o TCP leva até 1,6 s para reenviar; isso é pausa, não queda.
export const DEFAULT_LINK_CONFIG: LinkConfig = { staleAfterMs: 2_500, backNoticeMs: 1_500 };

export interface LinkState {
  readonly lastReportAt: number | null;
  /** Instante do primeiro relatório depois de uma queda. */
  readonly backAt: number | null;
}

export interface LinkView {
  readonly mode: LinkMode;
  /** Idade do último relatório, ou null se nunca houve um. */
  readonly ageMs: number | null;
  readonly showBack: boolean;
}

export function initialLink(): LinkState {
  return { lastReportAt: null, backAt: null };
}

export function onReport(
  state: LinkState,
  now: number,
  config: LinkConfig = DEFAULT_LINK_CONFIG,
): LinkState {
  const wasLost = state.lastReportAt !== null && now - state.lastReportAt > config.staleAfterMs;
  return { lastReportAt: now, backAt: wasLost ? now : state.backAt };
}

export function viewLink(
  state: LinkState,
  now: number,
  config: LinkConfig = DEFAULT_LINK_CONFIG,
): LinkView {
  if (state.lastReportAt === null) return { mode: 'no-signal', ageMs: null, showBack: false };
  const ageMs = now - state.lastReportAt;
  const mode: LinkMode = ageMs > config.staleAfterMs ? 'no-signal' : 'live';
  const showBack =
    mode === 'live' && state.backAt !== null && now - state.backAt < config.backNoticeMs;
  return { mode, ageMs, showBack };
}

export type Hop = 'server' | 'machine';

export interface CombinedLink extends LinkView {
  /** O trecho que caiu, para quem tocar no indicador. */
  readonly failedHop: Hop | null;
}

/**
 * Um indicador, não três: celular → servidor e servidor → máquina viram um
 * estado só. O trecho mais perto do operador decide, porque sem ele nada do
 * resto pode ser verdade.
 */
export function combineLinks(links: { server: LinkView; machine: LinkView }): CombinedLink {
  if (links.server.mode !== 'live') return { ...links.server, showBack: false, failedHop: 'server' };
  if (links.machine.mode !== 'live') return { ...links.machine, showBack: false, failedHop: 'machine' };
  return {
    mode: 'live',
    ageMs: links.machine.ageMs,
    showBack: links.server.showBack || links.machine.showBack,
    failedHop: null,
  };
}
