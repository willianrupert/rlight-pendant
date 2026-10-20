import { describe, expect, it } from 'vitest';
import { parseGcode, previewOf } from '../src/index';

// A prévia do percurso para o mapa: as linhas do corte e dos rápidos em X e Y,
// emagrecidas até caber no orçamento de pontos, sem perder o desenho.

const square = `G21 G90
G0 Z5
G0 X0 Y0
G1 Z-1 F300
G1 X10 F1000
G1 Y10
G1 X0
G1 Y0
G0 Z5
G0 X20 Y0
G1 Z-1
G1 X30
G0 Z5`;

describe('previewOf', () => {
  it('separa corte e rápidos em linhas, em coordenadas da peça', () => {
    const p = previewOf(parseGcode(square));
    expect(p.holes).toEqual([]);
    expect(p.cuts).toEqual([
      [0, 0, 10, 0, 10, 10, 0, 10, 0, 0],
      [20, 0, 30, 0],
    ]);
    // Os rápidos: até o começo, e de um corte ao outro. Subir e descer no lugar não desenha nada.
    expect(p.rapids).toEqual([[0, 0, 20, 0]]);
  });

  it('o primeiro rápido sai de onde a máquina estava só se o arquivo não definiu o ponto; aqui, nada', () => {
    const p = previewOf(parseGcode('G0 X5 Y5\nG1 X6 F100'));
    expect(p.rapids).toEqual([]);
    expect(p.cuts).toEqual([[5, 5, 6, 5]]);
  });

  it('um arco vira muitos pontos; o orçamento emagrece sem perder as pontas', () => {
    const arcs = Array.from({ length: 200 }, (_, i) => `G2 X${i % 2 ? 0 : 20} Y0 I${i % 2 ? -10 : 10} J0`).join('\n');
    const path = parseGcode(`G0 X0 Y0\nG1 Z-1 F100\n${arcs}`, { arcToleranceMm: 0.002 });
    const full = previewOf(path, 1e9);
    const thin = previewOf(path, 500);
    const count = (p: { cuts: number[][]; rapids: number[][] }) => [...p.cuts, ...p.rapids].reduce((n, l) => n + l.length / 2, 0);
    expect(count(full)).toBeGreaterThan(500);
    expect(count(thin)).toBeLessThanOrEqual(500);
    // Emagrece só o preciso: perto do orçamento, não muito abaixo.
    expect(count(thin)).toBeGreaterThan(400);
    expect(thin.cuts[0]!.slice(0, 2)).toEqual([0, 0]);
    expect(thin.cuts.at(-1)!.slice(-2)).toEqual(full.cuts.at(-1)!.slice(-2));
  });

  it('arquivo sem movimento: nada a desenhar', () => {
    expect(previewOf(parseGcode('M3 S1000\nG4 P1\nM5'))).toEqual({ cuts: [], rapids: [], holes: [] });
  });

  it('furos: descer e subir no lugar vira um ponto; a entrada de um contorno, não', () => {
    const p = previewOf(parseGcode(`G0 Z5
G0 X10 Y10
G1 Z-6 F200
G0 Z5
G0 X30 Y10
G1 Z-6 F200
G1 Z5
G0 X50 Y10
G1 Z-2 F200
G1 X60 F800
G0 Z5`));
    expect(p.holes).toEqual([10, 10, 30, 10]);
  });
});
