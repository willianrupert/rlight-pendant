import { describe, expect, it } from 'vitest';
import { GhostModel, destinationText, formatEta, plannedSeconds, rubber, zLook } from './map-view';

const limits = { x: { min: 0, max: 1215 }, y: { min: 0, max: 604 } };

describe('o fantasma', () => {
  it('só se pega perto do ponto real: um toque longe não move nada', () => {
    const g = new GhostModel(limits);
    expect(g.down({ x: 600, y: 300 }, { x: 100, y: 100 }, 30)).toBe(false);
    expect(g.up()).toBeNull();
  });

  it('arrastar e soltar dá um destino; a máquina não recebe nada no caminho', () => {
    const g = new GhostModel(limits);
    expect(g.down({ x: 105, y: 102 }, { x: 100, y: 100 }, 30)).toBe(true);
    g.move({ x: 415, y: 222 });
    expect(g.destination).toEqual({ x: 410, y: 220 });
    expect(g.up()).toEqual({ x: 410, y: 220 });
    expect(g.ghost).toBeNull();
  });

  it('para na borda com elástico, e o destino fica dentro da mesa', () => {
    const g = new GhostModel(limits);
    g.down({ x: 1200, y: 300 }, { x: 1200, y: 300 }, 30);
    g.move({ x: 1400, y: 300 });
    expect(g.ghost!.x).toBeGreaterThan(1215);
    expect(g.ghost!.x).toBeLessThan(1400);
    expect(g.up()).toEqual({ x: 1215, y: 300 });
  });

  it('um movimento minúsculo é só um toque', () => {
    const g = new GhostModel(limits);
    g.down({ x: 100, y: 100 }, { x: 100, y: 100 }, 30);
    g.move({ x: 100.4, y: 100.2 });
    expect(g.up()).toBeNull();
  });
});

describe('tocar na mesa: prévia e "Ir"', () => {
  const real = { x: 100, y: 100 };

  it('um toque põe o fantasma lá, sem mandar nada; "Ir" devolve o destino uma vez', () => {
    const g = new GhostModel(limits);
    expect(g.tap({ x: 600, y: 300 }, real)).toEqual({ x: 600, y: 300 });
    expect(g.preview).toEqual({ x: 600, y: 300 });
    expect(g.go()).toEqual({ x: 600, y: 300 });
    expect(g.go()).toBeNull();
  });

  it('um toque fora da mesa vira um ponto na borda', () => {
    const g = new GhostModel(limits);
    expect(g.tap({ x: 1300, y: -20 }, real)).toEqual({ x: 1215, y: 0 });
  });

  it('com prévia, outro toque cancela', () => {
    const g = new GhostModel(limits);
    g.tap({ x: 600, y: 300 }, real);
    expect(g.tap({ x: 50, y: 50 }, real)).toBeNull();
    expect(g.preview).toBeNull();
    expect(g.go()).toBeNull();
  });

  it('tocar no próprio ponto não é destino', () => {
    const g = new GhostModel(limits);
    expect(g.tap({ x: 100.3, y: 100 }, real)).toBeNull();
  });

  it('arrastar o ponto desfaz a prévia', () => {
    const g = new GhostModel(limits);
    g.tap({ x: 600, y: 300 }, real);
    g.down({ x: 100, y: 100 }, real, 30);
    expect(g.preview).toBeNull();
  });
});

describe('o alvo fica no mapa até a máquina chegar', () => {
  const at = (x: number, y: number) => ({ x, y });

  it('depois do "Ir", o alvo fica enquanto a máquina anda', () => {
    const m = new GhostModel(limits);
    m.setTarget(at(600, 300), 0);
    expect(m.track(at(100, 100), 'Idle', 50)).toBeNull(); // o jog ainda não começou
    expect(m.target).toEqual(at(600, 300));
    expect(m.track(at(300, 200), 'Jog', 500)).toBeNull();
    expect(m.target).toEqual(at(600, 300));
  });

  it('a máquina chega e para: o alvo sai, com o aviso para esmaecer', () => {
    const m = new GhostModel(limits);
    m.setTarget(at(600, 300), 0);
    m.track(at(300, 200), 'Jog', 500);
    expect(m.track(at(600, 300), 'Idle', 3_000)).toBe('arrived');
    expect(m.target).toBeNull();
  });

  it('parou antes (Parar, alarme): o alvo some na hora, nunca mostra um destino abandonado', () => {
    const m = new GhostModel(limits);
    m.setTarget(at(600, 300), 0);
    m.track(at(300, 200), 'Jog', 500);
    expect(m.track(at(350, 220), 'Idle', 900)).toBe('stopped');
    expect(m.target).toBeNull();
    m.setTarget(at(600, 300), 1_000);
    m.track(at(300, 200), 'Jog', 1_200);
    expect(m.track(at(310, 205), 'Alarm', 1_300)).toBe('stopped');
  });

  it('o jog nunca começou (recusado): depois de um tempo sem andar, some', () => {
    const m = new GhostModel(limits);
    m.setTarget(at(600, 300), 0);
    expect(m.track(at(100, 100), 'Idle', 1_000)).toBeNull();
    expect(m.track(at(100, 100), 'Idle', 2_000)).toBe('stopped');
  });

  it('um alvo novo substitui o anterior', () => {
    const m = new GhostModel(limits);
    m.setTarget(at(600, 300), 0);
    m.setTarget(at(200, 100), 10);
    expect(m.target).toEqual(at(200, 100));
  });
});

describe('elástico', () => {
  it('dentro é identidade, fora encolhe', () => {
    expect(rubber(50, 0, 100, 10)).toBe(50);
    expect(rubber(130, 0, 100, 10)).toBeLessThan(110);
    expect(rubber(-30, 0, 100, 10)).toBeGreaterThan(-10);
  });
});

it('destino nas coordenadas do DRO', () => {
  expect(destinationText({ x: 410, y: 220 }, { x: 10, y: 20 })).toBe('X 400,00 · Y 200,00');
});

describe('o Z visto de cima', () => {
  const z = { min: -158, max: 0 };

  it('no topo o ponto é maior e macio; no fundo, menor e nítido', () => {
    const top = zLook(0, z, null);
    const bottom = zLook(-158, z, null);
    expect(top.depth).toBe(0);
    expect(bottom.depth).toBe(1);
    expect(top.scale).toBeGreaterThan(bottom.scale);
    expect(top.softness).toBeGreaterThan(bottom.softness);
  });

  it('o anel aparece só na superfície da peça', () => {
    expect(zLook(-40.03, z, -40).atZero).toBe(true);
    expect(zLook(-39.5, z, -40).atZero).toBe(false);
    expect(zLook(-40, z, null).atZero).toBe(false);
  });

  it('o zero da peça na régua vertical, se cabe no curso', () => {
    expect(zLook(-10, z, -79).zeroDepth).toBeCloseTo(0.5, 6);
    expect(zLook(-10, z, 5).zeroDepth).toBeNull();
  });
});

describe('quanto falta, no mapa', () => {
  it('perto: com décimo; longe: segundos inteiros; mais de um minuto: min e s', () => {
    expect(formatEta(3.24)).toBe('3,2 s');
    expect(formatEta(12.4)).toBe('12 s');
    expect(formatEta(65)).toBe('1 min 05 s');
  });

  it('chegando: nada (o número some em vez de mostrar 0,0 s)', () => {
    expect(formatEta(0.04)).toBe('');
  });

  it('o destino com a estimativa', () => {
    expect(destinationText({ x: 371.3, y: 217.86 }, { x: 0, y: 0 }, 4.1)).toBe('X 371,30 · Y 217,86 · 4,1 s');
  });
});

describe('o tempo de um Ir com a subida, e da volta a um ponto', () => {
  const xy = { maxMmPerMin: 3000, accelMmPerS2: 250 };
  const z = { maxMmPerMin: 4000, accelMmPerS2: 200 };

  it('sem subir: só X e Y', () => {
    const t = plannedSeconds({ from: { x: 0, y: 0, z: 0 }, to: { x: 600, y: 0 }, lift: null, descent: null, xy, z });
    expect(t).toBeCloseTo(12.2, 3);
  });

  it('com a subida: o Z sobe primeiro e soma', () => {
    const plain = plannedSeconds({ from: { x: 0, y: 0, z: -68 }, to: { x: 600, y: 0 }, lift: null, descent: null, xy, z });
    const lifted = plannedSeconds({ from: { x: 0, y: 0, z: -68 }, to: { x: 600, y: 0 }, lift: -60, descent: null, xy, z });
    expect(lifted).toBeGreaterThan(plain);
  });

  it('a volta a um ponto inclui a descida, com os últimos 20 mm devagar', () => {
    const t = plannedSeconds({ from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0 }, lift: null, descent: { from: 0, fastTo: -48, slowTo: -68 }, xy, z });
    expect(t).toBeGreaterThan(2); // 20 mm a 600 mm/min já são 2 s
  });
});

describe('a chegada de um ponto salvo espera a descida', () => {
  it('com Z no alvo, só chega quando o Z também chegou', () => {
    const m = new GhostModel(limits);
    m.setTarget({ x: 50, y: 60 }, 0, -68);
    m.track({ x: 40, y: 60, z: 0 }, 'Jog', 100);
    expect(m.track({ x: 50, y: 60, z: -30 }, 'Jog', 200)).toBeNull(); // ainda descendo
    expect(m.track({ x: 50, y: 60, z: -68 }, 'Idle', 300)).toBe('arrived');
  });
});
