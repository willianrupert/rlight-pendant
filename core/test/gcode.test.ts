import { describe, expect, it } from 'vitest';
import configDump from './fixtures/fluidnc-3.9.9/config-dump.yaml?raw';
import { analyze, checkAgainstMachine, estimateTime, parseGcode, progressAt } from '../src/gcode';
import { limitsOf, profileFromConfig } from '../src/profile';

// ADR-0006: antes de enviar, o servidor analisa o arquivo; durante o corte,
// a porcentagem do SD vira tempo restante e trecho já cortado.

const rlight = profileFromConfig(configDump);
const square = ['G21 G90', 'G0 Z5', 'G0 X0 Y0', 'G1 Z-1 F300', 'G1 X10 F600', 'G1 Y10', 'G1 X0', 'G1 Y0', 'G0 Z5', 'M5'].join('\n');

describe('parseGcode: modos e coordenadas', () => {
  it('lê movimentos rápidos e de corte com avanço modal', () => {
    const p = parseGcode(square);
    const moves = p.segments.filter((s) => s.kind !== 'dwell');
    expect(moves.map((s) => s.kind)).toEqual(['rapid', 'rapid', 'feed', 'feed', 'feed', 'feed', 'feed', 'rapid']);
    expect(moves[4]!.feed).toBe(600); // F modal
    expect(moves[3]!.to).toEqual({ x: 10, y: 0, z: -1 });
  });

  it('ignora comentários e números de linha', () => {
    const p = parseGcode('N10 G1 X5 F100 (vai) ; comentário\n(linha só de comentário)\nN20 G1 X6');
    expect(p.segments.map((s) => s.to.x)).toEqual([5, 6]);
  });

  it('G91 relativo e G90 absoluto', () => {
    const p = parseGcode('G91\nG1 X5 F100\nG1 X5\nG90\nG1 X1');
    expect(p.segments.map((s) => s.to.x)).toEqual([5, 10, 1]);
  });

  it('G20 converte polegadas para mm, inclusive o avanço', () => {
    const p = parseGcode('G20\nG1 X1 F10');
    expect(p.segments[0]!.to.x).toBeCloseTo(25.4);
    expect(p.segments[0]!.feed).toBeCloseTo(254);
  });

  it('posição inicial vem de fora', () => {
    const p = parseGcode('G1 X10 F100', { start: { x: 2, y: 3, z: 4 } });
    expect(p.segments[0]!.from).toEqual({ x: 2, y: 3, z: 4 });
    expect(p.segments[0]!.to).toEqual({ x: 10, y: 3, z: 4 });
  });

  it('G53 é em coordenadas de máquina, convertido pela origem da peça', () => {
    const p = parseGcode('G53 G0 Z-5', { workOffset: { x: 100, y: 50, z: -20 } });
    expect(p.segments[0]!.to.z).toBe(15);
  });

  it('G4 vira uma pausa com duração', () => {
    const p = parseGcode('G4 P1.5');
    expect(p.segments[0]).toMatchObject({ kind: 'dwell', dwellMs: 1500 });
  });

  it('registra ferramentas, rotações e quantas linhas', () => {
    const p = parseGcode('T1 M6\nM3 S12000\nG1 X1 F100\nM3 S9000\nM5');
    expect(p.tools).toEqual([1]);
    expect(p.spindleSpeeds).toEqual([12000, 9000]);
    expect(p.lineCount).toBe(5);
  });
});

describe('parseGcode: arcos', () => {
  it('meia-volta G2 com I e J vira vários segmentos sobre o círculo', () => {
    const p = parseGcode('G0 X10 Y0\nG2 X-10 Y0 I-10 J0 F600');
    const arc = p.segments.filter((s) => s.kind === 'arc');
    expect(arc.length).toBeGreaterThan(10);
    for (const s of arc) expect(Math.hypot(s.to.x, s.to.y)).toBeCloseTo(10, 6);
    expect(arc[arc.length - 1]!.to.x).toBeCloseTo(-10);
    // G2 é horário: de (10,0) para (-10,0) passando por y negativo.
    expect(Math.min(...arc.map((s) => s.to.y))).toBeCloseTo(-10, 1);
  });

  it('círculo completo quando início e fim coincidem', () => {
    const p = parseGcode('G0 X10 Y0\nG3 X10 Y0 I-10 J0 F600');
    const len = p.segments.filter((s) => s.kind === 'arc').reduce((a, s) => a + Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y), 0);
    expect(len).toBeCloseTo(2 * Math.PI * 10, 1);
  });

  it('arco por raio R', () => {
    const p = parseGcode('G0 X0 Y0\nG2 X10 Y0 R5 F600');
    const arc = p.segments.filter((s) => s.kind === 'arc');
    expect(arc[arc.length - 1]!.to.x).toBeCloseTo(10);
    expect(Math.max(...arc.map((s) => s.to.y))).toBeCloseTo(5, 1);
  });

  it('a corda respeita a tolerância', () => {
    const p = parseGcode('G0 X10 Y0\nG2 X-10 Y0 I-10 J0 F600', { arcToleranceMm: 0.002 });
    for (const s of p.segments.filter((s) => s.kind === 'arc')) {
      const mid = { x: (s.from.x + s.to.x) / 2, y: (s.from.y + s.to.y) / 2 };
      expect(10 - Math.hypot(mid.x, mid.y)).toBeLessThanOrEqual(0.002 + 1e-9);
    }
  });
});

describe('analyze', () => {
  it('limites, profundidade e distâncias', () => {
    const a = analyze(parseGcode(square));
    expect(a.bounds.min).toEqual({ x: 0, y: 0, z: -1 });
    expect(a.bounds.max).toEqual({ x: 10, y: 10, z: 5 });
    expect(a.maxDepth).toBe(-1);
    expect(a.cutDistance).toBeCloseTo(6 + 40);
    expect(a.rapidDistance).toBeCloseTo(5 + 6);
  });
});

describe('checkAgainstMachine', () => {
  const limits = limitsOf(rlight);

  it('um trabalho que cabe não tem problemas', () => {
    const p = parseGcode(square, { workOffset: { x: 100, y: 100, z: -50 } });
    expect(checkAgainstMachine(p, { limits, workOffset: { x: 100, y: 100, z: -50 } })).toEqual([]);
  });

  it('passar do curso bloqueia, e diz quanto e em que eixo', () => {
    const p = parseGcode('G0 X0 Y0\nG1 Y620 F500', { workOffset: { x: 100, y: 0, z: -50 } });
    const problems = checkAgainstMachine(p, { limits, workOffset: { x: 100, y: 0, z: -50 } });
    expect(problems).toContainEqual({ severity: 'block', message: 'O percurso passa 16,0 mm do curso do Y.' });
  });

  it('descer abaixo do limite da mesa bloqueia', () => {
    const p = parseGcode('G1 Z-12 F100');
    const problems = checkAgainstMachine(p, { limits: {}, workOffset: { x: 0, y: 0, z: 0 }, tableDepthWorkZ: -10 });
    expect(problems).toContainEqual({ severity: 'block', message: 'O percurso desce 2,0 mm abaixo do limite da mesa.' });
  });

  it('corte sem avanço bloqueia, com a linha', () => {
    const problems = checkAgainstMachine(parseGcode('G0 X1\nG1 X5'), { limits: {}, workOffset: { x: 0, y: 0, z: 0 } });
    expect(problems).toContainEqual({ severity: 'block', message: 'Movimento de corte sem avanço, na linha 2.', line: 2 });
  });

  it('arco impossível bloqueia, com a linha', () => {
    const problems = checkAgainstMachine(parseGcode('G0 X0 Y0\nG2 X20 Y0 R5 F600'), { limits: {}, workOffset: { x: 0, y: 0, z: 0 } });
    expect(problems).toContainEqual({ severity: 'block', message: 'Arco impossível na linha 2.', line: 2 });
  });

  it('arcos fora do plano XY viram aviso', () => {
    const problems = checkAgainstMachine(parseGcode('G18\nG2 X1 Z1 I1 F100'), { limits: {}, workOffset: { x: 0, y: 0, z: 0 } });
    expect(problems.some((p) => p.severity === 'warning')).toBe(true);
  });
});

describe('estimateTime', () => {
  it('um movimento reto tem tempo exato pelo trapézio', () => {
    // 100 mm a 3000 mm/min (50 mm/s), 250 mm/s²: acelera 5 mm, desacelera 5 mm,
    // cruza 90 mm. 0,2 + 0,2 + 1,8 = 2,2 s.
    const e = estimateTime(parseGcode('G1 X100 F3000'), rlight);
    expect(e.totalS).toBeCloseTo(2.2, 6);
  });

  it('movimento curto não chega à velocidade de cruzeiro', () => {
    // 4 mm com 250 mm/s²: pico em sqrt(250·4) = 31,6 mm/s; t = 2·31,6/250.
    const e = estimateTime(parseGcode('G1 X4 F3000'), rlight);
    expect(e.totalS).toBeCloseTo((2 * Math.sqrt(1000)) / 250, 6);
  });

  it('o avanço é limitado pela velocidade máxima do eixo', () => {
    const fast = estimateTime(parseGcode('G1 X100 F99999'), rlight);
    const capped = estimateTime(parseGcode('G1 X100 F3000'), rlight);
    expect(fast.totalS).toBeCloseTo(capped.totalS, 6);
  });

  it('em linha reta, dividir o movimento não muda o tempo', () => {
    const one = estimateTime(parseGcode('G1 X100 F3000'), rlight);
    const two = estimateTime(parseGcode('G1 X50 F3000\nG1 X100'), rlight);
    expect(two.totalS).toBeCloseTo(one.totalS, 3);
  });

  it('uma quina de 90° custa tempo, uma reversão custa mais', () => {
    const straight = estimateTime(parseGcode('G1 X50 F3000\nG1 X100'), rlight).totalS;
    const corner = estimateTime(parseGcode('G1 X50 F3000\nG1 X50 Y50'), rlight).totalS;
    const reverse = estimateTime(parseGcode('G1 X50 F3000\nG1 X0'), rlight).totalS;
    expect(corner).toBeGreaterThan(straight);
    expect(reverse).toBeGreaterThan(corner);
  });

  it('pausas entram no tempo', () => {
    const e = estimateTime(parseGcode('G1 X100 F3000\nG4 P2'), rlight);
    expect(e.totalS).toBeCloseTo(4.2, 6);
  });

  it('o tempo acumulado só cresce e termina no total', () => {
    const e = estimateTime(parseGcode(square), rlight);
    for (let i = 1; i < e.cumulativeS.length; i++) expect(e.cumulativeS[i]!).toBeGreaterThanOrEqual(e.cumulativeS[i - 1]!);
    expect(e.cumulativeS[e.cumulativeS.length - 1]).toBeCloseTo(e.totalS, 9);
  });
});

describe('progressAt: da porcentagem do SD ao tempo restante', () => {
  const p = parseGcode(square);
  const e = estimateTime(p, rlight);

  it('no começo do arquivo, falta tudo', () => {
    expect(progressAt(p, e, 0).remainingS).toBeCloseTo(e.totalS, 9);
  });

  it('no fim do arquivo, não falta nada', () => {
    const r = progressAt(p, e, p.byteLength);
    expect(r.remainingS).toBeCloseTo(0, 9);
    expect(r.elapsedS).toBeCloseTo(e.totalS, 9);
  });

  it('o tempo restante nunca sobe conforme o arquivo avança', () => {
    let last = Infinity;
    for (let b = 0; b <= p.byteLength; b += 3) {
      const r = progressAt(p, e, b);
      expect(r.remainingS).toBeLessThanOrEqual(last + 1e-9);
      last = r.remainingS;
    }
  });
});
