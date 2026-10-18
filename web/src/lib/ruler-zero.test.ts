import { describe, expect, it } from 'vitest';
import type { CommandRequest } from './connection';
import { PX_PER_TICK, RulerModel } from './ruler-view';

function drag(m: RulerModel, ticks: number, t0: number, px = PX_PER_TICK): number {
  let t = t0;
  let x = 200;
  m.down(x, t);
  m.frame(t);
  for (let k = 0; k < Math.abs(ticks); k++) {
    t += 30;
    x -= Math.sign(ticks) * px;
    m.move(x, t);
    m.frame(t);
  }
  t += 200;
  m.move(x, t);
  m.frame(t);
  m.up(t);
  for (let k = 0; k < 30; k++) m.frame((t += 16));
  return t;
}

describe('voltar ao zero em passos de 1 mm', () => {
  it('sai do 0, vai para a direita e volta: chega ao 0,0', () => {
    const sent: CommandRequest[] = [];
    const m = new RulerModel('x', 1, { send: (r) => sent.push(r), click: () => {} });
    m.limits = { min: 0, max: 1215 };
    m.sync(0, 0);
    m.reported = 0;
    let t = drag(m, 3, 0);
    m.reported = 3;
    m.sync(3, t + 3000);
    t = drag(m, -3, t + 3100);
    const last = sent.filter((s) => s.command === 'nudge').pop() as { to: number };
    console.log(JSON.stringify(sent));
    expect(last.to).toBe(0);
  });
});

describe('variantes, num gesto só', () => {
  function run(ticksRight: number, ticksBack: number, opts: { lift?: boolean; reportedLag?: boolean } = {}) {
    const sent: CommandRequest[] = [];
    const m = new RulerModel('x', 1, { send: (r) => sent.push(r), click: () => {} });
    m.limits = { min: 0, max: 1215 };
    m.spacing = 42;
    m.sync(0, 0);
    m.reported = 0;
    let t = 0;
    let x = 200;
    m.down(x, t);
    m.frame(t);
    const stepTo = (nx: number) => {
      const n = Math.ceil(Math.abs(nx - x) / 6);
      const x0 = x;
      for (let i = 1; i <= n; i++) {
        t += 16;
        x = x0 + ((nx - x0) * i) / n;
        m.move(x, t);
        m.frame(t);
        if (!opts.reportedLag) m.reported = Math.max(0, Math.min(1215, m.value));
      }
    };
    stepTo(200 - ticksRight * 42);
    for (let k = 0; k < 10; k++) m.frame((t += 16));
    stepTo(200 - ticksRight * 42 + ticksBack * 42);
    for (let k = 0; k < 10; k++) m.frame((t += 16));
    m.up((t += 16));
    for (let k = 0; k < 40; k++) m.frame((t += 16));
    const tos = sent.filter((s) => s.command === 'nudge').map((s) => (s as { to: number }).to);
    return { tos, last: tos[tos.length - 1], value: m.value };
  }

  it.each([
    [1, 1],
    [3, 3],
    [3, 3.3],
    [5, 5],
  ])('direita %s, volta %s: termina no 0', (r, b) => {
    const out = run(r, b);
    console.log(r, b, JSON.stringify(out));
    expect(out.last).toBe(0);
  });

  it.each([
    [3, 3],
    [5, 5],
  ])('com a máquina atrasada (reportado parado no 0): direita %s, volta %s', (r, b) => {
    const out = run(r, b, { reportedLag: true });
    console.log('lag', r, b, JSON.stringify(out));
    expect(out.last).toBe(0);
  });
});

describe('o fim do curso é o último traço, em qualquer passo', () => {
  // Visto na máquina: X em 0,9 no passo de 1 mm; os traços eram 0,9, 1,9…, o
  // próximo para baixo (−0,1) passava do curso, e a régua parava em 0,9 sem
  // chegar ao 0. Como no iOS, a última página para exatamente na borda.
  function model(at: number, step: number) {
    const sent: CommandRequest[] = [];
    const m = new RulerModel('x', step, { send: (r) => sent.push(r), click: () => {} });
    m.limits = { min: 0, max: 1215 };
    m.sync(at, 0);
    m.reported = at;
    const last = () => (sent.filter((s) => s.command === 'nudge' || s.command === 'jogAxisTo').pop() as { to?: number; value?: number } | undefined);
    return { m, sent, last };
  }

  it('a 0,9 no passo de 1 mm, um traço para baixo chega ao 0,0', () => {
    const { m, last } = model(0.9, 1);
    drag(m, -1, 0);
    expect(last()?.to).toBe(0);
    expect(m.value).toBe(0);
  });

  it('arrastar além do fim continua no 0,0 (o elástico, sem passar)', () => {
    const { m, last } = model(0.9, 1);
    drag(m, -3, 0);
    expect(last()?.to).toBe(0);
  });

  it('o mesmo na outra ponta: de 1214,1 um traço para cima chega a 1215', () => {
    const { m, last } = model(1214.1, 1);
    drag(m, 1, 0);
    expect(last()?.to).toBe(1215);
  });

  it('um peteleco no passo de 10 mm até o começo termina exatamente no 0', () => {
    const { m, sent } = model(153.6, 10);
    let t = 0;
    m.down(200, t);
    for (let k = 1; k <= 6; k++) {
      t += 10;
      m.move(200 + k * 60, t); // rápido, para trás
      m.frame(t);
    }
    m.up(t);
    const go = sent.filter((s) => s.command === 'jogAxisTo').pop() as { value: number } | undefined;
    expect(go?.value).toBe(0);
  });

  it('longe do fim, os passos continuam relativos à posição (1 mm é 1 mm)', () => {
    const { m, last } = model(153.621, 1);
    drag(m, 2, 0);
    expect(last()?.to).toBeCloseTo(155.621, 6);
  });
});
