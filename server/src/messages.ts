// O formato das mensagens entre o servidor e os navegadores. Documentado em
// server/PROTOCOL.md; os tipos aqui são a fonte de verdade.

import type {
  Axis,
  AxisValues,
  CombinedLink,
  MachineLimits,
  MachineProfile,
  MachineSnapshot,
} from '@rlight/core';

import type { OdoTotals } from './odometer';
import type { PushSubscriptionJSON } from './push';
import type { JobDetail, JobInfo } from './jobs';
import type { SavedPoint } from './points';

export const PROTOCOL_VERSION = 1;

/** Os comandos que o servidor sabe executar hoje. */
export type CommandRequest =
  | { command: 'nudge'; axis: Axis; delta: number; step?: number; to?: number }
  | { command: 'jogTo'; x: number; y: number }
  | { command: 'jogAxisTo'; axis: Axis; value: number }
  | { command: 'zero'; axis: Axis | 'all' }
  | { command: 'spindleOn' | 'spindleSpeed'; rpm: number }
  | { command: 'undoZero' | 'spindleOff' }
  /** A placa de toque (tela de Automações): mede o Z e zera pela espessura da placa. */
  | { command: 'probeZ'; thicknessMm: number }
  /** Os pontos salvos (o Save X/Y/Z do Romney): salvar a posição atual, ir, apagar. */
  | { command: 'savePoint'; name: string }
  // `pointId`, não `id`: o `id` da mensagem é o do pedido, que volta no `result`.
  | { command: 'goToPoint'; pointId: string }
  | { command: 'deletePoint'; pointId: string }
  /** Volta para onde a máquina estava antes do último Ir ou ida a um ponto. */
  | { command: 'undoMove' }
  /** Retomar: volta para onde a máquina estava antes de perder o homing, ou dispensa a oferta. */
  | { command: 'resumePosition' }
  | { command: 'dismissResume' }
  /** Contornar no ar: percorre o retângulo do trabalho na altura segura, para conferir o enquadramento. */
  | { command: 'frameJob'; jobId: string }
  | { command: 'cancelJog' | 'unlock' | 'home' | 'softReset' | 'feedHold' | 'resume' };

export type ClientMessage =
  | { type: 'takeControl'; token?: string }
  | { type: 'resumeControl'; token: string }
  | { type: 'releaseControl' }
  /** Avisos no celular: este aparelho quer (ou não quer mais) receber. */
  | { type: 'pushSubscribe'; subscription: PushSubscriptionJSON }
  | { type: 'pushUnsubscribe'; endpoint: string }
  /** A tela deste aparelho está à vista (endpoint) ou não (null): à vista, ele não recebe aviso. */
  | { type: 'watching'; endpoint: string | null }
  /** Os trabalhos: guardar um arquivo de G-code, abrir um (conferido agora), apagar. */
  | { type: 'jobUpload'; name: string; text: string }
  | { type: 'jobOpen'; jobId: string }
  | { type: 'jobDelete'; jobId: string }
  | ({ type: 'command'; id?: string } & CommandRequest);

export type ServerMessage =
  | { type: 'welcome'; protocol: number; clientId: string }
  | { type: 'profile'; profile: MachineProfile; limits: MachineLimits }
  | {
      type: 'state';
      machine: MachineSnapshot | null;
      link: CombinedLink;
      /** Alvo comandado por eixo; eixo ausente segue a posição reportada. */
      commanded: AxisValues;
      homed: boolean;
      control: { inControl: boolean; controlled: boolean };
    }
  | { type: 'control'; inControl: boolean; reason?: string }
  | { type: 'result'; id?: string; ok: true; hitLimit?: boolean; undoable?: boolean }
  | { type: 'result'; id?: string; ok: false; reason: string }
  | { type: 'alarm'; code: number }
  /** O hodômetro: quanto cada eixo andou e o spindle ficou ligado, hoje e no total. */
  | { type: 'odometer'; day: string; today: OdoTotals; total: OdoTotals }
  /** A placa recusou uma linha (error:n): qual, para a tela dizer o motivo. */
  | { type: 'boardError'; code: number; line: string }
  /** Retomar: onde a máquina estava antes de perder o homing (null: não há oferta). */
  | { type: 'resume'; pos: { x: number; y: number; z: number } | null }
  /** Os pontos salvos, para todas as telas: a cada conexão e a cada mudança. */
  | { type: 'points'; points: SavedPoint[] }
  /** O andamento da placa de toque, para todas as telas. */
  | { type: 'probe'; status: 'seeking' | 'measuring' | 'done' | 'failed'; reason?: string; zeroMachineZ?: number }
  /** A chave pública dos avisos (VAPID); só quando o servidor sabe mandar avisos. */
  | { type: 'pushKey'; publicKey: string }
  /** A resposta a pushSubscribe/pushUnsubscribe: se este aparelho recebe avisos agora. */
  | { type: 'push'; subscribed: boolean }
  /** A biblioteca de trabalhos, para todas as telas: a cada conexão e a cada mudança. */
  | { type: 'jobs'; jobs: JobInfo[] }
  /** A resposta a jobUpload, só para quem mandou. */
  | { type: 'jobAdded'; ok: true; jobId: string }
  | { type: 'jobAdded'; ok: false; reason: string }
  /** Um trabalho aberto, conferido contra a máquina como ela está agora. */
  | { type: 'job'; job: JobDetail }
  | { type: 'job'; jobId: string; reason: string }
  | { type: 'invalid'; reason: string };

const SIMPLE = new Set(['cancelJog', 'unlock', 'home', 'softReset', 'feedHold', 'resume', 'undoZero', 'spindleOff', 'undoMove', 'resumePosition', 'dismissResume']);
const isAxis = (v: unknown): v is Axis => v === 'x' || v === 'y' || v === 'z';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Lê uma mensagem do navegador, ou diz por que ela não vale. */
export function parseClientMessage(raw: string): ClientMessage | { invalid: string } {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return { invalid: 'JSON inválido' };
  }
  if (typeof m !== 'object' || m === null) return { invalid: 'Mensagem precisa ser um objeto' };
  const o = m as Record<string, unknown>;
  if (o.type === 'releaseControl') return { type: o.type };
  const endpoint = typeof o.endpoint === 'string' && o.endpoint.length <= 1024 ? o.endpoint : undefined;
  if (o.type === 'jobUpload') {
    if (typeof o.name !== 'string' || typeof o.text !== 'string') return { invalid: 'Arquivo inválido' };
    return { type: o.type, name: o.name, text: o.text };
  }
  if (o.type === 'jobOpen' || o.type === 'jobDelete') {
    if (typeof o.jobId !== 'string' || !o.jobId) return { invalid: 'Trabalho inválido' };
    return { type: o.type, jobId: o.jobId };
  }
  if (o.type === 'pushUnsubscribe') return endpoint ? { type: o.type, endpoint } : { invalid: 'Endereço inválido' };
  if (o.type === 'watching') {
    if (o.endpoint === null) return { type: o.type, endpoint: null };
    return endpoint ? { type: o.type, endpoint } : { invalid: 'Endereço inválido' };
  }
  if (o.type === 'pushSubscribe') {
    const sub = o.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
    const k = sub?.keys;
    if (typeof sub?.endpoint !== 'string' || typeof k?.p256dh !== 'string' || typeof k?.auth !== 'string') {
      return { invalid: 'Inscrição inválida' };
    }
    return { type: o.type, subscription: { endpoint: sub.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } } };
  }
  // O token é o que identifica a tela para retomar o controle depois de uma queda.
  const token = typeof o.token === 'string' && o.token.length >= 16 && o.token.length <= 128 ? o.token : undefined;
  if (o.type === 'takeControl') return token ? { type: o.type, token } : { type: o.type };
  if (o.type === 'resumeControl') return token ? { type: o.type, token } : { invalid: 'Token inválido' };
  if (o.type !== 'command') return { invalid: `Tipo desconhecido: ${String(o.type)}` };
  if (o.id !== undefined && typeof o.id !== 'string') return { invalid: 'id precisa ser texto' };
  const id = o.id === undefined ? {} : { id: o.id };
  if (o.command === 'nudge') {
    if (o.axis !== 'x' && o.axis !== 'y' && o.axis !== 'z') return { invalid: 'Eixo inválido' };
    if (!isNum(o.delta)) return { invalid: 'delta inválido' };
    if (o.step !== undefined && !(isNum(o.step) && o.step > 0)) return { invalid: 'Passo inválido' };
    const step = o.step === undefined ? {} : { step: o.step };
    if (o.to !== undefined && !isNum(o.to)) return { invalid: 'Destino inválido' };
    const to = o.to === undefined ? {} : { to: o.to };
    return { type: 'command', ...id, command: 'nudge', axis: o.axis, delta: o.delta, ...step, ...to };
  }
  if (o.command === 'savePoint') {
    if (o.name !== undefined && typeof o.name !== 'string') return { invalid: 'Nome inválido' };
    return { type: 'command', ...id, command: 'savePoint', name: (o.name as string | undefined) ?? '' };
  }
  if (o.command === 'goToPoint' || o.command === 'deletePoint') {
    if (typeof o.pointId !== 'string' || !o.pointId) return { invalid: 'Ponto inválido' };
    return o.command === 'goToPoint'
      ? { type: 'command', ...id, command: 'goToPoint', pointId: o.pointId }
      : { type: 'command', ...id, command: 'deletePoint', pointId: o.pointId };
  }
  if (o.command === 'frameJob') {
    if (typeof o.jobId !== 'string' || !o.jobId) return { invalid: 'Trabalho inválido' };
    return { type: 'command', ...id, command: 'frameJob', jobId: o.jobId };
  }
  if (o.command === 'probeZ') {
    if (!isNum(o.thicknessMm)) return { invalid: 'Espessura inválida' };
    return { type: 'command', ...id, command: 'probeZ', thicknessMm: o.thicknessMm };
  }
  if (o.command === 'jogTo') {
    if (!isNum(o.x) || !isNum(o.y)) return { invalid: 'Destino inválido' };
    return { type: 'command', ...id, command: 'jogTo', x: o.x, y: o.y };
  }
  if (o.command === 'jogAxisTo') {
    if (!isAxis(o.axis)) return { invalid: 'Eixo inválido' };
    if (!isNum(o.value)) return { invalid: 'Destino inválido' };
    return { type: 'command', ...id, command: 'jogAxisTo', axis: o.axis, value: o.value };
  }
  if (o.command === 'zero') {
    if (!isAxis(o.axis) && o.axis !== 'all') return { invalid: 'Eixo inválido' };
    return { type: 'command', ...id, command: 'zero', axis: o.axis };
  }
  if (o.command === 'spindleOn' || o.command === 'spindleSpeed') {
    if (!isNum(o.rpm)) return { invalid: 'Rotação inválida' };
    return { type: 'command', ...id, command: o.command, rpm: o.rpm };
  }
  if (typeof o.command === 'string' && SIMPLE.has(o.command)) {
    return { type: 'command', ...id, command: o.command as 'cancelJog' };
  }
  return { invalid: `Comando desconhecido: ${String(o.command)}` };
}
