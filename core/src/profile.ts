// O perfil da máquina (ADR-0008): o que o app sabe dela vem da configuração que
// a própria placa informa (`$CD`). Nenhum valor de máquina mora no código.

import type { Axis, MachineLimits } from './motion';
import { minStepMm } from './ruler';

export type ConfigValue = string | number | boolean | null | ConfigMap;
export interface ConfigMap {
  [key: string]: ConfigValue;
}

function scalar(raw: string): ConfigValue {
  const v = raw.trim();
  if (v === '') return null;
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) return v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/**
 * Lê o subconjunto de YAML que o FluidNC usa: mapas aninhados por indentação e
 * valores escalares. Listas e âncoras não aparecem na configuração dele.
 */
export function parseConfigYaml(text: string): ConfigMap {
  const rows: { indent: number; key: string; value: string | null }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const body = raw.trim();
    const i = body.indexOf(':');
    if (i < 0) continue;
    const rest = body.slice(i + 1);
    rows.push({ indent, key: body.slice(0, i).trim(), value: rest.trim() === '' ? null : rest });
  }
  let k = 0;
  function block(indent: number): ConfigMap {
    const map: ConfigMap = {};
    while (k < rows.length && rows[k]!.indent === indent) {
      const row = rows[k++]!;
      if (row.value !== null) map[row.key] = scalar(row.value);
      else if (k < rows.length && rows[k]!.indent > indent) map[row.key] = block(rows[k]!.indent);
      else map[row.key] = null;
    }
    return map;
  }
  return rows.length ? block(rows[0]!.indent) : {};
}

export interface AxisProfile {
  /** Curso em coordenadas de máquina; null sem homing, porque aí a posição não significa nada. */
  min: number | null;
  max: number | null;
  travelMm: number;
  stepsPerMm: number;
  minStepMm: number;
  maxRateMmPerMin: number;
  accelMmPerS2: number;
  softLimits: boolean;
  homingCycle: number | null;
}

export interface SpindleProfile {
  type: string;
  minRpm: number;
  /**
   * A menor rotação que o mostrador oferece. Com o speed_map partindo de 0=0%,
   * a curva vale desde baixo e o piso é 5% do máximo (o primeiro ponto, se for
   * menor); sem isso, abaixo do primeiro ponto não diferente de zero não há curva.
   */
  minRunningRpm: number;
  maxRpm: number;
  spinupMs: number;
  spindownMs: number;
  /** A curva do speed_map, rpm → % de PWM, na ordem da configuração. */
  speedMap: { rpm: number; percent: number }[];
}

export interface MachineProfile {
  name: string;
  kinematics: string;
  axes: Partial<Record<Axis, AxisProfile>>;
  homingOrder: Axis[];
  canHome: boolean;
  mustHome: boolean;
  spindle: SpindleProfile | null;
  hasProbe: boolean;
  hasSd: boolean;
  /** Tolerância de quina do planejador, usada na estimativa de tempo. */
  junctionDeviationMm: number;
}

const SPINDLE_SECTIONS = ['10V', 'PWM', 'Relay', 'Laser', 'BESC', 'DAC', 'Huanyang', 'H2A', 'H100', 'YL620', 'NowForever'];

const isMap = (v: ConfigValue | undefined): v is ConfigMap => typeof v === 'object' && v !== null;
const numOr = (v: ConfigValue | undefined, d: number) => (typeof v === 'number' ? v : d);
const hasPin = (v: ConfigValue | undefined) => typeof v === 'string' && v !== '' && v !== 'NO_PIN';

function axisProfile(a: ConfigMap): AxisProfile {
  const travel = numOr(a.max_travel_mm, 0);
  const stepsPerMm = numOr(a.steps_per_mm, 0);
  const homing = isMap(a.homing) ? a.homing : null;
  const cycle = homing ? numOr(homing.cycle, 0) : 0;
  let min: number | null = null;
  let max: number | null = null;
  if (homing && cycle > 0) {
    const mpos = numOr(homing.mpos_mm, 0);
    // Como o FluidNC: homing para o positivo deixa a máquina no topo do curso.
    if (homing.positive_direction === true) [min, max] = [mpos - travel, mpos];
    else [min, max] = [mpos, mpos + travel];
  }
  return {
    min,
    max,
    travelMm: travel,
    stepsPerMm,
    minStepMm: stepsPerMm > 0 ? minStepMm(stepsPerMm) : 0.01,
    maxRateMmPerMin: numOr(a.max_rate_mm_per_min, 0),
    accelMmPerS2: numOr(a.acceleration_mm_per_sec2, 0),
    softLimits: a.soft_limits === true,
    homingCycle: cycle > 0 ? cycle : null,
  };
}

function spindleProfile(cfg: ConfigMap): SpindleProfile | null {
  for (const type of SPINDLE_SECTIONS) {
    if (!(type in cfg)) continue;
    const s = cfg[type];
    const sec: ConfigMap = isMap(s) ? s : {};
    const rpms: number[] = [];
    const speedMap: { rpm: number; percent: number }[] = [];
    let fromZero = false;
    if (typeof sec.speed_map === 'string') {
      for (const pair of sec.speed_map.split(/\s+/)) {
        const [r, pct] = pair.split('=');
        const rpm = Number(r);
        if (!Number.isFinite(rpm)) continue;
        rpms.push(rpm);
        const percent = parseFloat(pct ?? '');
        if (Number.isFinite(percent)) speedMap.push({ rpm, percent });
        if (rpm === 0 && percent === 0) fromZero = true;
      }
    }
    const positive = rpms.filter((r) => r > 0);
    const maxRpm = rpms.length ? Math.max(...rpms) : 0;
    let minRunningRpm = positive.length ? Math.min(...positive) : rpms.length ? Math.min(...rpms) : 0;
    if (fromZero && positive.length) minRunningRpm = Math.min(minRunningRpm, Math.max(100, Math.round((maxRpm * 0.05) / 100) * 100));
    return {
      type,
      minRpm: rpms.length ? Math.min(...rpms) : 0,
      minRunningRpm,
      maxRpm,
      speedMap,
      spinupMs: numOr(sec.spinup_ms, 0),
      spindownMs: numOr(sec.spindown_ms, 0),
    };
  }
  return null;
}

export function profileFromConfig(text: string): MachineProfile {
  const cfg = parseConfigYaml(text);
  const axesCfg = isMap(cfg.axes) ? cfg.axes : {};
  const axes: Partial<Record<Axis, AxisProfile>> = {};
  for (const axis of ['x', 'y', 'z'] as const) {
    const a = axesCfg[axis];
    if (isMap(a)) axes[axis] = axisProfile(a);
  }
  const homingOrder = (Object.entries(axes) as [Axis, AxisProfile][])
    .filter(([, a]) => a.homingCycle !== null)
    .sort(([, a], [, b]) => a.homingCycle! - b.homingCycle!)
    .map(([axis]) => axis);
  const kin = isMap(cfg.kinematics) ? Object.keys(cfg.kinematics)[0] : undefined;
  const probe = isMap(cfg.probe) ? cfg.probe : null;
  const sd = isMap(cfg.sdcard) ? cfg.sdcard : null;
  const start = isMap(cfg.start) ? cfg.start : null;
  return {
    name: typeof cfg.name === 'string' ? cfg.name : 'Máquina FluidNC',
    kinematics: kin ?? 'Cartesian',
    axes,
    homingOrder,
    canHome: homingOrder.length > 0,
    mustHome: start?.must_home === true,
    spindle: spindleProfile(cfg),
    hasProbe: hasPin(probe?.pin),
    hasSd: hasPin(sd?.cs_pin),
    junctionDeviationMm: numOr(cfg.junction_deviation_mm, 0.01),
  };
}

/** Os limites que o movimento usa (ADR-0002): só os eixos com curso conhecido. */
export function limitsOf(profile: MachineProfile): MachineLimits {
  const out: MachineLimits = {};
  for (const [axis, a] of Object.entries(profile.axes) as [Axis, AxisProfile][]) {
    if (a.min !== null && a.max !== null) out[axis] = { min: a.min, max: a.max };
  }
  return out;
}
