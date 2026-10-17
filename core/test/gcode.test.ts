import { describe, expect, it } from 'vitest';
import configDump from './fixtures/fluidnc-3.9.9/config-dump.yaml?raw';
import placa from './fixtures/gcode/placa.nc?raw';
import { limitsOf, profileFromConfig, type MachineProfile } from '../src/profile';
import {
  analyzeToolpath,
  bytePosOfPercent,
  checkToolpath,
  estimateTime,
  parseGcode,
  progressAt,
  type Segment,
} from '../src/gcode';
import type { Vec3 } from '../src/protocol';

// ADR-0006: antes de enviar, o servidor analisa o arquivo; durante o corte, a
// porcentagem do SD vira tempo restante e trecho já cortado. Os arquivos aqui
// são pequenos e escritos à mão, com respostas que dá para conferir no papel.

const profile = profileFromConfig(configDump);
const limits = limitsOf(profile);
// Sem fuso, para que os tempos de movimento sejam só movimento.
const bare: MachineProfile = { ...profile, spindle: null };

const motion = (segs: Segment[]) => segs.filter((s) => s.kind === 'rapid' || s.kind === 'feed' || s.kind === 'arc');
const ends = (segs: Segment[]) => motion(segs).map((s) => s.end);
const near = (a: Vec3, b: Vec3, d = 6) => {
  expect(a.x).toBeCloseTo(b.x, d);
  expect(a.y).toBeCloseTo(b.y, d);
  expect(a.z).toBeCloseTo(b.z, d);
};

describe('parseGcode: leitura das linhas', () => {
  it('ignora comentários entre parênteses e depois de ponto e vírgula', () => {
    const p = parseGcode('G1 X10 (vai até X10 Y99) F500 ; Y77\n');
    expect(ends(p.segments)).toEqual([{ x: 10, y: 0, z: 0 }]);
    expect(p.segments[0]!.feed).toBe(500);
    expect(p.problems).toEqual([]);
  });

  it('números de linha N, minúsculas, espaços dentro das palavras e %', () => {
    const p = parseGcode('%\nn10 g1 x 1.5 y-.5 f1000\nN20 G0 Z+2\n%\n');
    near(ends(p.segments)[0]!, { x: 1.5, y: -0.5, z: 0 });
    near(ends(p.segments)[1]!, { x: 1.5, y: -0.5, z: 2 });
    expect(p.segments[0]!.line).toBe(2);
    expect(p.segments[1]!.line).toBe(3);
    expect(p.problems).toEqual([]);
  });

  it('modo de movimento, F e S persistem entre linhas', () => {
    const p = parseGcode('G1 F800 X10\nY10\nG0 X0\nY0\n');
    expect(motion(p.segments).map((s) => [s.kind, s.feed])).toEqual([
      ['feed', 800],
      ['feed', 800],
      ['rapid', 0],
      ['rapid', 0],
    ]);
  });

  it('conta as linhas e os bytes do arquivo, acentos em UTF-8 inclusive', () => {
    const text = '(furação)\r\nG0 X1\nG0 X2';
    const p = parseGcode(text);
    expect(p.lineCount).toBe(3);
    // 9 caracteres, 2 deles com 2 bytes, e as quebras \r\n e \n.
    expect(p.byteLength).toBe(11 + 2 + 6 + 5);
    expect(p.segments.map((s) => s.byteEnd)).toEqual([19, 24]);
  });

  it('G91 move relativo ao ponto anterior', () => {
    const p = parseGcode('G91 G1 F1000 X10\nX10 Y5\nZ-1\nG90 X0\n');
    expect(ends(p.segments)).toEqual([
      { x: 10, y: 0, z: 0 },
      { x: 20, y: 5, z: 0 },
      { x: 20, y: 5, z: -1 },
      { x: 0, y: 5, z: -1 },
    ]);
  });

  it('G20 converte polegadas para mm, inclusive o avanço', () => {
    const p = parseGcode('G20 G1 X1 Y0.5 F10\nG21 X1\n');
    near(ends(p.segments)[0]!, { x: 25.4, y: 12.7, z: 0 });
    expect(p.segments[0]!.feed).toBeCloseTo(254, 9);
    near(ends(p.segments)[1]!, { x: 1, y: 12.7, z: 0 });
  });

  it('G53 é em coordenadas de máquina; o percurso fica em coordenadas da peça', () => {
    const p = parseGcode('G0 X10\nG53 G0 Z0\nG0 Y5\n', { workOffset: { x: 100, y: 200, z: -50 } });
    expect(ends(p.segments)).toEqual([
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 0, z: 50 },
      { x: 10, y: 5, z: 50 },
    ]);
  });

  it('começa do ponto informado, ou do zero da peça', () => {
    expect(parseGcode('G0 X1').segments[0]!.start).toEqual({ x: 0, y: 0, z: 0 });
    expect(parseGcode('G0 X1', { start: { x: 5, y: 6, z: 7 } }).segments[0]!.start).toEqual({ x: 5, y: 6, z: 7 });
  });

  it('G4 vira uma pausa com a duração em segundos', () => {
    const p = parseGcode('G1 X1 F100\nG4 P1.5\nG1 X2\n');
    expect(p.segments.map((s) => s.kind)).toEqual(['feed', 'dwell', 'feed']);
    expect(p.segments[1]!.dwellS).toBe(1.5);
    expect(p.segments[1]!.start).toEqual(p.segments[1]!.end);
  });

  it('M3, M4, M5 e mudança de S viram eventos do fuso, antes do movimento da linha', () => {
    const p = parseGcode('M3 S12000 G1 X1 F100\nS18000\nM5\nM4 S9000\nM5\n');
    expect(p.segments.map((s) => s.kind)).toEqual(['spindle', 'feed', 'spindle', 'spindle', 'spindle', 'spindle']);
    expect(p.segments.map((s) => [s.spindleDir, s.spindleRpm])).toEqual([
      ['cw', 12000],
      ['cw', 12000],
      ['cw', 18000],
      ['off', 0],
      ['ccw', 9000],
      ['off', 0],
    ]);
    expect(p.spindleSpeeds).toEqual([12000, 18000, 9000]);
  });

  it('S sem fuso ligado não é evento, mas vale quando o fuso liga', () => {
    const p = parseGcode('S10000\nG0 X1\nM3\n');
    expect(p.segments.map((s) => s.kind)).toEqual(['rapid', 'spindle']);
    expect(p.segments[1]!.spindleRpm).toBe(10000);
  });

  it('ferramentas usadas, sem repetir, na ordem em que aparecem', () => {
    expect(parseGcode('T1 M6\nG0 X1\nT3 M6\nT1 M6\n').tools).toEqual([1, 3]);
  });

  it('M2 e M30 encerram o programa: o resto do arquivo não move nada', () => {
    const p = parseGcode('G0 X1\nM30\nG0 X99\n');
    expect(ends(p.segments)).toEqual([{ x: 1, y: 0, z: 0 }]);
  });

  it('G18 e G19 são avisos de algo não suportado', () => {
    const p = parseGcode('G18\nG1 X1 F100\nG19\n');
    expect(p.problems).toHaveLength(2);
    expect(p.problems.every((x) => x.severity === 'warning' && x.code === 'unsupported')).toBe(true);
    expect(p.problems[0]!.message).toContain('G18');
    expect(p.problems[0]!.line).toBe(1);
  });

  it('códigos repetidos viram um só aviso, com a contagem', () => {
    const p = parseGcode('G28\nG28\nG28\n');
    expect(p.problems).toHaveLength(1);
    expect(p.problems[0]!.message).toContain('3 linhas');
  });

  it('M0 avisa que o trabalho pausa e espera a pessoa', () => {
    const p = parseGcode('G0 X1\nM0\n');
    expect(p.problems).toMatchObject([{ severity: 'warning', code: 'pause', line: 2 }]);
  });

  it('o que não é G-code vira aviso com a linha', () => {
    const p = parseGcode('G0 X1\n#1=5\n');
    expect(p.problems).toMatchObject([{ severity: 'warning', code: 'parse', line: 2 }]);
  });

  it('usar dois sistemas de coordenadas é aviso: o percurso supõe o zero atual', () => {
    expect(parseGcode('G54 G0 X1\nG54 X2\n').problems).toEqual([]);
    expect(parseGcode('G54 G0 X1\nG55 X2\n').problems).toMatchObject([{ severity: 'warning', code: 'coordinate-system' }]);
  });
});

describe('parseGcode: o percurso', () => {
  it('um quadrado: quatro segmentos de corte, com início, fim, avanço e linha', () => {
    const p = parseGcode('G0 Z5\nG0 X0 Y0\nG1 Z-1 F300\nG1 X50 F1200\nY50\nX0\nY0\nG0 Z5\n');
    const cut = p.segments.filter((s) => s.kind === 'feed');
    expect(cut).toHaveLength(5);
    expect(cut.slice(1).map((s) => [s.start.x, s.start.y, s.end.x, s.end.y, s.feed, s.line])).toEqual([
      [0, 0, 50, 0, 1200, 4],
      [50, 0, 50, 50, 1200, 5],
      [50, 50, 0, 50, 1200, 6],
      [0, 50, 0, 0, 1200, 7],
    ]);
  });

  it('cada segmento começa onde o anterior terminou', () => {
    const segs = parseGcode(placa).segments;
    for (let i = 1; i < segs.length; i++) expect(segs[i]!.start).toEqual(segs[i - 1]!.end);
  });

  describe('um círculo com G2 (centro por I J)', () => {
    const tol = 0.01;
    const p = parseGcode('G1 F600 X0 Y0\nG2 X0 Y0 I10 J0\n', { arcToleranceMm: tol });
    const arc = p.segments.filter((s) => s.kind === 'arc');

    it('vira muitos segmentos pequenos, todos da linha do arco', () => {
      expect(arc.length).toBeGreaterThan(20);
      expect(arc.every((s) => s.line === 2 && s.feed === 600)).toBe(true);
      expect(arc[0]!.start).toEqual({ x: 0, y: 0, z: 0 });
      near(arc[arc.length - 1]!.end, { x: 0, y: 0, z: 0 }, 9);
    });

    it('todos os vértices ficam sobre o círculo e as cordas a menos da tolerância dele', () => {
      for (const s of arc) {
        expect(Math.hypot(s.end.x - 10, s.end.y)).toBeCloseTo(10, 9);
        const mid = Math.hypot((s.start.x + s.end.x) / 2 - 10, (s.start.y + s.end.y) / 2);
        expect(10 - mid).toBeLessThanOrEqual(tol + 1e-9);
      }
    });

    it('G2 gira no sentido horário: de (0,0) vai para cima', () => {
      expect(arc[0]!.end.y).toBeGreaterThan(0);
    });

    it('o comprimento é o do círculo, a menos da tolerância', () => {
      const len = arc.reduce((acc, s) => acc + Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y), 0);
      expect(len).toBeLessThan(2 * Math.PI * 10);
      expect(len).toBeGreaterThan(2 * Math.PI * 10 - 0.05);
    });

    it('tolerância menor dá mais segmentos', () => {
      const fine = parseGcode('G1 F600 X0 Y0\nG2 X0 Y0 I10 J0\n', { arcToleranceMm: 0.002 });
      expect(fine.segments.filter((s) => s.kind === 'arc').length).toBeGreaterThan(arc.length);
    });
  });

  it('G3 por raio R: meia volta anti-horária de (10,0) a (-10,0)', () => {
    const p = parseGcode('G0 X10 Y0\nG3 X-10 Y0 R10 F500\n');
    const arc = p.segments.filter((s) => s.kind === 'arc');
    near(arc[arc.length - 1]!.end, { x: -10, y: 0, z: 0 }, 9);
    for (const s of arc) {
      expect(Math.hypot(s.end.x, s.end.y)).toBeCloseTo(10, 9);
      expect(s.end.y).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(p.problems).toEqual([]);
  });

  it('arco helicoidal: Z desce junto, por igual', () => {
    const p = parseGcode('G1 F500 X0 Y0 Z0\nG2 X0 Y0 Z-2 I5 J0\n');
    const arc = p.segments.filter((s) => s.kind === 'arc');
    expect(arc[arc.length - 1]!.end.z).toBeCloseTo(-2, 9);
    const dz = arc.map((s) => s.end.z - s.start.z);
    for (const d of dz) expect(d).toBeCloseTo(dz[0]!, 9);
  });

  it('arco com raios de início e fim diferentes: bloqueia, e diz a diferença', () => {
    const p = parseGcode('G0 X0 Y0\nG2 X20.6 Y0 I10 J0 F500\n');
    expect(p.problems).toMatchObject([{ severity: 'block', code: 'arc-radius', line: 2 }]);
    expect(p.problems[0]!.message).toContain('0,6 mm');
  });

  it('diferença de raio dentro da tolerância do FluidNC passa', () => {
    expect(parseGcode('G0 X0 Y0\nG2 X20.004 Y0 I10 J0 F500\n').problems).toEqual([]);
  });

  it('raio R menor que meia distância entre os pontos: bloqueia', () => {
    const p = parseGcode('G0 X0 Y0\nG2 X30 Y0 R10 F500\n');
    expect(p.problems).toMatchObject([{ severity: 'block', code: 'arc-radius', line: 2 }]);
  });
});

describe('analyzeToolpath', () => {
  const p = parseGcode('T2 M6\nM3 S15000\nG0 Z5\nG0 X10 Y10\nG1 Z-3 F300\nG1 X40 F1200\nG1 Y30\nG0 Z5\nM5\n', {
    workOffset: { x: 100, y: 200, z: -60 },
  });
  const a = analyzeToolpath(p);

  it('limites do percurso em coordenadas da peça e da máquina', () => {
    expect(a.bounds.work).toEqual({ min: { x: 10, y: 10, z: -3 }, max: { x: 40, y: 30, z: 5 } });
    expect(a.bounds.machine).toEqual({ min: { x: 110, y: 210, z: -63 }, max: { x: 140, y: 230, z: -55 } });
  });

  it('profundidade máxima do corte', () => {
    expect(a.maxDepthMm).toBe(3);
  });

  it('distância cortando e em rápido', () => {
    expect(a.cuttingDistanceMm).toBeCloseTo(8 + 30 + 20, 9);
    expect(a.rapidDistanceMm).toBeCloseTo(5 + Math.hypot(10, 10) + 8, 9);
  });

  it('ferramentas, rotações e linhas do arquivo', () => {
    expect(a.tools).toEqual([2]);
    expect(a.spindleSpeeds).toEqual([15000]);
    expect(a.lineCount).toBe(9);
  });

  it('a posição suposta antes do arquivo definir um eixo não entra nos limites', () => {
    // G0 Z5 primeiro: X e Y ainda são os da máquina, não o zero da peça.
    const q = analyzeToolpath(parseGcode('G0 Z5\nG0 X10 Y20\nG1 X30 F500\n'));
    expect(q.bounds.work).toEqual({ min: { x: 10, y: 20, z: 5 }, max: { x: 30, y: 20, z: 5 } });
  });

  it('com o ponto de partida informado, ele vale desde o início', () => {
    const q = analyzeToolpath(parseGcode('G0 Z5\nG0 X10 Y20\n', { start: { x: 0, y: 0, z: 0 } }));
    expect(q.bounds.work).toEqual({ min: { x: 0, y: 0, z: 5 }, max: { x: 10, y: 20, z: 5 } });
  });

  it('arquivo sem movimento não tem limites', () => {
    const e = analyzeToolpath(parseGcode('(nada)\n'));
    expect(e.bounds.work).toBeNull();
    expect(e.bounds.machine).toBeNull();
    expect(e.maxDepthMm).toBe(0);
  });
});

describe('checkToolpath: o trabalho contra a máquina', () => {
  // Máquina de referência: X 0..1215, Y 0..604, Z -158..0 (coordenadas de máquina).
  const offset = { x: 100, y: 100, z: -50 };

  it('um trabalho dentro do curso não tem problemas', () => {
    const p = parseGcode('G0 Z5\nG0 X10 Y10\nG1 Z-2 F300\nG1 X60 F1000\nG0 Z5\n', { workOffset: offset });
    expect(checkToolpath(p, limits)).toEqual([]);
  });

  it('fora do curso: bloqueia, por eixo, dizendo quanto passa', () => {
    const p = parseGcode('G0 X-150 Y10\nG1 Y600 F1000\nG0 Z60\n', { workOffset: offset });
    const problems = checkToolpath(p, limits);
    expect(problems.map((x) => [x.severity, x.code, x.axis, x.overMm])).toEqual([
      ['block', 'out-of-travel', 'x', 50],
      ['block', 'out-of-travel', 'y', 96],
      ['block', 'out-of-travel', 'z', 10],
    ]);
    expect(problems[1]!.message).toBe('O percurso passa 96,0 mm do curso do Y.');
  });

  it('eixo sem curso conhecido: aviso de que não foi verificado', () => {
    const p = parseGcode('G0 X1\n');
    const problems = checkToolpath(p, { x: limits.x!, y: limits.y! });
    expect(problems).toMatchObject([{ severity: 'warning', code: 'unknown-travel', axis: 'z' }]);
  });

  it('mais fundo que a proteção da mesa: bloqueia', () => {
    const p = parseGcode('G0 X10 Y10\nG1 Z-20 F300\n', { workOffset: offset });
    expect(checkToolpath(p, limits, { maxDepthMm: 25 })).toEqual([]);
    const problems = checkToolpath(p, limits, { maxDepthMm: 18 });
    expect(problems).toMatchObject([{ severity: 'block', code: 'too-deep' }]);
    expect(problems[0]!.message).toContain('20,0 mm');
    expect(problems[0]!.message).toContain('18,0 mm');
  });

  it('corte sem avanço: bloqueia, uma vez só, com a primeira linha', () => {
    const p = parseGcode('G0 X1\nG1 X2\nG1 X3\nG1 X4 F0\n', { workOffset: offset });
    const problems = checkToolpath(p, limits);
    expect(problems).toMatchObject([{ severity: 'block', code: 'no-feed', line: 2 }]);
    expect(problems[0]!.message).toContain('3 movimentos');
  });

  it('inclui os problemas encontrados na leitura', () => {
    const p = parseGcode('G0 X0 Y0\nG2 X20.6 Y0 I10 J0 F500\nM0\n', { workOffset: offset });
    expect(checkToolpath(p, limits).map((x) => x.code)).toEqual(['arc-radius', 'pause']);
  });

  it('bloqueios vêm antes dos avisos', () => {
    const p = parseGcode('M0\nG0 X-150\n', { workOffset: offset });
    expect(checkToolpath(p, limits).map((x) => x.severity)).toEqual(['block', 'warning']);
  });
});

describe('estimateTime: perfil trapezoidal com a aceleração da máquina', () => {
  // X e Y: 3000 mm/min (50 mm/s) e 250 mm/s². Z: 4000 mm/min e 200 mm/s².
  const t = (g: string, p: MachineProfile = bare) => estimateTime(parseGcode(g), p).totalS;

  it('100 mm a 3000 mm/min com 250 mm/s²: 0,2 s acelerando, 1,8 s em cruzeiro, 0,2 s freando', () => {
    expect(t('G1 X100 F3000')).toBeCloseTo(2.2, 9);
  });

  it('movimento curto não chega ao avanço: triângulo, 2·√(L/a)', () => {
    expect(t('G1 X4 F3000')).toBeCloseTo(2 * Math.sqrt(4 / 250), 9);
  });

  it('o avanço pedido acima do máximo do eixo fica no máximo do eixo', () => {
    expect(t('G1 X100 F6000')).toBeCloseTo(2.2, 9);
  });

  it('avanço abaixo do máximo: L/v + v/a', () => {
    expect(t('G1 X100 F600')).toBeCloseTo(100 / 10 + 10 / 250, 9);
  });

  it('rápido em diagonal: cada eixo no seu máximo, escalados pela direção', () => {
    // Velocidade √2·50 e aceleração √2·250 ao longo de √2·100 mm: o mesmo 2,2 s.
    expect(t('G0 X100 Y100')).toBeCloseTo(2.2, 9);
  });

  it('rápido em Z usa o máximo e a aceleração do Z', () => {
    expect(t('G0 Z-10')).toBeCloseTo(2 * Math.sqrt(10 / 200), 9);
    expect(t('G0 Z-100')).toBeCloseTo(100 / (4000 / 60) + 4000 / 60 / 200, 9);
  });

  it('dois segmentos em linha reta não param no meio', () => {
    expect(t('G1 X50 F3000\nX100')).toBeCloseTo(2.2, 9);
  });

  it('meia-volta para no meio: o dobro do tempo', () => {
    expect(t('G1 X100 F3000\nX0')).toBeCloseTo(4.4, 9);
  });

  it('canto de 90°: a velocidade na quina vem do desvio de junção', () => {
    // FluidNC/grbl: v² = a·δ·sen(θ/2)/(1 − sen(θ/2)), com a na direção da quina.
    const a = 250 * Math.SQRT2;
    const s = Math.SQRT1_2;
    const vj = Math.sqrt((a * 0.01 * s) / (1 - s));
    const v = 50;
    const A = 250;
    const leg = (v0: number, v1: number) => {
      const da = (v * v - v0 * v0) / (2 * A);
      const dd = (v * v - v1 * v1) / (2 * A);
      return (v - v0) / A + (v - v1) / A + (100 - da - dd) / v;
    };
    expect(t('G1 X100 F3000\nY100')).toBeCloseTo(leg(0, vj) + leg(vj, 0), 9);
    // Com desvio de junção maior, a quina é mais rápida.
    const loose = estimateTime(parseGcode('G1 X100 F3000\nY100'), bare, { junctionDeviationMm: 0.1 }).totalS;
    expect(loose).toBeLessThan(t('G1 X100 F3000\nY100'));
  });

  it('o planejador olha à frente: freia antes de uma reversão distante', () => {
    // Muitos segmentos curtos em linha reta e depois a volta: a soma tem de bater
    // com o movimento único de ida e o de volta.
    const fwd = Array.from({ length: 50 }, (_, i) => `X${(i + 1) * 2}`).join('\n');
    expect(t(`G1 F3000\n${fwd}\nX0`)).toBeCloseTo(4.4, 9);
  });

  it('pausa G4 soma a sua duração e para a máquina', () => {
    expect(t('G1 X50 F3000\nG4 P1.5\nG1 X100')).toBeCloseTo(2 * (0.2 + 0.2 + 40 / 50) + 1.5, 9);
  });

  it('o fuso soma o tempo de aceleração e de parada da placa', () => {
    // Máquina de referência: spinup 5 s, spindown 10 s.
    expect(t('M3 S18000\nG1 X100 F3000\nM5', profile)).toBeCloseTo(5 + 2.2 + 10, 9);
  });

  it('tempo acumulado por segmento, crescente, terminando no total', () => {
    const est = estimateTime(parseGcode(placa), profile);
    const segs = parseGcode(placa).segments;
    expect(est.cumulativeS).toHaveLength(segs.length);
    for (let i = 1; i < est.cumulativeS.length; i++) {
      expect(est.cumulativeS[i]!).toBeGreaterThanOrEqual(est.cumulativeS[i - 1]!);
    }
    expect(est.cumulativeS[est.cumulativeS.length - 1]).toBeCloseTo(est.totalS, 9);
    expect(est.totalS).toBeGreaterThan(0);
  });

  it('o círculo leva mais que o comprimento dividido pelo avanço, mas não muito mais', () => {
    const est = t('G1 F600 X0 Y0\nG2 X0 Y0 I10 J0');
    const ideal = (2 * Math.PI * 10) / 10;
    expect(est).toBeGreaterThan(ideal);
    expect(est).toBeLessThan(ideal + 0.5);
  });
});

describe('progressAt: a porcentagem do SD vira tempo restante', () => {
  const p = parseGcode(placa);
  const est = estimateTime(p, profile);

  it('no começo, falta o trabalho inteiro', () => {
    const r = progressAt(p, est, 0);
    expect(r.elapsedS).toBe(0);
    expect(r.remainingS).toBeCloseTo(est.totalS, 9);
    expect(r.segmentIndex).toBe(0);
  });

  it('no fim do arquivo, não falta nada', () => {
    const r = progressAt(p, est, p.byteLength);
    expect(r.remainingS).toBeCloseTo(0, 9);
    expect(r.elapsedS).toBeCloseTo(est.totalS, 9);
    expect(r.segmentIndex).toBe(p.segments.length);
    expect(r.segment).toBeNull();
  });

  it('o tempo restante só diminui conforme o arquivo avança', () => {
    let last = Infinity;
    for (let pct = 0; pct <= 100; pct += 0.5) {
      const r = progressAt(p, est, bytePosOfPercent(pct, p.byteLength));
      expect(r.remainingS).toBeLessThanOrEqual(last + 1e-9);
      expect(r.elapsedS + r.remainingS).toBeCloseTo(est.totalS, 9);
      last = r.remainingS;
    }
  });

  it('a posição aponta o segmento da linha que a placa está lendo', () => {
    const p2 = parseGcode('G0 X1\nG0 X2\nG0 X3\n');
    const e2 = estimateTime(p2, bare);
    // Bytes 0..5 são a linha 1; ao terminar de lê-la, a máquina está na linha 2.
    expect(progressAt(p2, e2, 3).segment!.line).toBe(1);
    const r = progressAt(p2, e2, 6);
    expect(r.segment!.line).toBe(2);
    expect(r.elapsedS).toBeCloseTo(e2.cumulativeS[0]!, 9);
  });

  it('porcentagem do SD para bytes, recortada entre 0 e o tamanho', () => {
    expect(bytePosOfPercent(50, 1000)).toBe(500);
    expect(bytePosOfPercent(-3, 1000)).toBe(0);
    expect(bytePosOfPercent(120, 1000)).toBe(1000);
  });
});
