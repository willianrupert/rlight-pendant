import { describe, expect, it } from 'vitest';
import { blockedBy, formatBytes, formatJobTime, holePoints, jobFacts, previewFrame, problemText, svgPoints, type JobDetail } from './jobs';

// Os trabalhos na tela: a biblioteca, os fatos do trabalho e onde desenhar a prévia.

const detail = (over: Partial<JobDetail> = {}): JobDetail => ({
  id: 'abc',
  name: 'tampa.nc',
  workOffset: { x: 100, y: 200, z: -50 },
  homed: true,
  bounds: {
    work: { min: { x: 0, y: 0, z: -3 }, max: { x: 40, y: 12.5, z: 5 } },
    machine: { min: { x: 100, y: 200, z: -53 }, max: { x: 140, y: 212.5, z: -45 } },
  },
  maxDepthMm: 3,
  cuttingDistanceMm: 200,
  estimatedS: 95,
  tools: [1, 2],
  spindleSpeeds: [18000],
  lineCount: 10,
  problems: [],
  preview: { cuts: [[0, 0, 40, 0]], rapids: [], holes: [] },
  ...over,
});

describe('formatos', () => {
  it('tamanho do arquivo como o app Arquivos', () => {
    expect(formatBytes(512)).toBe('512 bytes');
    expect(formatBytes(48_300)).toBe('48 KB');
    expect(formatBytes(1_250_000)).toBe('1,3 MB');
  });

  it('tempo do corte, arredondado', () => {
    expect(formatJobTime(20)).toBe('menos de 1 min');
    expect(formatJobTime(95)).toBe('2 min');
    expect(formatJobTime(3_700)).toBe('1 h 02 min');
  });
});

describe('jobFacts', () => {
  it('tamanho, profundidade, tempo, ferramentas e rotação', () => {
    expect(jobFacts(detail())).toEqual({ size: '40 × 12,5 mm', depth: '3 mm', time: '≈ 2 min', tools: 'T1 · T2', rpm: '18.000 rpm' });
  });

  it('sem ferramenta nem rotação no arquivo: não inventa', () => {
    const f = jobFacts(detail({ tools: [], spindleSpeeds: [], maxDepthMm: 0 }));
    expect(f.tools).toBeNull();
    expect(f.rpm).toBeNull();
    expect(f.depth).toBe('Não desce');
  });
});

describe('blockedBy', () => {
  it('o primeiro bloqueio, ou nada', () => {
    expect(blockedBy(detail())).toBeNull();
    const d = detail({
      problems: [
        { severity: 'warning', code: 'unsupported', message: 'G28…', line: 3 },
        { severity: 'block', code: 'out-of-travel', message: 'O percurso passa 5 mm do curso do X.', line: null },
      ],
    });
    expect(blockedBy(d)).toBe('O percurso passa 5 mm do curso do X.');
  });
});

describe('previewFrame', () => {
  const limits = { x: { min: 0, max: 1215 }, y: { min: 0, max: 800 } };

  it('com homing e zero: o trabalho no lugar dele, com uma margem de mesa, sem passar da mesa', () => {
    // Trabalho de 40 × 12,5 em X 100–140, Y 200–212,5: margem de 40 mm.
    expect(previewFrame(detail(), limits)).toEqual({ minX: 60, minY: 160, width: 120, height: 92.5, offset: { x: 100, y: 200 }, onTable: true });
    const corner = detail({ bounds: { work: detail().bounds.work, machine: { min: { x: 0, y: 0, z: 0 }, max: { x: 40, y: 12.5, z: 0 } } } });
    expect(previewFrame(corner, limits)).toMatchObject({ minX: 0, minY: 0 });
  });

  it('a máquina perto entra no quadro; longe, não', () => {
    expect(previewFrame(detail(), limits, { x: 170, y: 206 })).toMatchObject({ minX: 60, width: 150 });
    expect(previewFrame(detail(), limits, { x: 900, y: 600 })).toMatchObject({ minX: 60, width: 120 });
  });

  it('sem homing: só o trabalho, com margem', () => {
    const f = previewFrame(detail({ homed: false, bounds: { work: detail().bounds.work, machine: null } }), limits);
    expect(f?.onTable).toBe(false);
    expect(f?.offset).toEqual({ x: 0, y: 0 });
    expect(f!.minX).toBeLessThan(0);
    expect(f!.width).toBeGreaterThan(40);
  });

  it('nada a desenhar', () => {
    expect(previewFrame(detail({ bounds: { work: null, machine: null } }), limits)).toBeNull();
  });
});

describe('svgPoints', () => {
  it('desloca e inverte o Y (no SVG, Y cresce para baixo)', () => {
    expect(svgPoints([0, 0, 40, 12.5], { x: 100, y: 200 })).toBe('100,-200 140,-212.5');
  });
});

describe('holePoints e problemText', () => {
  it('furos deslocados e com Y invertido', () => {
    expect(holePoints([10, 5, 20, 5], { x: 100, y: 0 })).toEqual([{ x: 110, y: -5 }, { x: 120, y: -5 }]);
  });

  it('a linha do aviso aparece uma vez', () => {
    expect(problemText({ severity: 'warning', code: 'unsupported', message: 'G28 aparece na linha 47.', line: 47 })).toBe('G28 aparece na linha 47.');
    expect(problemText({ severity: 'warning', code: 'no-feed', message: 'Corte sem F.', line: 3 })).toBe('Corte sem F. (linha 3)');
  });
});
