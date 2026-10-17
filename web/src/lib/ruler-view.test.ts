import { describe, expect, it } from 'vitest';
import type { CommandRequest } from './connection';
import { PX_PER_TICK, RulerModel } from './ruler-view';

function setup(step = 0.1) {
  const sent: CommandRequest[] = [];
  const clicks: string[] = [];
  const m = new RulerModel('x', step, { send: (r) => sent.push(r), click: (k) => clicks.push(k) });
  m.limits = { min: 0, max: 1215 };
  m.sync(412.3, 0);
  m.reported = 412.3;
  return { m, sent, clicks };
}

/** Arrasta devagar `ticks` traços (para a esquerda avança), um traço a cada 30 ms. */
function slowDrag(m: RulerModel, ticks: number, t0 = 0): number {
  let t = t0;
  let x = 200;
  m.down(x, t);
  m.frame(t);
  for (let k = 0; k < Math.abs(ticks); k++) {
    t += 30;
    x -= Math.sign(ticks) * PX_PER_TICK;
    m.move(x, t);
    m.frame(t);
  }
  // Para o dedo antes de soltar: sem velocidade, assenta.
  t += 200;
  m.move(x, t);
  m.frame(t);
  m.up(t);
  return t;
}

describe('arrastar = nudges em lotes', () => {
  it('cada lote leva traços × passo e soma o que foi arrastado', () => {
    const { m, sent } = setup();
    slowDrag(m, 6);
    const nudges = sent.filter((s) => s.command === 'nudge') as { delta: number }[];
    expect(nudges.length).toBeGreaterThan(1);
    expect(nudges.length).toBeLessThan(6);
    expect(nudges.reduce((a, n) => a + n.delta, 0)).toBeCloseTo(0.6, 6);
    expect(sent.some((s) => s.command === 'jogAxisTo')).toBe(false);
  });

  it('clica a cada traço no arrasto', () => {
    const { m, clicks } = setup();
    slowDrag(m, 4);
    expect(clicks.length).toBe(4);
  });

  it('não passa de 2 mm à frente da máquina: a régua pesa', () => {
    const { m, sent } = setup(1);
    slowDrag(m, 5);
    const total = sent.filter((s) => s.command === 'nudge').reduce((a, n) => a + (n as { delta: number }).delta, 0);
    expect(total).toBe(2);
    expect(m.target).toBe(2); // solto no elástico, volta até os 2 mm
  });

  it('não passa do curso', () => {
    const { m, sent } = setup(1);
    m.sync(1214, 0);
    m.reported = 1214;
    slowDrag(m, 2);
    const total = sent.filter((s) => s.command === 'nudge').reduce((a, n) => a + (n as { delta: number }).delta, 0);
    expect(total).toBe(1);
  });
});

describe('soltar com inércia = um único jogAxisTo para o destino anunciado', () => {
  function flick(m: RulerModel) {
    m.down(300, 0);
    for (let k = 1; k <= 5; k++) m.move(300 - k * 30, k * 10); // 3 px/ms para a esquerda
    m.up(50);
  }

  it('anuncia o destino e manda só ele', () => {
    const { m, sent } = setup();
    flick(m);
    expect(m.mode).toBe('glide');
    const dest = m.destination!;
    expect(dest).toBeGreaterThan(412.3);
    const jogs = sent.filter((s) => s.command === 'jogAxisTo');
    expect(jogs).toEqual([{ command: 'jogAxisTo', axis: 'x', value: dest }]);
  });

  it('o deslize termina exatamente no anunciado', () => {
    const { m } = setup();
    flick(m);
    const dest = m.destination!;
    for (let t = 50; t < 5_000; t += 16) m.frame(t);
    expect(m.mode).toBe('rest');
    expect(m.value).toBe(dest);
  });

  it('tocar durante o deslize segura: cancela e manda o novo destino', () => {
    const { m, sent } = setup();
    flick(m);
    m.frame(60);
    m.frame(150);
    const here = Math.round(m.pos);
    sent.length = 0;
    m.down(100, 160);
    expect(sent[0]).toEqual({ command: 'cancelJog' });
    expect(sent[1]).toMatchObject({ command: 'jogAxisTo', axis: 'x' });
    expect((sent[1] as { value: number }).value).toBeCloseTo(412.3 + here * 0.1, 6);
    expect(m.mode).toBe('drag');
  });

  it('sem homing não há deslize: assenta e manda nudges', () => {
    const { m, sent } = setup();
    m.canGlide = false;
    flick(m);
    expect(m.mode).toBe('settle');
    expect(sent.some((s) => s.command === 'jogAxisTo')).toBe(false);
  });
});

describe('a régua parada segue a máquina, sem pular de volta', () => {
  it('espera o servidor confirmar o alvo enviado', () => {
    const { m } = setup();
    const t = slowDrag(m, 3);
    for (let k = 0; k < 20; k++) m.frame(t + k * 16);
    expect(m.value).toBeCloseTo(412.6, 6);
    m.sync(412.3, t + 400); // o estado ainda é o antigo
    expect(m.value).toBeCloseTo(412.6, 6);
    m.sync(412.6, t + 500);
    m.sync(500, t + 600); // outra coisa moveu a máquina
    expect(m.value).toBe(500);
  });
});

describe('o elástico dos 2 mm', () => {
  it('conforme a máquina alcança, o que estava no elástico vai sendo mandado', () => {
    const { m, sent } = setup(1);
    let t = 0;
    let x = 200;
    m.down(x, t);
    for (let k = 0; k < 4; k++) {
      t += 30;
      x -= 2 * PX_PER_TICK;
      m.move(x, t);
      m.frame(t);
    }
    const before = sent.filter((s) => s.command === 'nudge').reduce((a, n) => a + (n as { delta: number }).delta, 0);
    expect(before).toBe(2);
    m.reported = 414.3; // a máquina chegou aos 2 mm
    t += 60;
    m.frame(t);
    t += 60;
    m.frame(t);
    const after = sent.filter((s) => s.command === 'nudge').reduce((a, n) => a + (n as { delta: number }).delta, 0);
    expect(after).toBeGreaterThan(2);
    expect(after).toBeLessThanOrEqual(4);
  });
});

describe('a barreira no Z0 da peça', () => {
  function zSetup() {
    const sent: CommandRequest[] = [];
    const clicks: string[] = [];
    const m = new RulerModel('z', 0.1, { send: (r) => sent.push(r), click: (k) => clicks.push(k) });
    m.limits = { min: -150, max: 0 };
    m.sync(-1, 0);
    m.reported = -1;
    m.barrier = -1.5; // o zero da peça, em coordenada de máquina
    const total = () => sent.filter((s) => s.command === 'nudge').reduce((a, n) => a + (n as { delta: number }).delta, 0);
    return { m, sent, clicks, total };
  }

  it('um gesto que começou acima para na superfície, com a batida da parede', () => {
    const { m, clicks, total } = zSetup();
    slowDrag(m, -10);
    expect(total()).toBeCloseTo(-0.5, 6);
    expect(clicks.filter((c) => c === 'wall')).toHaveLength(1);
  });

  it('um gesto novo, já na superfície, passa de propósito', () => {
    const { m, total } = zSetup();
    const t = slowDrag(m, -10);
    for (let k = 0; k < 20; k++) m.frame(t + k * 16);
    m.reported = -1.5;
    m.sync(-1.5, t + 400);
    slowDrag(m, -5, t + 500);
    expect(total()).toBeCloseTo(-1, 6);
  });

  it('um peteleco para baixo também para na superfície', () => {
    const { m, sent } = zSetup();
    m.down(100, 0);
    for (let k = 1; k <= 5; k++) m.move(100 + k * 30, k * 10);
    m.up(50);
    const jog = sent.find((s) => s.command === 'jogAxisTo') as { value: number } | undefined;
    if (jog) expect(jog.value).toBeGreaterThanOrEqual(-1.5);
    expect(m.target! * 0.1 + m.base).toBeGreaterThanOrEqual(-1.5 - 1e-9);
  });

  it('subir nunca é barrado', () => {
    const { m, total } = zSetup();
    m.sync(-1.5, 0);
    slowDrag(m, 5);
    expect(total()).toBeCloseTo(0.5, 6);
  });
});
