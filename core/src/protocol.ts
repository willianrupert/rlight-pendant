// Leitura do protocolo do FluidNC: cada linha que a placa manda vira uma
// mensagem tipada. Formatos conferidos contra o tráfego real da máquina de
// referência (spike S1) e, para estados ainda não vistos na bancada, contra a
// documentação do FluidNC.

import { MACHINE_STATES, type MachineState } from './policy';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Overrides {
  readonly feed: number;
  readonly rapid: number;
  readonly spindle: number;
}

export interface StatusReport {
  state: MachineState;
  subState: number | null;
  mpos?: Vec3;
  wpos?: Vec3;
  wco?: Vec3;
  feed?: number;
  spindle?: number;
  overrides?: Overrides;
  sd?: { percent: number; file: string };
  buffer?: { blocks: number; bytes: number };
  pins?: string;
  accessories?: string;
  lineNumber?: number;
}

export type Message =
  | { kind: 'status'; report: StatusReport }
  | { kind: 'ok' }
  | { kind: 'error'; code: number }
  | { kind: 'alarm'; code: number }
  | { kind: 'msg'; text: string }
  | { kind: 'gcodeState'; words: string[] }
  | { kind: 'offset'; name: string; value: Vec3 }
  | { kind: 'toolLength'; value: number }
  | { kind: 'version'; text: string }
  | { kind: 'options'; text: string }
  | { kind: 'other'; line: string };

const STATES = new Set<string>(MACHINE_STATES);

function num(s: string | undefined): number | null {
  if (s === undefined || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function nums(s: string): number[] | null {
  const out: number[] = [];
  for (const part of s.split(',')) {
    const n = num(part);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

/** Três primeiros valores como X, Y, Z; eixos extras são ignorados. */
function vec3(s: string): Vec3 | null {
  const v = nums(s);
  if (!v || v.length < 3) return null;
  return { x: v[0]!, y: v[1]!, z: v[2]! };
}

/** Lê um relatório `<Estado|Campo:valor|...>`, ou null se não for um. */
export function parseStatus(line: string): StatusReport | null {
  const t = line.trim();
  if (!t.startsWith('<') || !t.endsWith('>')) return null;
  const [head, ...fields] = t.slice(1, -1).split('|');
  if (!head) return null;
  const [stateName, sub] = head.split(':');
  if (!stateName || !STATES.has(stateName)) return null;
  const subState = sub === undefined ? null : num(sub);
  if (sub !== undefined && subState === null) return null;

  const report: StatusReport = { state: stateName as MachineState, subState };
  for (const field of fields) {
    const i = field.indexOf(':');
    if (i < 0) continue;
    const key = field.slice(0, i);
    const value = field.slice(i + 1);
    switch (key) {
      case 'MPos':
      case 'WPos':
      case 'WCO': {
        const v = vec3(value);
        if (!v) return null;
        if (key === 'MPos') report.mpos = v;
        else if (key === 'WPos') report.wpos = v;
        else report.wco = v;
        break;
      }
      case 'FS': {
        const v = nums(value);
        if (!v || v.length < 2) return null;
        report.feed = v[0]!;
        report.spindle = v[1]!;
        break;
      }
      case 'F': {
        const v = num(value);
        if (v === null) return null;
        report.feed = v;
        break;
      }
      case 'Ov': {
        const v = nums(value);
        if (!v || v.length < 3) return null;
        report.overrides = { feed: v[0]!, rapid: v[1]!, spindle: v[2]! };
        break;
      }
      case 'SD': {
        const c = value.indexOf(',');
        const percent = num(c < 0 ? value : value.slice(0, c));
        if (percent === null) return null;
        report.sd = { percent, file: c < 0 ? '' : value.slice(c + 1) };
        break;
      }
      case 'Bf': {
        const v = nums(value);
        if (!v || v.length < 2) return null;
        report.buffer = { blocks: v[0]!, bytes: v[1]! };
        break;
      }
      case 'Ln': {
        const v = num(value);
        if (v !== null) report.lineNumber = v;
        break;
      }
      case 'Pn':
        report.pins = value;
        break;
      case 'A':
        report.accessories = value;
        break;
      default:
        // Campo desconhecido: ignora sem quebrar, para aguentar versões novas.
        break;
    }
  }
  return report;
}

export function parseLine(line: string): Message {
  const t = line.trim();
  if (t === 'ok') return { kind: 'ok' };
  if (t.startsWith('<')) {
    const report = parseStatus(t);
    return report ? { kind: 'status', report } : { kind: 'other', line };
  }
  let m = /^error:(\d+)$/.exec(t);
  if (m) return { kind: 'error', code: Number(m[1]) };
  m = /^ALARM:(\d+)$/.exec(t);
  if (m) return { kind: 'alarm', code: Number(m[1]) };

  m = /^\[([A-Z0-9]+):(.*)\]$/.exec(t);
  if (m) {
    const tag = m[1]!;
    const body = m[2]!;
    if (tag === 'MSG') return { kind: 'msg', text: body };
    if (tag === 'GC') return { kind: 'gcodeState', words: body.split(/\s+/).filter(Boolean) };
    if (tag === 'TLO') {
      const v = num(body);
      return v === null ? { kind: 'other', line } : { kind: 'toolLength', value: v };
    }
    if (tag === 'VER') {
      // "[VER:3.9 FluidNC v3.9.9:]": o texto legível fica entre o espaço e o último ':'.
      const text = body.replace(/:$/, '').replace(/^\S+\s+/, '');
      return { kind: 'version', text };
    }
    if (tag === 'OPT') return { kind: 'options', text: body };
    if (/^G(5[4-9]|28|30|92)$/.test(tag)) {
      const v = vec3(body);
      return v ? { kind: 'offset', name: tag, value: v } : { kind: 'other', line };
    }
  }
  return { kind: 'other', line };
}

/** O que se sabe da máquina agora, juntando relatórios que chegam em pedaços. */
export interface MachineSnapshot {
  state: MachineState;
  subState: number | null;
  mpos: Vec3 | null;
  wpos: Vec3 | null;
  wco: Vec3 | null;
  feed: number;
  spindle: number;
  overrides: Overrides | null;
  sd: { percent: number; file: string } | null;
  pins: string;
  /**
   * O spindle está acionado (M3/M4), pelo campo A: do relatório. Não é o mesmo
   * que rotação > 0: uma máquina com disable_with_s0 desligado gira em S0.
   */
  spindleOn: boolean;
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

/**
 * Junta um relatório ao que já se sabe. O FluidNC só manda o offset da peça e
 * os overrides de tempos em tempos; o resto chega em todo relatório. O SD só
 * aparece enquanto um trabalho roda de lá, então some quando some do relatório.
 */
export function applyReport(prev: MachineSnapshot | null, r: StatusReport): MachineSnapshot {
  const wco = r.wco ?? prev?.wco ?? null;
  let mpos = r.mpos ?? null;
  let wpos = r.wpos ?? null;
  if (mpos && !wpos && wco) wpos = sub(mpos, wco);
  if (wpos && !mpos && wco) mpos = add(wpos, wco);
  return {
    state: r.state,
    subState: r.subState,
    mpos: mpos ?? (wpos ? null : (prev?.mpos ?? null)),
    wpos,
    wco,
    feed: r.feed ?? 0,
    spindle: r.spindle ?? prev?.spindle ?? 0,
    overrides: r.overrides ?? prev?.overrides ?? null,
    sd: r.sd ?? null,
    pins: r.pins ?? '',
    // Como no Grbl: o A: vem no mesmo relatório do Ov; Ov sem A: quer dizer tudo desligado.
    spindleOn: r.overrides ? /[SC]/.test(r.accessories ?? '') : (prev?.spindleOn ?? false),
  };
}
