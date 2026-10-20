// Os trabalhos (v2, ADR-0006), a parte pura: a prévia do percurso para o mapa.
// O servidor lê o arquivo com o gcode.ts e manda à tela só as linhas, em X e Y,
// emagrecidas até caber num orçamento de pontos.

import type { Toolpath } from './gcode';

export interface JobPreview {
  /** Linhas do corte, em coordenadas da peça: [x0, y0, x1, y1, …] em mm. */
  cuts: number[][];
  /** Linhas dos rápidos, do mesmo jeito. */
  rapids: number[][];
  /** Furos: onde o corte desce e sobe no lugar, sem andar em X e Y lá embaixo. [x0, y0, x1, y1, …]. */
  holes: number[];
}

/** Pontos que a tela desenha sem esforço, mesmo num iPhone antigo. */
export const PREVIEW_MAX_POINTS = 6_000;

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * As linhas do percurso. Só o que o arquivo definiu: o trecho que sai de uma
 * posição suposta (antes do primeiro X e Y do arquivo) não é desenhado, e subir
 * ou descer no lugar não desenha nada.
 */
export function previewOf(path: Toolpath, maxPoints: number = PREVIEW_MAX_POINTS): JobPreview {
  const lines: { rapid: boolean; pts: number[] }[] = [];
  let cur: { rapid: boolean; pts: number[] } | null = null;
  const knownFrom = Math.max(path.knownFrom.x, path.knownFrom.y);
  const holes: number[] = [];
  const seen = new Set<string>();
  /** Uma descida no lugar em corte: vira furo se a próxima coisa for subir. */
  let plunge: { x: number; y: number } | null = null;
  path.segments.forEach((s, i) => {
    if (s.kind !== 'rapid' && s.kind !== 'feed' && s.kind !== 'arc') return;
    if (i <= knownFrom) return;
    const still = Math.abs(s.end.x - s.start.x) < 1e-9 && Math.abs(s.end.y - s.start.y) < 1e-9;
    if (plunge && still && s.end.z > s.start.z) {
      const key = `${r2(plunge.x)},${r2(plunge.y)}`;
      if (!seen.has(key)) {
        seen.add(key);
        holes.push(r2(plunge.x), r2(plunge.y));
      }
    }
    if (still && s.kind !== 'rapid' && s.end.z < s.start.z) plunge = { x: s.end.x, y: s.end.y };
    else if (!(still && plunge && s.end.z < s.start.z)) plunge = null;
    if (still) return;
    const rapid = s.kind === 'rapid';
    if (!cur || cur.rapid !== rapid) {
      cur = { rapid, pts: [s.start.x, s.start.y] };
      lines.push(cur);
    }
    cur.pts.push(s.end.x, s.end.y);
  });

  const thin = (tol: number) =>
    lines.map((l) => {
      const out = [l.pts[0]!, l.pts[1]!];
      const n = l.pts.length / 2;
      for (let k = 1; k < n; k++) {
        const x = l.pts[2 * k]!;
        const y = l.pts[2 * k + 1]!;
        const last = k === n - 1;
        if (!last && Math.hypot(x - out[out.length - 2]!, y - out[out.length - 1]!) < tol) continue;
        out.push(x, y);
      }
      return { rapid: l.rapid, pts: out };
    });
  const count = (ls: { pts: number[] }[]) => ls.reduce((n, l) => n + l.pts.length / 2, 0);

  let kept = thin(0);
  if (count(kept) > maxPoints) {
    // A menor tolerância que cabe no orçamento: dobra até caber, depois busca entre
    // a que não cabia e a que cabe, para não emagrecer mais que o preciso.
    let lo = 0;
    let hi = 0.01;
    while (count((kept = thin(hi))) > maxPoints && hi < 1_000) [lo, hi] = [hi, hi * 2];
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2;
      const t = thin(mid);
      if (count(t) > maxPoints) lo = mid;
      else [hi, kept] = [mid, t];
    }
  }
  const pick = (rapid: boolean) => kept.filter((l) => l.rapid === rapid).map((l) => l.pts.map(r2));
  return { cuts: pick(false), rapids: pick(true), holes };
}
