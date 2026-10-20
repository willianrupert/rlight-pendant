// Os trabalhos (v2) do lado da tela: o que a biblioteca e a folha do trabalho
// mostram. O servidor lê e confere o arquivo (server/src/jobs.ts); aqui, só a
// apresentação, pura e testada.

import type { MachineLimits, Vec3 } from '@rlight/core';
import { formatMm } from './present';

export interface JobInfo {
  id: string;
  name: string;
  bytes: number;
  addedAt: number;
}

export interface JobProblem {
  severity: 'block' | 'warning';
  code: string;
  message: string;
  line: number | null;
}

export interface JobBox {
  min: Vec3;
  max: Vec3;
}

export interface JobDetail {
  id: string;
  name: string;
  workOffset: Vec3 | null;
  homed: boolean;
  bounds: { work: JobBox | null; machine: JobBox | null };
  maxDepthMm: number;
  cuttingDistanceMm: number;
  estimatedS: number;
  tools: number[];
  spindleSpeeds: number[];
  lineCount: number;
  problems: JobProblem[];
  preview: { cuts: number[][]; rapids: number[][]; holes: number[] };
}

/** O maior arquivo que o servidor aceita (server/src/jobs.ts). */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Os arquivos que o seletor oferece: as extensões comuns de G-code. */
export const GCODE_ACCEPT = '.nc,.ngc,.gcode,.gc,.tap,.cnc,.txt';

/** O tamanho do arquivo, como o app Arquivos mostra. */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} bytes`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1).replace('.', ',')} MB`;
}

/** Quanto tempo o corte leva, arredondado como uma pessoa diria. */
export function formatJobTime(s: number): string {
  if (s < 60) return 'menos de 1 min';
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/** Um número em mm sem os zeros do fim: 40, 12,5, 0,25. */
function mm(v: number): string {
  return formatMm(v).replace(/,?0+$/, '');
}

export interface JobFacts {
  /** Largura × altura do corte na mesa. */
  size: string | null;
  depth: string;
  time: string;
  tools: string | null;
  rpm: string | null;
}

export function jobFacts(d: JobDetail): JobFacts {
  const b = d.bounds.work;
  return {
    size: b ? `${mm(b.max.x - b.min.x)} × ${mm(b.max.y - b.min.y)} mm` : null,
    depth: d.maxDepthMm > 0 ? `${mm(d.maxDepthMm)} mm` : 'Não desce',
    time: `≈ ${formatJobTime(d.estimatedS)}`,
    tools: d.tools.length ? d.tools.map((t) => `T${t}`).join(' · ') : null,
    rpm: d.spindleSpeeds.length
      ? d.spindleSpeeds.map((r) => Math.round(r).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')).join(' · ') + ' rpm'
      : null,
  };
}

/** O que fica entre o trabalho e o corte: o motivo, numa frase. */
export function blockedBy(d: JobDetail): string | null {
  return d.problems.find((p) => p.severity === 'block')?.message ?? null;
}

export interface PreviewFrame {
  /** A área desenhada, em mm, com Y crescendo para cima (a tela inverte). */
  minX: number;
  minY: number;
  width: number;
  height: number;
  /** Somado às linhas da prévia (coordenadas da peça) para cair no lugar certo. */
  offset: { x: number; y: number };
  /** A prévia está na mesa (homing e zero conhecidos): desenha a mesa e a máquina. */
  onTable: boolean;
}

/**
 * Onde desenhar. Com homing e zero, o trabalho no lugar dele na mesa, com uma
 * margem de mesa em volta (e a máquina, se está perto); sem, só o trabalho.
 * A mesa inteira não: numa mesa de 1,2 m, uma tampa de 14 cm vira um ponto.
 */
export function previewFrame(d: JobDetail, limits: MachineLimits, here?: { x: number; y: number } | null): PreviewFrame | null {
  const x = limits.x;
  const y = limits.y;
  const m = d.bounds.machine;
  if (m && d.workOffset && x && y) {
    let minX = m.min.x;
    let maxX = m.max.x;
    let minY = m.min.y;
    let maxY = m.max.y;
    // A máquina entra no quadro se está a menos de um tamanho do trabalho dele.
    const size = Math.max(maxX - minX, maxY - minY, 1);
    if (here && here.x > minX - size && here.x < maxX + size && here.y > minY - size && here.y < maxY + size) {
      minX = Math.min(minX, here.x);
      maxX = Math.max(maxX, here.x);
      minY = Math.min(minY, here.y);
      maxY = Math.max(maxY, here.y);
    }
    const pad = Math.max(40, Math.max(maxX - minX, maxY - minY) * 0.25);
    minX = Math.max(x.min, minX - pad);
    maxX = Math.min(x.max, maxX + pad);
    minY = Math.max(y.min, minY - pad);
    maxY = Math.min(y.max, maxY + pad);
    return { minX, minY, width: maxX - minX, height: maxY - minY, offset: { x: d.workOffset.x, y: d.workOffset.y }, onTable: true };
  }
  const b = d.bounds.work;
  if (!b) return null;
  const w = Math.max(b.max.x - b.min.x, 1);
  const h = Math.max(b.max.y - b.min.y, 1);
  const pad = Math.max(w, h) * 0.08;
  return { minX: b.min.x - pad, minY: b.min.y - pad, width: w + 2 * pad, height: h + 2 * pad, offset: { x: 0, y: 0 }, onTable: false };
}

/** Uma linha da prévia como pontos de SVG, já deslocada e com Y invertido. */
export function svgPoints(line: readonly number[], offset: { x: number; y: number }): string {
  const out: string[] = [];
  for (let i = 0; i + 1 < line.length; i += 2) out.push(`${r(line[i]! + offset.x)},${r(-(line[i + 1]! + offset.y))}`);
  return out.join(' ');
}

/** Os furos como pontos já deslocados, com Y invertido. */
export function holePoints(holes: readonly number[], offset: { x: number; y: number }): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < holes.length; i += 2) out.push({ x: r(holes[i]! + offset.x), y: r(-(holes[i + 1]! + offset.y)) });
  return out;
}

/** O aviso com a linha, sem repetir quando a mensagem já diz qual é. */
export function problemText(p: JobProblem): string {
  return p.line && !/linha/i.test(p.message) ? `${p.message} (linha ${p.line})` : p.message;
}

const r = (v: number) => Math.round(v * 100) / 100;
