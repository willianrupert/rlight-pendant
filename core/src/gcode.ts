// O analisador de G-code (ADR-0006). Antes do envio, o servidor transforma o
// arquivo em percurso, confere contra a máquina e simula o tempo; durante o
// corte, a porcentagem do SD (por bytes) vira tempo restante e trecho cortado.

import { AXES, type Axis, type MachineLimits } from './motion';
import type { MachineProfile } from './profile';
import type { Vec3 } from './protocol';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** `arc` é um pedaço de arco já quebrado em reta; para o tempo, é um corte como outro. */
export type SegmentKind = 'rapid' | 'feed' | 'arc' | 'dwell' | 'spindle';
export type SpindleDir = 'off' | 'cw' | 'ccw';

export interface Segment {
  kind: SegmentKind;
  /** Coordenadas da peça, em mm. Pausas e eventos do fuso têm início igual ao fim. */
  start: Vec3;
  end: Vec3;
  /** mm/min; 0 em rápidos, pausas e cortes sem F. */
  feed: number;
  /** Linha do arquivo, a partir de 1. */
  line: number;
  /** Byte logo depois da linha (com a quebra), para cruzar com o `SD:` da placa. */
  byteEnd: number;
  /** Duração da pausa G4, em segundos; 0 nos outros. */
  dwellS: number;
  /** Estado do fuso depois deste segmento. */
  spindleDir: SpindleDir;
  spindleRpm: number;
}

export type Severity = 'block' | 'warning';
export type ProblemCode =
  | 'out-of-travel'
  | 'unknown-travel'
  | 'too-deep'
  | 'no-feed'
  | 'arc-radius'
  | 'unsupported'
  | 'coordinate-system'
  | 'pause'
  | 'parse';

export interface GcodeProblem {
  severity: Severity;
  code: ProblemCode;
  /** Mensagem para a pessoa, em português. */
  message: string;
  /** Primeira linha onde aparece, se for de uma linha. */
  line: number | null;
  axis?: Axis;
  /** Quanto o percurso passa do curso, em mm. */
  overMm?: number;
}

export interface Toolpath {
  segments: Segment[];
  /** Problemas achados na leitura; `checkToolpath` junta os da máquina. */
  problems: GcodeProblem[];
  lineCount: number;
  byteLength: number;
  workOffset: Vec3;
  /**
   * Por eixo, o índice do primeiro segmento cujo destino o arquivo definiu. Antes
   * dele, a posição nesse eixo é a suposta (`start`) e não entra nos limites.
   */
  knownFrom: Record<Axis, number>;
  tools: number[];
  spindleSpeeds: number[];
}

export interface ParseOptions {
  /** Zero da peça em coordenadas de máquina (o G54 ativo na placa). */
  workOffset?: Vec3;
  /** Onde a ferramenta está antes da primeira linha, em coordenadas da peça. */
  start?: Vec3;
  /** Distância máxima entre a corda e o arco, em mm. O FluidNC usa 0,002. */
  arcToleranceMm?: number;
}

export const DEFAULT_ARC_TOLERANCE_MM = 0.01;
export const DEFAULT_JUNCTION_DEVIATION_MM = 0.01;

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const MM_PER_INCH = 25.4;

/** Número com uma casa e vírgula, como a pessoa lê. */
function mm(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} mm`;
}

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

/** Códigos que a análise entende sem mudar nada no percurso. */
const IGNORED_G = new Set([17, 21, 20, 40, 49, 61, 80, 90, 90.1, 91, 91.1, 94]);
const IGNORED_M = new Set([6, 7, 8, 9, 62, 63, 64, 65, 66, 67, 68]);
const WORD = /([A-Z])([-+]?(?:\d+\.?\d*|\.\d+))/g;

interface Issue {
  severity: Severity;
  code: ProblemCode;
  line: number;
  count: number;
  message: (count: number, line: number) => string;
}

function codeName(letter: string, n: number): string {
  return `${letter}${n}`;
}

/**
 * Lê o arquivo e devolve o percurso. Cobre o que um CAM gera para o FluidNC:
 * G0–G3 no plano XY, G90/G91, G20/G21, G53, G4, M3/M4/M5, F, S e T. O resto vira
 * aviso, porque a análise não pode prometer o que não simulou.
 */
export function parseGcode(text: string, options: ParseOptions = {}): Toolpath {
  const offset = options.workOffset ?? ZERO;
  const tol = options.arcToleranceMm ?? DEFAULT_ARC_TOLERANCE_MM;
  const segments: Segment[] = [];
  const issues = new Map<string, Issue>();
  const tools: number[] = [];
  const speeds: number[] = [];
  const coordSystems = new Set<number>();

  function issue(key: string, i: Omit<Issue, 'count'>) {
    const prev = issues.get(key);
    if (prev) prev.count++;
    else issues.set(key, { ...i, count: 1 });
  }

  let pos: Vec3 = { ...(options.start ?? ZERO) };
  const knownFrom: Record<Axis, number> = { x: Infinity, y: Infinity, z: Infinity };
  if (options.start) knownFrom.x = knownFrom.y = knownFrom.z = 0;
  let motion: 0 | 1 | 2 | 3 | null = null;
  let absolute = true;
  let inches = false;
  let plane = 17;
  let feed = 0;
  let sWord = 0;
  let dir: SpindleDir = 'off';
  let rpm = 0;
  let ended = false;

  const rawLines = text.split('\n');
  if (rawLines.length > 1 && rawLines[rawLines.length - 1] === '') rawLines.pop();
  const lineCount = text === '' ? 0 : rawLines.length;
  let byte = 0;

  for (let li = 0; li < rawLines.length; li++) {
    const raw = rawLines[li]!;
    const lineNo = li + 1;
    byte += utf8Length(raw) + (li < rawLines.length - 1 || text.endsWith('\n') ? 1 : 0);
    if (ended) continue;

    const push = (kind: SegmentKind, end: Vec3, segFeed: number, dwellS = 0) => {
      segments.push({ kind, start: pos, end, feed: segFeed, line: lineNo, byteEnd: byte, dwellS, spindleDir: dir, spindleRpm: rpm });
      pos = end;
    };

    const clean = raw
      .replace(/\([^)]*\)?/g, '')
      .replace(/;.*$/, '')
      .replace(/\s+/g, '')
      .toUpperCase();
    if (clean === '' || clean === '%') continue;

    const g: number[] = [];
    const m: number[] = [];
    const v: Partial<Record<string, number>> = {};
    const leftover = clean.replace(WORD, (_, letter: string, num: string) => {
      const n = Number(num);
      if (letter === 'G') g.push(n);
      else if (letter === 'M') m.push(n);
      else v[letter] = n;
      return '';
    });
    if (leftover !== '') {
      issue(`parse:${lineNo}`, {
        severity: 'warning',
        code: 'parse',
        line: lineNo,
        message: (_, l) => `A linha ${l} tem algo que a análise não entende: “${raw.trim()}”.`,
      });
      continue;
    }

    // Unidades primeiro: valem para todas as palavras da própria linha.
    if (g.includes(20)) inches = true;
    if (g.includes(21)) inches = false;
    const k = inches ? MM_PER_INCH : 1;

    if (v.F !== undefined) feed = v.F * k;
    if (v.T !== undefined && !tools.includes(v.T)) tools.push(v.T);

    function unsupported(letter: string, code: number) {
      const name = codeName(letter, code);
      issue(`unsupported:${name}`, {
        severity: 'warning',
        code: 'unsupported',
        line: lineNo,
        message: (n, l) =>
          `${name} aparece ${n === 1 ? `na linha ${l}` : `em ${n} linhas (a primeira é a ${l})`} e não entra na análise; o percurso mostrado pode não ser o real.`,
      });
    }

    // Fuso: na ordem do RS274, antes do movimento da linha.
    let newDir: SpindleDir = dir;
    if (m.includes(3)) newDir = 'cw';
    if (m.includes(4)) newDir = 'ccw';
    if (m.includes(5)) newDir = 'off';
    if (v.S !== undefined) sWord = v.S;
    const newRpm = newDir === 'off' ? 0 : sWord;
    if (newDir !== dir || newRpm !== rpm) {
      dir = newDir;
      rpm = newRpm;
      if (rpm > 0 && !speeds.includes(rpm)) speeds.push(rpm);
      push('spindle', pos, 0);
    }

    for (const code of m) {
      if (code === 3 || code === 4 || code === 5 || IGNORED_M.has(code)) continue;
      if (code === 2 || code === 30) ended = true;
      else if (code === 0 || code === 1) {
        issue(`pause:M${code}`, {
          severity: 'warning',
          code: 'pause',
          line: lineNo,
          message: (n, l) =>
            n === 1
              ? `O trabalho pausa na linha ${l} (M${code}) e espera você continuar.`
              : `O trabalho pausa ${n} vezes (M${code}), a primeira na linha ${l}, e espera você continuar.`,
        });
      } else unsupported('M', code);
    }

    let machineCoords = false;
    let skipAxes = false;
    for (const code of g) {
      if (code === 0 || code === 1 || code === 2 || code === 3) motion = code;
      else if (code === 80) motion = null;
      else if (code === 90) absolute = true;
      else if (code === 91) absolute = false;
      else if (code === 17 || code === 18 || code === 19) {
        plane = code;
        if (code !== 17) unsupported('G', code);
      } else if (code === 53) machineCoords = true;
      else if (code >= 54 && code <= 59) coordSystems.add(code);
      else if (code === 4) {
        const p = v.P ?? 0;
        push('dwell', pos, 0, p);
      } else if (IGNORED_G.has(code)) continue;
      else {
        // G28, G30, G92, G10, G38.x e afins usam X Y Z para outra coisa.
        unsupported('G', code);
        skipAxes = true;
      }
    }

    const hasAxis = v.X !== undefined || v.Y !== undefined || v.Z !== undefined;
    if (!hasAxis || skipAxes || motion === null) continue;

    // Destino em coordenadas da peça.
    const target: Mutable<Vec3> = { ...pos };
    for (const axis of AXES) {
      const w = v[axis.toUpperCase()];
      if (w === undefined) continue;
      if (knownFrom[axis] === Infinity) knownFrom[axis] = segments.length;
      const val = w * k;
      if (machineCoords) target[axis] = val - offset[axis];
      else target[axis] = absolute ? val : pos[axis] + val;
    }

    if (motion === 0) {
      push('rapid', target, 0);
      continue;
    }
    if (!(feed > 0)) {
      issue('no-feed', {
        severity: 'block',
        code: 'no-feed',
        line: lineNo,
        message: (n, l) =>
          n === 1
            ? `A linha ${l} corta sem avanço (F); a máquina recusa esse movimento.`
            : `${n} movimentos de corte sem avanço (F), o primeiro na linha ${l}; a máquina recusa esses movimentos.`,
      });
    }
    if (motion === 1 || plane !== 17) {
      push('feed', target, feed);
      continue;
    }

    const center = arcCenter(pos, target, motion === 2, v, k, lineNo, issue);
    if (!center) {
      push('feed', target, feed);
      continue;
    }
    for (const p of arcPoints(pos, target, center, motion === 2, tol)) push('arc', p, feed);
  }

  if (coordSystems.size > 1) {
    const names = [...coordSystems].sort().map((c) => `G${c}`).join(', ');
    issue('coordinate-system', {
      severity: 'warning',
      code: 'coordinate-system',
      line: 0,
      message: () => `O arquivo usa mais de um sistema de coordenadas (${names}); o percurso supõe o zero atual da peça.`,
    });
  }

  const problems: GcodeProblem[] = [...issues.values()].map((i) => ({
    severity: i.severity,
    code: i.code,
    message: i.message(i.count, i.line),
    line: i.line > 0 ? i.line : null,
  }));

  return {
    segments,
    problems,
    lineCount,
    byteLength: byte,
    workOffset: { ...offset },
    knownFrom: {
      x: Math.min(knownFrom.x, segments.length),
      y: Math.min(knownFrom.y, segments.length),
      z: Math.min(knownFrom.z, segments.length),
    },
    tools,
    spindleSpeeds: speeds,
  };
}

/**
 * O centro do arco, como o FluidNC calcula. Raio inconsistente é erro na placa,
 * então aqui é bloqueio: a mesma tolerância dela (0,005 mm, ou 0,1 % do raio).
 */
function arcCenter(
  from: Vec3,
  to: Vec3,
  clockwise: boolean,
  v: Partial<Record<string, number>>,
  k: number,
  line: number,
  issue: (key: string, i: Omit<Issue, 'count'>) => void,
): { x: number; y: number } | null {
  const bad = (message: string) =>
    issue(`arc:${line}`, { severity: 'block', code: 'arc-radius', line, message: () => message });

  if (v.R !== undefined) {
    let r = v.R * k;
    const x = to.x - from.x;
    const y = to.y - from.y;
    let h = 4 * r * r - x * x - y * y;
    if ((x === 0 && y === 0) || h < -1e-9) {
      bad(`O arco da linha ${line} tem raio pequeno demais para ligar os dois pontos; a máquina recusa esse arco.`);
      return null;
    }
    h = -Math.sqrt(Math.max(0, h)) / Math.hypot(x, y);
    if (!clockwise) h = -h;
    if (r < 0) {
      h = -h;
      r = -r;
    }
    return { x: from.x + 0.5 * (x - y * h), y: from.y + 0.5 * (y + x * h) };
  }

  const i = (v.I ?? 0) * k;
  const j = (v.J ?? 0) * k;
  const center = { x: from.x + i, y: from.y + j };
  const r0 = Math.hypot(i, j);
  const r1 = Math.hypot(to.x - center.x, to.y - center.y);
  const delta = Math.abs(r1 - r0);
  if (r0 === 0 || (delta > 0.005 && (delta > 0.5 || delta > 0.001 * r0))) {
    bad(
      `O arco da linha ${line} não fecha: o raio no início e no fim difere ${mm(delta)}; a máquina recusa esse arco.`,
    );
    return null;
  }
  return center;
}

/**
 * Os vértices do arco, já sem o ponto inicial. Cada corda fica a no máximo `tol`
 * do arco; o último vértice é exatamente o destino.
 */
function arcPoints(from: Vec3, to: Vec3, c: { x: number; y: number }, clockwise: boolean, tol: number): Vec3[] {
  const r0x = from.x - c.x;
  const r0y = from.y - c.y;
  const r1x = to.x - c.x;
  const r1y = to.y - c.y;
  let travel = Math.atan2(r0x * r1y - r0y * r1x, r0x * r1x + r0y * r1y);
  const EPS = 5e-7;
  if (clockwise) {
    if (travel >= -EPS) travel -= 2 * Math.PI;
  } else if (travel <= EPS) travel += 2 * Math.PI;

  const radius = Math.hypot(r0x, r0y);
  const maxStep = tol < radius ? 2 * Math.acos(1 - tol / radius) : Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(travel) / maxStep));
  const a0 = Math.atan2(r0y, r0x);
  const out: Vec3[] = [];
  for (let s = 1; s < n; s++) {
    const a = a0 + (travel * s) / n;
    out.push({ x: c.x + radius * Math.cos(a), y: c.y + radius * Math.sin(a), z: from.z + ((to.z - from.z) * s) / n });
  }
  out.push({ ...to });
  return out;
}

// ——— Análise ————————————————————————————————————————————————————————————————

export interface Box {
  min: Vec3;
  max: Vec3;
}

export interface JobAnalysis {
  /** null quando o arquivo não move nada. */
  bounds: { work: Box | null; machine: Box | null };
  /** O quanto o corte desce abaixo do zero da peça, em mm (0 se não desce). */
  maxDepthMm: number;
  cuttingDistanceMm: number;
  rapidDistanceMm: number;
  tools: number[];
  spindleSpeeds: number[];
  lineCount: number;
}

const isMove = (s: Segment) => s.kind === 'rapid' || s.kind === 'feed' || s.kind === 'arc';
const dist = (a: Vec3, b: Vec3) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

export function analyzeToolpath(path: Toolpath): JobAnalysis {
  const min: Mutable<Vec3> = { x: Infinity, y: Infinity, z: Infinity };
  const max: Mutable<Vec3> = { x: -Infinity, y: -Infinity, z: -Infinity };
  let moved = false;
  let minCutZ = Infinity;
  let cutting = 0;
  let rapid = 0;
  path.segments.forEach((s, i) => {
    if (!isMove(s)) return;
    moved = true;
    // Só os destinos, e só nos eixos que o arquivo já definiu: o resto é suposição.
    for (const axis of AXES) {
      if (i < path.knownFrom[axis]) continue;
      min[axis] = Math.min(min[axis], s.end[axis]);
      max[axis] = Math.max(max[axis], s.end[axis]);
    }
    const d = dist(s.start, s.end);
    if (s.kind === 'rapid') rapid += d;
    else {
      cutting += d;
      minCutZ = Math.min(minCutZ, s.end.z);
    }
  });
  // Eixo que o arquivo nunca move fica onde já está: no ponto suposto.
  const start = path.segments[0]?.start ?? ZERO;
  for (const axis of AXES) {
    if (min[axis] === Infinity) min[axis] = max[axis] = start[axis];
  }
  const box: Box | null = moved ? { min, max } : null;
  const o = path.workOffset;
  const shift = (p: Vec3): Vec3 => ({ x: p.x + o.x, y: p.y + o.y, z: p.z + o.z });
  return {
    bounds: { work: box, machine: box ? { min: shift(box.min), max: shift(box.max) } : null },
    maxDepthMm: Number.isFinite(minCutZ) ? Math.max(0, -minCutZ) : 0,
    cuttingDistanceMm: cutting,
    rapidDistanceMm: rapid,
    tools: [...path.tools],
    spindleSpeeds: [...path.spindleSpeeds],
    lineCount: path.lineCount,
  };
}

// ——— Conferência contra a máquina ————————————————————————————————————————————

export interface CheckOptions {
  /** Proteção da mesa: o corte não pode descer mais que isso abaixo do zero da peça. */
  maxDepthMm?: number;
}

/**
 * Tudo o que impede ou põe em dúvida o trabalho nesta máquina, bloqueios antes
 * dos avisos. Os limites vêm de `limitsOf(profile)`; o deslocamento, do percurso.
 */
export function checkToolpath(path: Toolpath, limits: MachineLimits, options: CheckOptions = {}): GcodeProblem[] {
  const a = analyzeToolpath(path);
  const out: GcodeProblem[] = [];
  const box = a.bounds.machine;
  for (const axis of AXES) {
    const l = limits[axis];
    const name = axis.toUpperCase();
    if (!l) {
      out.push({
        severity: 'warning',
        code: 'unknown-travel',
        message: `O curso do ${name} não é conhecido (sem homing); o percurso não foi conferido nesse eixo.`,
        line: null,
        axis,
      });
      continue;
    }
    if (!box) continue;
    const over = Math.max(l.min - box.min[axis], box.max[axis] - l.max);
    if (over > 1e-6) {
      const overMm = Math.round(over * 1000) / 1000;
      out.push({
        severity: 'block',
        code: 'out-of-travel',
        message: `O percurso passa ${mm(overMm)} do curso do ${name}.`,
        line: null,
        axis,
        overMm,
      });
    }
  }
  if (options.maxDepthMm !== undefined && a.maxDepthMm > options.maxDepthMm + 1e-6) {
    out.push({
      severity: 'block',
      code: 'too-deep',
      message: `O corte desce ${mm(a.maxDepthMm)} abaixo do zero da peça, mais que o limite de ${mm(options.maxDepthMm)} da mesa.`,
      line: null,
    });
  }
  const all = [...path.problems, ...out];
  return [...all.filter((p) => p.severity === 'block'), ...all.filter((p) => p.severity === 'warning')];
}

// ——— Tempo ————————————————————————————————————————————————————————————————

export interface TimeOptions {
  /** `junction_deviation_mm` do FluidNC. */
  junctionDeviationMm?: number;
}

export interface TimeEstimate {
  totalS: number;
  /** Tempo acumulado ao fim de cada segmento, alinhado com `segments`. */
  cumulativeS: number[];
}

/** Para eixos ausentes do perfil: não limitam. Se nenhum limita, um valor prudente. */
const FALLBACK_RATE_MM_S = 1000 / 60;
const FALLBACK_ACCEL = 100;

function limitAlong(u: Vec3, profile: MachineProfile, pick: (axis: Axis) => number, fallback: number): number {
  let best = Infinity;
  for (const axis of AXES) {
    const c = Math.abs(u[axis]);
    if (c < 1e-12) continue;
    const lim = pick(axis);
    if (lim > 0) best = Math.min(best, lim / c);
  }
  return Number.isFinite(best) ? best : fallback;
}

interface Block {
  seg: number;
  len: number;
  u: Vec3;
  vNom: number;
  accel: number;
  /** Quadrado da maior velocidade de entrada permitida pela quina. */
  vJ2: number;
}

/** Tempo de um trapézio (ou triângulo) com entrada v0, saída v1, cruzeiro v e aceleração a. */
function trapezoid(len: number, v0: number, v1: number, v: number, a: number): number {
  const da = (v * v - v0 * v0) / (2 * a);
  const dd = (v * v - v1 * v1) / (2 * a);
  if (da + dd <= len) return (v - v0) / a + (v - v1) / a + (len - da - dd) / v;
  const vp = Math.sqrt(Math.max(v0 * v0, v1 * v1, (2 * a * len + v0 * v0 + v1 * v1) / 2));
  return Math.max(0, (vp - v0) / a) + Math.max(0, (vp - v1) / a);
}

/** Atraso do fuso ao mudar de estado, como a placa espera (`spinup_ms`, `spindown_ms`). */
function spindleDelayS(profile: MachineProfile, fromDir: SpindleDir, fromRpm: number, toDir: SpindleDir, toRpm: number): number {
  const sp = profile.spindle;
  if (!sp) return 0;
  if (toDir === 'off') return fromDir === 'off' ? 0 : sp.spindownMs / 1000;
  if (fromDir === 'off' || fromDir !== toDir) return sp.spinupMs / 1000;
  // Mudança de rotação com o fuso ligado: proporcional à variação (aproximação).
  const span = sp.maxRpm > 0 ? sp.maxRpm : Math.max(fromRpm, toRpm, 1);
  const frac = Math.min(1, Math.abs(toRpm - fromRpm) / span);
  return ((toRpm > fromRpm ? sp.spinupMs : sp.spindownMs) / 1000) * frac;
}

/**
 * Simula o planejador do FluidNC: cada movimento é um trapézio com a aceleração
 * e a velocidade do eixo mais restritivo na direção dele; a velocidade nas
 * quinas vem do desvio de junção, com passadas para trás e para frente. Rápidos
 * vão no máximo de cada eixo. Pausas e o fuso param a máquina.
 */
export function estimateTime(path: Toolpath, profile: MachineProfile, options: TimeOptions = {}): TimeEstimate {
  const jd = options.junctionDeviationMm ?? profile.junctionDeviationMm ?? DEFAULT_JUNCTION_DEVIATION_MM;
  const rate = (axis: Axis) => (profile.axes[axis]?.maxRateMmPerMin ?? 0) / 60;
  const acc = (axis: Axis) => profile.axes[axis]?.accelMmPerS2 ?? 0;

  const segTime = new Array<number>(path.segments.length).fill(0);
  const blocks: Block[] = [];
  let prev: Block | null = null;
  let barrier = true;
  let dir: SpindleDir = 'off';
  let rpm = 0;

  path.segments.forEach((s, i) => {
    if (s.kind === 'dwell') {
      segTime[i] = s.dwellS;
      barrier = true;
      return;
    }
    if (s.kind === 'spindle') {
      segTime[i] = spindleDelayS(profile, dir, rpm, s.spindleDir, s.spindleRpm);
      dir = s.spindleDir;
      rpm = s.spindleRpm;
      barrier = true;
      return;
    }
    const len = dist(s.start, s.end);
    if (len < 1e-9) return; // a placa descarta movimentos de comprimento zero
    const u = { x: (s.end.x - s.start.x) / len, y: (s.end.y - s.start.y) / len, z: (s.end.z - s.start.z) / len };
    const vAxis = limitAlong(u, profile, rate, FALLBACK_RATE_MM_S);
    // Corte sem F a placa recusa; para o tempo, conta no máximo dos eixos.
    const vNom = s.kind === 'rapid' || !(s.feed > 0) ? vAxis : Math.min(s.feed / 60, vAxis);
    const accel = limitAlong(u, profile, acc, FALLBACK_ACCEL);

    let vJ2 = 0;
    if (!barrier && prev) {
      const cos = -(prev.u.x * u.x + prev.u.y * u.y + prev.u.z * u.z);
      const cap = Math.min(prev.vNom, vNom) ** 2;
      if (cos > 0.999999) vJ2 = 0;
      else if (cos < -0.999999) vJ2 = cap;
      else {
        const jx = u.x - prev.u.x;
        const jy = u.y - prev.u.y;
        const jz = u.z - prev.u.z;
        const jl = Math.hypot(jx, jy, jz);
        const ja = limitAlong({ x: jx / jl, y: jy / jl, z: jz / jl }, profile, acc, FALLBACK_ACCEL);
        const sin = Math.sqrt(0.5 * (1 - cos));
        vJ2 = Math.min(cap, (ja * jd * sin) / (1 - sin));
      }
    }
    const b: Block = { seg: i, len, u, vNom, accel, vJ2 };
    blocks.push(b);
    prev = b;
    barrier = false;
  });

  // Velocidades de entrada (ao quadrado): para trás, cada bloco precisa conseguir
  // frear até a entrada do próximo; para frente, acelerar a partir da anterior.
  const n = blocks.length;
  const entry2 = blocks.map((b) => b.vJ2);
  for (let i = n - 1; i >= 0; i--) {
    const b = blocks[i]!;
    const exit2 = i + 1 < n ? entry2[i + 1]! : 0;
    entry2[i] = Math.min(entry2[i]!, exit2 + 2 * b.accel * b.len);
  }
  for (let i = 1; i < n; i++) {
    const p = blocks[i - 1]!;
    entry2[i] = Math.min(entry2[i]!, entry2[i - 1]! + 2 * p.accel * p.len);
  }
  for (let i = 0; i < n; i++) {
    const b = blocks[i]!;
    const v0 = Math.sqrt(entry2[i]!);
    const v1 = Math.sqrt(i + 1 < n ? entry2[i + 1]! : 0);
    segTime[b.seg] = trapezoid(b.len, v0, v1, b.vNom, b.accel);
  }

  const cumulativeS: number[] = [];
  let t = 0;
  for (const s of segTime) {
    t += s;
    cumulativeS.push(t);
  }
  return { totalS: t, cumulativeS };
}

// ——— Progresso ——————————————————————————————————————————————————————————————

export interface Progress {
  /** Índice do segmento em andamento; `segments.length` quando acabou. */
  segmentIndex: number;
  segment: Segment | null;
  elapsedS: number;
  remainingS: number;
}

/** O `SD:` do FluidNC é a porcentagem dos bytes lidos do arquivo. */
export function bytePosOfPercent(percent: number, byteLength: number): number {
  const p = Math.min(100, Math.max(0, percent));
  return Math.round((p / 100) * byteLength);
}

/**
 * Onde a máquina está, pela posição de leitura no arquivo: os segmentos de linhas
 * já lidas por inteiro contam como feitos. A placa lê um pouco à frente do que
 * executa, então o tempo restante tende a ser levemente otimista.
 */
export function progressAt(path: Toolpath, time: TimeEstimate, bytePos: number): Progress {
  const segs = path.segments;
  // Primeiro segmento cuja linha ainda não terminou de ser lida.
  let lo = 0;
  let hi = segs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid]!.byteEnd <= bytePos) lo = mid + 1;
    else hi = mid;
  }
  const elapsedS = lo > 0 ? time.cumulativeS[lo - 1]! : 0;
  return {
    segmentIndex: lo,
    segment: segs[lo] ?? null,
    elapsedS,
    remainingS: Math.max(0, time.totalS - elapsedS),
  };
}
