// Análise de G-code (ADR-0006): antes de enviar, o servidor sabe o percurso, os
// limites, a profundidade e o tempo; durante o corte, a porcentagem do SD vira
// tempo restante e trecho já cortado. Coordenadas de trabalho, em mm.

import type { MachineLimits } from './motion';
import type { Vec3 } from './protocol';

export type SegmentKind = 'rapid' | 'feed' | 'arc' | 'dwell';

export interface Segment {
  kind: SegmentKind;
  from: Vec3;
  to: Vec3;
  /** mm/min; NaN em movimento rápido, que usa a velocidade máxima de cada eixo. */
  feed: number;
  dwellMs: number;
  /** Linha de origem, começando em 1. */
  line: number;
  /** Byte logo após o fim da linha de origem, para casar com o `SD:` da placa. */
  byteEnd: number;
}

export interface Diagnostic {
  severity: 'block' | 'warning';
  message: string;
  line?: number;
}

export interface Program {
  segments: Segment[];
  diagnostics: Diagnostic[];
  tools: number[];
  spindleSpeeds: number[];
  lineCount: number;
  byteLength: number;
}

export interface ParseOptions {
  /** Posição de trabalho no início do arquivo. */
  start?: Vec3;
  /** Origem da peça ativa, para converter movimentos G53. */
  workOffset?: Vec3;
  /** Erro máximo da corda ao quebrar arcos, como o arc_tolerance_mm do FluidNC. */
  arcToleranceMm?: number;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function stripComments(line: string): string {
  return line.replace(/\([^)]*\)/g, ' ').replace(/;.*$/, '').toUpperCase();
}

function words(line: string): [string, number][] {
  const out: [string, number][] = [];
  const re = /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push([m[1]!, Number(m[2])]);
  return out;
}

export function parseGcode(text: string, options: ParseOptions = {}): Program {
  const tol = options.arcToleranceMm ?? 0.002;
  const offset = options.workOffset ?? ZERO;
  const segments: Segment[] = [];
  const diagnostics: Diagnostic[] = [];
  const tools: number[] = [];
  const spindleSpeeds: number[] = [];

  let pos: Vec3 = { ...(options.start ?? ZERO) };
  let motion = 0; // 0, 1, 2, 3
  let absolute = true;
  let unit = 1; // mm por unidade
  let plane = 17;
  let feed = Number.NaN;
  let warnedPlane = false;

  const rawLines = text.split('\n');
  let byte = 0;
  rawLines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    byte += utf8Length(raw) + (idx < rawLines.length - 1 ? 1 : 0);
    const ws = words(stripComments(raw));
    if (ws.length === 0) return;

    let machineCoords = false;
    let dwell: number | null = null;
    const axis: Partial<Record<'X' | 'Y' | 'Z' | 'I' | 'J' | 'K' | 'R', number>> = {};
    for (const [letter, value] of ws) {
      switch (letter) {
        case 'G':
          if (value === 0 || value === 1 || value === 2 || value === 3) motion = value;
          else if (value === 90) absolute = true;
          else if (value === 91) absolute = false;
          else if (value === 20) unit = 25.4;
          else if (value === 21) unit = 1;
          else if (value === 17 || value === 18 || value === 19) plane = value;
          else if (value === 53) machineCoords = true;
          else if (value === 4) dwell = 0;
          break;
        case 'X':
        case 'Y':
        case 'Z':
        case 'I':
        case 'J':
        case 'K':
        case 'R':
          axis[letter] = value;
          break;
        case 'F':
          feed = value * unit;
          break;
        case 'S':
          if (!spindleSpeeds.includes(value)) spindleSpeeds.push(value);
          break;
        case 'T':
          if (!tools.includes(value)) tools.push(value);
          break;
        case 'P':
          if (dwell !== null) dwell = value * 1000;
          break;
      }
    }

    if (dwell !== null) {
      segments.push({ kind: 'dwell', from: pos, to: pos, feed: Number.NaN, dwellMs: dwell, line: lineNo, byteEnd: byte });
      return;
    }
    if (axis.X === undefined && axis.Y === undefined && axis.Z === undefined) return;

    const target = (letter: 'X' | 'Y' | 'Z', current: number, off: number): number => {
      const v = axis[letter];
      if (v === undefined) return current;
      if (machineCoords) return v * unit - off;
      return absolute ? v * unit : current + v * unit;
    };
    const to: Vec3 = { x: target('X', pos.x, offset.x), y: target('Y', pos.y, offset.y), z: target('Z', pos.z, offset.z) };

    if (motion === 0 || machineCoords) {
      segments.push({ kind: 'rapid', from: pos, to, feed: Number.NaN, dwellMs: 0, line: lineNo, byteEnd: byte });
    } else if (motion === 1 || plane !== 17) {
      if (motion !== 1 && !warnedPlane) {
        diagnostics.push({ severity: 'warning', message: 'Arcos fora do plano XY ainda não são analisados; o tempo e o desenho deste trecho são aproximados.', line: lineNo });
        warnedPlane = true;
      }
      segments.push({ kind: 'feed', from: pos, to, feed, dwellMs: 0, line: lineNo, byteEnd: byte });
    } else {
      const arc = arcSegments(pos, to, motion === 2, axis, unit, tol);
      if (!arc) {
        diagnostics.push({ severity: 'block', message: `Arco impossível na linha ${lineNo}.`, line: lineNo });
      } else {
        for (const [a, b] of arc) segments.push({ kind: 'arc', from: a, to: b, feed, dwellMs: 0, line: lineNo, byteEnd: byte });
      }
    }
    pos = to;
  });

  return { segments, diagnostics, tools, spindleSpeeds, lineCount: rawLines.filter((l) => l.trim() !== '').length, byteLength: byte };
}

/** Quebra um arco no plano XY em cordas; null se o arco for geometricamente impossível. */
function arcSegments(
  from: Vec3,
  to: Vec3,
  clockwise: boolean,
  axis: Partial<Record<string, number>>,
  unit: number,
  tol: number,
): [Vec3, Vec3][] | null {
  let cx: number;
  let cy: number;
  if (axis.R !== undefined) {
    const r = Math.abs(axis.R * unit);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const d = Math.hypot(dx, dy);
    if (d === 0 || d > 2 * r + 1e-9) return null;
    const h = Math.sqrt(Math.max(0, r * r - (d / 2) ** 2));
    // Lado do centro: horário com R positivo fica à direita da corda.
    const sign = (clockwise ? 1 : -1) * (axis.R < 0 ? -1 : 1);
    cx = from.x + dx / 2 + (sign * h * dy) / d;
    cy = from.y + dy / 2 - (sign * h * dx) / d;
  } else {
    cx = from.x + (axis.I ?? 0) * unit;
    cy = from.y + (axis.J ?? 0) * unit;
    const r0 = Math.hypot(from.x - cx, from.y - cy);
    const r1 = Math.hypot(to.x - cx, to.y - cy);
    if (r0 === 0 || Math.abs(r0 - r1) > Math.max(0.005, 0.001 * r0)) return null;
  }
  const r = Math.hypot(from.x - cx, from.y - cy);
  const a0 = Math.atan2(from.y - cy, from.x - cx);
  const a1 = Math.atan2(to.y - cy, to.x - cx);
  let sweep = a1 - a0;
  if (clockwise) {
    if (sweep >= -1e-12) sweep -= 2 * Math.PI;
  } else if (sweep <= 1e-12) sweep += 2 * Math.PI;
  const maxStep = 2 * Math.acos(Math.max(-1, 1 - tol / r));
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / maxStep));
  const out: [Vec3, Vec3][] = [];
  let prev = from;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const a = a0 + sweep * t;
    const p: Vec3 = i === n ? to : { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), z: from.z + (to.z - from.z) * t };
    out.push([prev, p]);
    prev = p;
  }
  return out;
}

const length = (s: Segment) => Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y, s.to.z - s.from.z);

export interface Analysis {
  bounds: { min: Vec3; max: Vec3 };
  maxDepth: number;
  cutDistance: number;
  rapidDistance: number;
}

export function analyze(program: Program): Analysis {
  const moves = program.segments.filter((s) => s.kind !== 'dwell');
  const pts = moves.flatMap((s) => [s.from, s.to]);
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of pts) {
    for (const k of ['x', 'y', 'z'] as const) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  const empty = pts.length === 0;
  return {
    bounds: { min: empty ? ZERO : min, max: empty ? ZERO : max },
    maxDepth: empty ? 0 : min.z,
    cutDistance: moves.filter((s) => s.kind !== 'rapid').reduce((a, s) => a + length(s), 0),
    rapidDistance: moves.filter((s) => s.kind === 'rapid').reduce((a, s) => a + length(s), 0),
  };
}

const mm1 = (v: number) => v.toFixed(1).replace('.', ',');

export function checkAgainstMachine(
  program: Program,
  machine: { limits: MachineLimits; workOffset: Vec3; tableDepthWorkZ?: number },
): Diagnostic[] {
  const problems: Diagnostic[] = [...program.diagnostics];
  const { bounds } = analyze(program);
  for (const k of ['x', 'y', 'z'] as const) {
    const l = machine.limits[k];
    if (!l) continue;
    const lo = bounds.min[k] + machine.workOffset[k];
    const hi = bounds.max[k] + machine.workOffset[k];
    const over = Math.max(hi - l.max, l.min - lo);
    if (over > 1e-6) problems.push({ severity: 'block', message: `O percurso passa ${mm1(over)} mm do curso do ${k.toUpperCase()}.` });
  }
  if (machine.tableDepthWorkZ !== undefined && bounds.min.z < machine.tableDepthWorkZ - 1e-6) {
    problems.push({ severity: 'block', message: `O percurso desce ${mm1(machine.tableDepthWorkZ - bounds.min.z)} mm abaixo do limite da mesa.` });
  }
  const noFeed = program.segments.find((s) => (s.kind === 'feed' || s.kind === 'arc') && !(s.feed > 0));
  if (noFeed) problems.push({ severity: 'block', message: `Movimento de corte sem avanço, na linha ${noFeed.line}.`, line: noFeed.line });
  return problems;
}

/** O que a estimativa precisa saber da máquina (ADR-0008: vem do perfil). */
export interface MotionCapabilities {
  axes: Partial<Record<'x' | 'y' | 'z', { maxRateMmPerMin: number; accelMmPerS2: number }>>;
  junctionDeviationMm?: number;
}

export interface TimeEstimate {
  totalS: number;
  /** Tempo acumulado ao fim de cada segmento. */
  cumulativeS: number[];
}

/**
 * Tempo pelo mesmo modelo do planejador do FluidNC: trapézio por segmento,
 * velocidade e aceleração limitadas pelo eixo mais restritivo na direção do
 * movimento, velocidade nas quinas pelo junction deviation, e passadas para trás
 * e para frente. Ignora o limite de 16 blocos da fila da placa, o que tende a
 * subestimar um pouco percursos com muitos segmentos curtos.
 */
export function estimateTime(program: Program, machine: MotionCapabilities): TimeEstimate {
  const delta = machine.junctionDeviationMm ?? 0.01;
  const segs = program.segments;
  const n = segs.length;
  const len = segs.map((s) => (s.kind === 'dwell' ? 0 : length(s)));
  const dir = segs.map((s, i) => {
    const L = len[i]!;
    return L > 0 ? { x: (s.to.x - s.from.x) / L, y: (s.to.y - s.from.y) / L, z: (s.to.z - s.from.z) / L } : ZERO;
  });
  const vmax: number[] = [];
  const acc: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = dir[i]!;
    let v = segs[i]!.kind === 'rapid' ? Infinity : segs[i]!.feed / 60;
    let a = Infinity;
    for (const k of ['x', 'y', 'z'] as const) {
      const c = Math.abs(u[k]);
      const ax = machine.axes[k];
      if (c < 1e-12 || !ax) continue;
      v = Math.min(v, ax.maxRateMmPerMin / 60 / c);
      a = Math.min(a, ax.accelMmPerS2 / c);
    }
    vmax.push(Number.isFinite(v) && v > 0 ? v : 0);
    acc.push(Number.isFinite(a) ? a : 1);
  }

  // Velocidade máxima em cada junção (entre o segmento i-1 e o i).
  const junction = new Array<number>(n + 1).fill(0);
  for (let i = 1; i < n; i++) {
    if (len[i - 1] === 0 || len[i] === 0) continue;
    const p = dir[i - 1]!;
    const q = dir[i]!;
    const cos = -(p.x * q.x + p.y * q.y + p.z * q.z);
    let v: number;
    if (cos > 0.999999) v = 0;
    else if (cos < -0.999999) v = Infinity;
    else {
      const sinHalf = Math.sqrt((1 - cos) / 2);
      v = Math.sqrt((Math.min(acc[i - 1]!, acc[i]!) * delta * sinHalf) / (1 - sinHalf));
    }
    junction[i] = Math.min(v, vmax[i - 1]!, vmax[i]!);
  }
  // Para trás: dá para parar a tempo.
  for (let i = n - 1; i >= 0; i--) {
    if (len[i] === 0) continue;
    junction[i] = Math.min(junction[i]!, Math.sqrt(junction[i + 1]! ** 2 + 2 * acc[i]! * len[i]!));
  }
  // Para frente: dá para acelerar até lá.
  for (let i = 0; i < n; i++) {
    if (len[i] === 0) continue;
    junction[i + 1] = Math.min(junction[i + 1]!, Math.sqrt(junction[i]! ** 2 + 2 * acc[i]! * len[i]!));
  }

  const cumulativeS: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const s = segs[i]!;
    if (s.kind === 'dwell') total += s.dwellMs / 1000;
    else if (len[i]! > 0 && vmax[i]! > 0) {
      const L = len[i]!;
      const a = acc[i]!;
      const vi = junction[i]!;
      const vf = junction[i + 1]!;
      const vm = vmax[i]!;
      const dAcc = (vm * vm - vi * vi) / (2 * a);
      const dDec = (vm * vm - vf * vf) / (2 * a);
      if (dAcc + dDec <= L) total += (vm - vi) / a + (vm - vf) / a + (L - dAcc - dDec) / vm;
      else {
        const vp = Math.sqrt((2 * a * L + vi * vi + vf * vf) / 2);
        total += (vp - vi) / a + (vp - vf) / a;
      }
    }
    cumulativeS.push(total);
  }
  return { totalS: total, cumulativeS };
}

/**
 * Do byte em que a placa está (o `SD:` reporta a porcentagem por bytes) ao
 * tempo decorrido e restante. Conta como feito tudo o que vem de linhas já
 * lidas por inteiro.
 */
export function progressAt(
  program: Program,
  estimate: TimeEstimate,
  byteOffset: number,
): { segmentIndex: number; elapsedS: number; remainingS: number } {
  let idx = -1;
  for (let i = 0; i < program.segments.length; i++) {
    if (program.segments[i]!.byteEnd <= byteOffset) idx = i;
    else break;
  }
  const elapsed = idx >= 0 ? estimate.cumulativeS[idx]! : 0;
  return { segmentIndex: idx + 1, elapsedS: elapsed, remainingS: Math.max(0, estimate.totalS - elapsed) };
}
